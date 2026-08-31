import { existsSync } from "node:fs";

import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import {
  parseQualityLabEnvironment,
  type QualityLabEnvironment,
} from "../src/quality-lab/environment.js";
import { createQualityLabApp } from "../src/quality-lab/server.js";
import type { VideoQualityEvaluator } from "../src/quality-lab/server.js";
import { QualityLabPromptStore } from "../src/quality-lab/prompt-store.js";
import type { LoadedVideoQualityPrompt } from "../src/video-quality/prompt-loader.js";
import type { NormalizedVideoQcResultV1 } from "../src/video-quality/video-quality.types.js";

function environment(
  overrides: Partial<QualityLabEnvironment> = {},
): QualityLabEnvironment {
  return {
    host: "127.0.0.1",
    port: 4010,
    maxUploadBytes: 1_024,
    modelTimeoutMs: 600_000,
    mode: "quality",
    promptPath: "/quality/prompt.md",
    annotationPromptPath: "/quality/annotation/manifest.json",
    annotationModelTimeoutMs: 180_000,
    annotationConcurrency: 1,
    qwenApiKey: "configured",
    qwenBaseUrl: "https://workspace.example.com/compatible-mode/v1",
    initialModel: "qwen3.7-plus",
    reviewModel: "qwen3.7-flash",
    modelConfigured: true,
    historyPath: undefined,
    historyRetentionDays: 30,
    ...overrides,
  };
}

function result(videoId: string): NormalizedVideoQcResultV1 {
  return {
    schemaVersion: "video_qc_v2",
    ruleVersion: "video_qc_v2",
    promptVersion: "qwen_video_qc_prompt_v4",
    videoId,
    evaluationStatus: "scored",
    dimensions: {} as NormalizedVideoQcResultV1["dimensions"],
    rawTotalScore: 80,
    finalScore: 80,
    settlementRatio: 1,
    analysisDurationMs: 1_000,
    invalidDurationMs: 0,
    billableDurationMs: 1_000,
    invalidSegments: [],
    hardVeto: { triggered: false, reasons: [], candidates: [] },
    detectedTask: { task_id: "", task_summary: "test", confidence: null },
    taskCompliance: null,
    deductions: [],
    recommendations: [],
    summary: "test",
    reviewRequired: false,
    reviewReasons: [],
    missingInputs: [],
    validation: { warnings: [], errors: [] },
    rawModelResult: {} as NormalizedVideoQcResultV1["rawModelResult"],
    modelRuns: [],
    media: {
      metadata: {} as NormalizedVideoQcResultV1["media"]["metadata"],
      technicalMetrics: {} as NormalizedVideoQcResultV1["media"]["technicalMetrics"],
      fullVideoSamplingFps: 0.2,
      fullVideoFrameCount: 4,
    },
  };
}

async function waitForTerminal(
  app: ReturnType<typeof createQualityLabApp>,
  jobId: string,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await request(app).get(`/api/jobs/${jobId}`);
    if (["completed", "review_pending", "system_failed", "cancelled"].includes(response.body.stage)) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job did not finish");
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not reached");
}

describe("quality lab environment", () => {
  it("does not require platform infrastructure and reports missing model config", () => {
    const parsed = parseQualityLabEnvironment({});
    expect(parsed.host).toBe("127.0.0.1");
    expect(parsed.port).toBe(4010);
    expect(parsed.mode).toBe("quality");
    expect(parsed.modelConfigured).toBe(false);
    expect(parsed.qwenApiKey).toBeUndefined();
    expect(parsed.initialModel).toBe("qwen3.7-plus");
    expect(parsed.reviewModel).toBe("qwen3.7-flash");
    expect(parsed.promptStatePath).toBeUndefined();

    const persisted = parseQualityLabEnvironment({
      QUALITY_LAB_HISTORY_PATH: "/data/quality-lab/jobs.json",
    });
    expect(persisted.promptStatePath).toBe("/data/quality-lab/prompt.json");

    const fused = parseQualityLabEnvironment({
      QUALITY_LAB_MODE: "fused",
      QUALITY_LAB_PORT: "4011",
      VIDEO_ANNOTATION_PROMPT_PATH: "/quality/annotation/manifest.json",
      AI_ANNOTATION_MODEL_TIMEOUT_MS: "200000",
      AI_ANNOTATION_CONCURRENCY: "2",
    });
    expect(fused).toMatchObject({
      mode: "fused",
      port: 4011,
      annotationPromptPath: "/quality/annotation/manifest.json",
      annotationModelTimeoutMs: 200_000,
      annotationConcurrency: 2,
    });
    expect(() =>
      parseQualityLabEnvironment({ QUALITY_LAB_MODE: "unknown" }),
    ).toThrow("QUALITY_LAB_MODE");
  });
});

