import { extname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import express, { type Express, type Request, type Response } from "express";
import multer from "multer";

import { BailianRequestError } from "../video-quality/qwen-video-quality.provider.js";
import type {
  EvaluateVideoQualityRequest,
  QualityProgressObserver,
} from "../video-quality/video-quality.service.js";
import type { NormalizedVideoQcResultV1 } from "../video-quality/video-quality.types.js";
import type { QualityLabEnvironment } from "./environment.js";
import {
  QualityLabPromptStore,
  type QualityLabPromptSnapshot,
} from "./prompt-store.js";
import {
  QualityLabJobStore,
  isTerminalQualityStage,
  type QualityLabJobRecord,
} from "./job-store.js";
import { renderQualityLabPage } from "./page.js";

export interface VideoQualityEvaluator {
  evaluate(
    request: EvaluateVideoQualityRequest,
    observer?: QualityProgressObserver,
    signal?: AbortSignal,
  ): Promise<NormalizedVideoQcResultV1>;
}

type UploadRequest = Request & {
  qualityTempDirectory?: string;
  file?: Express.Multer.File;
};

type QualityLabAppOptions = {
  environment: QualityLabEnvironment;
  evaluator: VideoQualityEvaluator | null;
  evaluatorFactory?: (prompt: QualityLabPromptSnapshot) => VideoQualityEvaluator;
  annotation?: {
    model: string;
    promptVersion: string;
    schemaVersion: string;
    systemPrompt: string;
  };
  promptStore?: QualityLabPromptStore;
  store?: QualityLabJobStore;
  logger?: (event: Record<string, unknown>) => void;
};

function publicError(error: unknown, record: QualityLabJobRecord): string {
  const base =
    error instanceof BailianRequestError
      ? error.message
      : error instanceof Error
        ? error.message
        : "未知错误";
  return base
    .replaceAll(record.filePath, "<video>")
    .replaceAll(record.workDirectory, "<temp>")
    .replace(/sk-(?:ws-)?[A-Za-z0-9._-]+/gu, "<redacted>")
    .replace(/\/(?:private\/)?tmp\/[A-Za-z0-9_./ -]+/gu, "<temp>")
    .slice(0, 2_000);
}

function validVideo(file: Express.Multer.File): boolean {
  const extension = extname(file.originalname).toLowerCase();
  const validExtension = extension === ".mp4" || extension === ".mov";
  const validMime = [
    "video/mp4",
    "video/quicktime",
    "application/octet-stream",
  ].includes(file.mimetype);
  return validExtension && validMime;
}

export function createQualityLabApp(options: QualityLabAppOptions): Express {
  const app = express();
  const store = options.store ?? new QualityLabJobStore();
  const logger = options.logger ?? (() => undefined);
  const pending: string[] = [];
  const jobEvaluators = new Map<string, VideoQualityEvaluator>();
  const maxConcurrency = 2;
  let activeJobs = 0;

  const storage = multer.diskStorage({
    destination(request: UploadRequest, _file, callback) {
      void mkdtemp(join(tmpdir(), "evdp-quality-lab-")).then(
        (directory) => {
          request.qualityTempDirectory = directory;
          callback(null, directory);
        },
        (error: Error) => callback(error, ""),
      );
    },
    filename(_request, file, callback) {
      callback(null, `original${extname(file.originalname).toLowerCase()}`);
    },
  });
  const upload = multer({
    storage,
    limits: { files: 1, fileSize: options.environment.maxUploadBytes },
    fileFilter(_request, file, callback) {
      callback(null, validVideo(file));
    },
  }).single("video");

  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  async function clean(record: QualityLabJobRecord): Promise<void> {
    await rm(record.workDirectory, { recursive: true, force: true });
  }

  async function processRecord(id: string): Promise<void> {
    const record = store.getRecord(id);
    if (!record) return;
    if (record.public.stage === "cancelled") {
      await clean(record);
      jobEvaluators.delete(id);
      return;
    }
    try {
      const evaluator = jobEvaluators.get(id) ?? options.evaluator;
      const result = await evaluator?.evaluate(
        {
          videoId: id,
          filePath: record.filePath,
          workDirectory: record.workDirectory,
          registerSha256: (sha256) =>
            store.registerSha256(record.public.batchId, sha256),
        },
        (stage) => {
          if (stage !== "completed" && stage !== "review_pending") {
            store.updateStage(id, stage);
          }
        },
        record.abortController.signal,
      );
      await clean(record);
      if (result) {
        store.complete(id, result);
        logger({
          event: "quality_lab_job_terminal",
          taskId: id,
          stage: store.getPublic(id)?.stage,
          finalScore: result.finalScore,
        });
      }
    } catch (error) {
      await clean(record);
      if (record.abortController.signal.aborted) {
        store.cancel(id);
      } else {
        const message = publicError(error, record);
        store.fail(id, message);
        logger({
          event: "quality_lab_job_terminal",
          taskId: id,
          stage: "system_failed",
          error: message,
        });
      }
    } finally {
      jobEvaluators.delete(id);
    }
  }

  function pump(): void {
    while (activeJobs < maxConcurrency && pending.length > 0) {
      const id = pending.shift();
      if (!id) continue;
      activeJobs += 1;
      void processRecord(id).finally(() => {
        activeJobs -= 1;
        pump();
      });
    }
  }
  app.get("/api/health", (_request, response) => {
    const activePrompt = options.promptStore?.getCurrent();
    response.json({
      status: "ok",
      modelStatus: options.environment.modelConfigured
        ? "configured"
        : "not_configured",
      initialModel: options.environment.initialModel,
      reviewModel: options.environment.reviewModel,
      ruleVersion: "video_qc_v2",
      promptVersion: "qwen_video_qc_prompt_v4",
      promptRevision: activePrompt?.revision ?? 1,
      labMode: options.environment.mode,
      annotationEnabled: Boolean(options.annotation),
      ...(options.annotation
        ? {
            annotationModel: options.annotation.model,
            annotationPromptVersion: options.annotation.promptVersion,
            annotationSchemaVersion: options.annotation.schemaVersion,
          }
        : {}),
      concurrency: maxConcurrency,
    });
  });

  app.get("/", (_request, response) => {
    response.type("html").send(renderQualityLabPage(options.environment.mode));
  });

  app.get("/api/jobs", (_request, response) => {
    response.json({
      retentionDays: options.environment.historyRetentionDays,
      jobs: store.listPublic(),
    });
  });

  app.get("/api/prompt", (_request, response) => {
    const prompt = options.promptStore?.getCurrent();
    if (!prompt) {
      response.status(503).json({ error: "系统提示词编辑尚未配置" });
      return;
    }
    response.json({
      prompt: {
        revision: prompt.revision,
        systemPrompt: prompt.systemPrompt,
        contentSha256: prompt.contentSha256,
        promptVersion: prompt.promptVersion,
        ruleVersion: prompt.ruleVersion,
        outputSchema: prompt.outputSchema,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        updatedAt: prompt.updatedAt,
      },
    });
  });

  app.get("/api/annotation-prompt", (_request, response) => {
    if (!options.annotation) {
      response.status(404).json({ error: "当前实验页未启用融合标注链路" });
      return;
    }
    response.json({
      prompt: {
        systemPrompt: options.annotation.systemPrompt,
        promptVersion: options.annotation.promptVersion,
        outputSchema: options.annotation.schemaVersion,
        model: options.annotation.model,
      },
    });
  });

  app.put("/api/prompt", (request, response) => {
    if (!options.promptStore) {
      response.status(503).json({ error: "系统提示词编辑尚未配置" });
      return;
    }
    if (
      !request.body ||
      typeof request.body !== "object" ||
      typeof request.body.systemPrompt !== "string"
    ) {
      response.status(400).json({ error: "systemPrompt 必须是字符串" });
      return;
    }
    try {
      const prompt = options.promptStore.update(request.body.systemPrompt);
      logger({
        event: "quality_lab_prompt_updated",
        revision: prompt.revision,
        contentSha256: prompt.contentSha256,
      });
      response.json({
        prompt: {
          revision: prompt.revision,
          systemPrompt: prompt.systemPrompt,
          contentSha256: prompt.contentSha256,
          promptVersion: prompt.promptVersion,
          ruleVersion: prompt.ruleVersion,
          outputSchema: prompt.outputSchema,
          initialModel: prompt.initialModel,
          reviewModel: prompt.reviewModel,
          updatedAt: prompt.updatedAt,
        },
      });
    } catch (error) {
      response.status(400).json({
        error: error instanceof Error ? error.message : "系统提示词保存失败",
      });
    }
  });

  app.post("/api/jobs", (request: UploadRequest, response: Response) => {
    if (
      (!options.evaluator && !options.evaluatorFactory) ||
      !options.environment.modelConfigured
    ) {
      response.status(503).json({ error: "百炼模型尚未配置" });
      return;
    }
    upload(request, response, (error: unknown) => {
      const cleanupUpload = () =>
        request.qualityTempDirectory
          ? rm(request.qualityTempDirectory, { recursive: true, force: true })
          : Promise.resolve();
      if (error) {
        void cleanupUpload();
        const status =
          error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
            ? 413
            : 400;
        response.status(status).json({
          error: status === 413 ? "视频超过上传大小限制" : "视频上传失败",
        });
        return;
      }
      if (!request.file || !request.qualityTempDirectory) {
        void cleanupUpload();
        response.status(415).json({ error: "仅支持 MP4 或 MOV 视频" });
        return;
      }
      const rawBatchId =
        typeof request.body?.batchId === "string"
          ? request.body.batchId.trim()
          : "";
      const batchId = rawBatchId.slice(0, 128) || "standalone";
      const prompt = options.promptStore?.getCurrent();
      const record = store.create({
        batchId,
        fileName: request.file.originalname.slice(0, 255),
        sizeBytes: request.file.size,
        filePath: request.file.path,
        workDirectory: request.qualityTempDirectory,
        promptRevision: prompt?.revision,
        promptContentSha256: prompt?.contentSha256,
      });
      if (prompt && options.evaluatorFactory) {
        jobEvaluators.set(record.public.id, options.evaluatorFactory(prompt));
      }
      pending.push(record.public.id);
      logger({
        event: "quality_lab_job_created",
        taskId: record.public.id,
        batchId: record.public.batchId,
        fileName: record.public.fileName,
        sizeBytes: record.public.sizeBytes,
      });
      queueMicrotask(pump);
      response.status(202).json({ jobId: record.public.id });
    });
  });

  app.get("/api/jobs/:id", (request, response) => {
    const job = store.getPublic(request.params.id);
    if (!job) {
      response.status(404).json({ error: "任务不存在或已过期" });
      return;
    }
    response.json(job);
  });

  app.delete("/api/jobs/:id", (request, response) => {
    const record = store.getRecord(request.params.id);
    if (!record) {
      response.status(404).json({ error: "任务不存在或已过期" });
      return;
    }
    if (isTerminalQualityStage(record.public.stage)) {
      store.deleteTerminal(record.public.id);
      logger({
        event: "quality_lab_job_deleted",
        taskId: record.public.id,
      });
      response.status(204).send();
      return;
    }
    if (!store.cancel(record.public.id)) {
      response.status(409).json({ error: "任务状态已变化，请刷新后重试" });
      return;
    }
    void clean(record);
    logger({
      event: "quality_lab_job_terminal",
      taskId: record.public.id,
      stage: "cancelled",
    });
    response.status(202).json({ jobId: record.public.id, stage: "cancelled" });
  });

  return app;
}