describe("quality lab server", () => {
  it("exposes versioned prompts and locks each job to its creation revision", async () => {
    const committedPrompt: LoadedVideoQualityPrompt = {
      systemPrompt: "video_qc_v2 初始规则，返回 JSON。",
      outputExample: { schema_version: "video_qc_v2" },
      promptVersion: "qwen_video_qc_prompt_v4",
      ruleVersion: "video_qc_v2",
      outputSchema: "video_qc_v2",
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      contentSha256: "a".repeat(64),
    };
    const promptStore = new QualityLabPromptStore({ committedPrompt });
    const revisions: number[] = [];
    const app = createQualityLabApp({
      environment: environment(),
      evaluator: null,
      promptStore,
      evaluatorFactory: (prompt) => ({
        evaluate: vi.fn(async (input) => {
          revisions.push(prompt.revision);
          return result(input.videoId);
        }),
      }),
    });

    const initial = await request(app).get("/api/prompt").expect(200);
    expect(initial.body.prompt).toMatchObject({ revision: 1, systemPrompt: committedPrompt.systemPrompt });
    const first = await request(app)
      .post("/api/jobs")
      .field("batchId", "prompt-one")
      .attach("video", Buffer.from("video"), "one.mp4")
      .expect(202);
    await request(app)
      .put("/api/prompt")
      .send({ systemPrompt: "video_qc_v2 第二版规则，返回 JSON。" })
      .expect(200)
      .expect(({ body }) => expect(body.prompt.revision).toBe(2));
    const second = await request(app)
      .post("/api/jobs")
      .field("batchId", "prompt-two")
      .attach("video", Buffer.from("video"), "two.mp4")
      .expect(202);

    const [firstResult, secondResult] = await Promise.all([
      waitForTerminal(app, first.body.jobId),
      waitForTerminal(app, second.body.jobId),
    ]);
    expect(revisions).toEqual([1, 2]);
    expect(firstResult.body.promptRevision).toBe(1);
    expect(firstResult.body.promptContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(secondResult.body.promptRevision).toBe(2);
    expect(secondResult.body.promptContentSha256).not.toBe(
      firstResult.body.promptContentSha256,
    );
  });

  it("identifies the fused lab and its annotation contract in health", async () => {
    const app = createQualityLabApp({
      environment: environment({ mode: "fused", port: 4011 }),
      evaluator: { evaluate: vi.fn() },
      annotation: {
        model: "qwen3.7-plus",
        promptVersion: "ego_video_annotation_prompt_v2",
        schemaVersion: "ego_video_annotation_v2",
        systemPrompt: "你是任务盲内容观察器。",
      },
    });

    const health = await request(app).get("/api/health").expect(200);
    expect(health.body).toMatchObject({
      labMode: "fused",
      annotationEnabled: true,
      annotationModel: "qwen3.7-plus",
      annotationPromptVersion: "ego_video_annotation_prompt_v2",
      annotationSchemaVersion: "ego_video_annotation_v2",
    });
    expect((await request(app).get("/")).text).toContain("融合 AI 标注实验页");
    const annotationPrompt = await request(app)
      .get("/api/annotation-prompt")
      .expect(200);
    expect(annotationPrompt.body).toEqual({
      prompt: {
        systemPrompt: "你是任务盲内容观察器。",
        promptVersion: "ego_video_annotation_prompt_v2",
        outputSchema: "ego_video_annotation_v2",
        model: "qwen3.7-plus",
      },
    });
  });

  it("does not expose a fused prompt from the original baseline lab", async () => {
    const app = createQualityLabApp({
      environment: environment(),
      evaluator: { evaluate: vi.fn() },
    });

    await request(app).get("/api/annotation-prompt").expect(404);
  });

  it("rejects invalid prompt updates without changing the active revision", async () => {
    const committedPrompt: LoadedVideoQualityPrompt = {
      systemPrompt: "video_qc_v2 初始规则，返回 JSON。",
      outputExample: {},
      promptVersion: "qwen_video_qc_prompt_v4",
      ruleVersion: "video_qc_v2",
      outputSchema: "video_qc_v2",
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      contentSha256: "a".repeat(64),
    };
    const promptStore = new QualityLabPromptStore({ committedPrompt });
    const app = createQualityLabApp({
      environment: environment(),
      evaluator: { evaluate: vi.fn() },
      promptStore,
    });

    await request(app).put("/api/prompt").send({ systemPrompt: "中文" }).expect(400);
    expect((await request(app).get("/api/prompt")).body.prompt.revision).toBe(1);
  });

  it("runs two evaluations in parallel and holds the third", async () => {
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const evaluator: VideoQualityEvaluator = {
      evaluate: vi.fn(async (input) => {
        started.push(input.videoId);
        await new Promise<void>((resolve) => releases.push(resolve));
        return result(input.videoId);
      }),
    };
    const app = createQualityLabApp({ environment: environment(), evaluator });

    const jobs = [];
    for (const name of ["one.mp4", "two.mp4", "three.mp4"]) {
      const created = await request(app)
        .post("/api/jobs")
        .field("batchId", "batch-concurrency")
        .attach("video", Buffer.from("video"), name)
        .expect(202);
      jobs.push(created.body.jobId as string);
    }
    await waitUntil(() => started.length === 2);
    expect(started).toEqual(jobs.slice(0, 2));

    releases.shift()?.();
    await waitUntil(() => started.length === 3);
    expect(started[2]).toBe(jobs[2]);
    releases.splice(0).forEach((release) => release());
    await Promise.all(jobs.map((id) => waitForTerminal(app, id)));
  });

  it("accepts a multipart video, exposes progress, and removes temporary files", async () => {
    let temporaryPath = "";
    const evaluator: VideoQualityEvaluator = {
      evaluate: vi.fn(async (input, observer) => {
        temporaryPath = input.filePath;
        expect(existsSync(temporaryPath)).toBe(true);
        observer?.("media_analysis");
        observer?.("initial_review");
        return result(input.videoId);
      }),
    };
    const app = createQualityLabApp({ environment: environment(), evaluator });

    const created = await request(app)
      .post("/api/jobs")
      .field("batchId", "batch-one")
      .attach("video", Buffer.from("video"), {
        filename: "sample.mp4",
        contentType: "video/mp4",
      })
      .expect(202);

    expect(created.body.jobId).toMatch(/^LAB-/u);
    const completed = await waitForTerminal(app, created.body.jobId);
    expect(completed.body.stage).toBe("completed");
    expect(completed.body.result.finalScore).toBe(80);
    expect(JSON.stringify(completed.body)).not.toContain(temporaryPath);
    expect(existsSync(temporaryPath)).toBe(false);
  });

  it("rejects jobs when the model is unconfigured and enforces upload limits", async () => {
    const unavailable = createQualityLabApp({
      environment: environment({
        qwenApiKey: undefined,
        modelConfigured: false,
      }),
      evaluator: null,
    });
    const health = await request(unavailable).get("/api/health").expect(200);
    expect(health.body.modelStatus).toBe("not_configured");
    expect(health.body.concurrency).toBe(2);
    await request(unavailable)
      .post("/api/jobs")
      .field("batchId", "batch")
      .attach("video", Buffer.from("video"), "sample.mp4")
      .expect(503);

    const limited = createQualityLabApp({
      environment: environment({ maxUploadBytes: 4 }),
      evaluator: { evaluate: vi.fn() },
    });
    await request(limited)
      .post("/api/jobs")
      .field("batchId", "batch")
      .attach("video", Buffer.from("too-large"), "sample.mp4")
      .expect(413);
  });

  it("cancels an active job without exposing internal errors", async () => {
    const evaluator: VideoQualityEvaluator = {
      evaluate: vi.fn((_input, _observer, signal) =>
        new Promise<NormalizedVideoQcResultV1>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("/private/tmp/secret-video.mp4")));
        }),
      ),
    };
    const app = createQualityLabApp({ environment: environment(), evaluator });
    const created = await request(app)
      .post("/api/jobs")
      .field("batchId", "batch-cancel")
      .attach("video", Buffer.from("video"), "sample.mp4")
      .expect(202);

    await request(app).delete(`/api/jobs/${created.body.jobId}`).expect(202);
    const cancelled = await waitForTerminal(app, created.body.jobId);
    expect(cancelled.body.stage).toBe("cancelled");
    expect(JSON.stringify(cancelled.body)).not.toContain("/private/tmp");
  });

  it("lists persisted task IDs and deletes terminal history", async () => {
    const app = createQualityLabApp({
      environment: environment(),
      evaluator: {
        evaluate: vi.fn(async (input) => result(input.videoId)),
      },
    });
    const created = await request(app)
      .post("/api/jobs")
      .field("batchId", "batch-history")
      .attach("video", Buffer.from("video"), "26018_68.mp4")
      .expect(202);
    await waitForTerminal(app, created.body.jobId);

    const history = await request(app).get("/api/jobs").expect(200);
    expect(history.body.retentionDays).toBe(30);
    expect(history.body.jobs).toMatchObject([
      {
        id: created.body.jobId,
        fileName: "26018_68.mp4",
        stage: "completed",
        diagnostics: [],
      },
    ]);

    await request(app).delete(`/api/jobs/${created.body.jobId}`).expect(204);
    expect((await request(app).get("/api/jobs")).body.jobs).toEqual([]);
  });
});
