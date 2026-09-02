import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { Repository } from "typeorm";

import type { PublicUser } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { CollectionTaskEntity } from "../database/entities/collection-task.entity.js";
import {
  GuideTaskEntity,
  type GuideTaskCard,
  type GuideTaskStatus,
  type GuidePhotoRef,
} from "../database/entities/guide-task.entity.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
  type PresignedUpload,
} from "../storage/object-storage.port.js";
import { SCENE_GUIDE_PROVIDER } from "./scene-guide.tokens.js";
import {
  SceneGuideFailure,
  sceneGuidePolicy,
} from "./scene-guide.policy.js";
import type { QwenSceneGuideProvider } from "./qwen-scene-guide.provider.js";
import {
  envelopeTaskCardSchema,
  type EnvRecognitionRaw,
  type TaskCardRaw,
} from "./scene-guide.schema.js";

const PHOTO_EXPIRES_SECONDS = 600;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function guidId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export type PhotoUploadResult = {
  objectKey: string;
  url: string;
  expiresAt: number;
};

function toTaskCard(raw: TaskCardRaw): GuideTaskCard {
  return {
    target_objects: raw.target_objects,
    steps: raw.steps,
    end_condition: raw.end_condition,
    success_criteria: raw.success_criteria,
    fail_criteria: raw.fail_criteria,
  };
}

function envObjectsFromRaw(
  raw: EnvRecognitionRaw,
): Array<{ name: string; category?: string; confidence?: number }> {
  return raw.objects.map((object) => ({
    name: object.name,
    ...(object.category ? { category: object.category } : {}),
    ...(object.confidence !== undefined ? { confidence: object.confidence } : {}),
  }));
}

export type PublicGuideTask = {
  id: string;
  sceneTypeTaskId: string;
  ownerAccountId: string;
  photoRefs: GuidePhotoRef[];
  envObjects: Array<{ name: string; category?: string; confidence?: number }>;
  taskCard: GuideTaskCard | null;
  visionModel: string | null;
  cardPromptVersion: string | null;
  status: GuideTaskStatus;
  editedAt: number | null;
  submissionId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export function publicGuideTask(task: GuideTaskEntity): PublicGuideTask {
  return {
    id: task.id,
    sceneTypeTaskId: task.sceneTypeTaskId,
    ownerAccountId: task.ownerAccountId,
    photoRefs: task.photoRefs,
    envObjects: task.envObjects,
    taskCard: task.taskCard,
    visionModel: task.visionModel,
    cardPromptVersion: task.cardPromptVersion,
    status: task.status,
    editedAt: task.editedAt?.getTime() ?? null,
    submissionId: task.submissionId,
    lastErrorCode: task.lastErrorCode,
    lastErrorMessage: task.lastErrorMessage,
    createdAt: task.createdAt.getTime(),
    updatedAt: task.updatedAt.getTime(),
  };
}

@Injectable()
export class SceneGuideService {
  constructor(
    @InjectRepository(GuideTaskEntity)
    private readonly tasks: Repository<GuideTaskEntity>,
    @InjectRepository(CollectionTaskEntity)
    private readonly collectionTasks: Repository<CollectionTaskEntity>,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    @Inject(SCENE_GUIDE_PROVIDER)
    private readonly provider: QwenSceneGuideProvider,
    private readonly audit: AuditService,
  ) {}

  /** 预签名上传地址（数采上传环境照片）。 */
  async presignPhoto(
    actor: PublicUser,
    input: { name: string; contentType: string; sizeBytes: number },
  ): Promise<PhotoUploadResult> {
    sceneGuidePolicy.requireCollector(actor);
    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_PHOTO_BYTES) {
      throw new SceneGuideFailure(
        "VALIDATION",
        "照片大小需在 1B ~ 8MB 之间",
        400,
      );
    }
    if (!input.contentType.startsWith("image/")) {
      throw new SceneGuideFailure("VALIDATION", "仅支持上传图片", 400);
    }
    if (!this.storage.presignUploadObject) {
      throw new SceneGuideFailure(
        "UNSUPPORTED",
        "对象存储不支持单对象预签名上传",
        501,
      );
    }
    const objectKey = `scene-guide/${actor.id}/${guidId("PHOTO")}/${encodeURIComponent(input.name)}`;
    const upload = await this.storage.presignUploadObject({
      objectKey,
      contentType: input.contentType,
      expiresInSeconds: PHOTO_EXPIRES_SECONDS,
    });
    return {
      objectKey: upload.objectKey,
      url: upload.url,
      expiresAt: upload.expiresAt.getTime(),
    };
  }

  /** 拍照指导：从 MinIO 读取照片 → Qwen-VL 识别环境物体 → LLM 生成任务卡 → 落库（ai_generated）。 */
  async generate(
    actor: PublicUser,
    input: { sceneTypeTaskId: string; photoRefs: GuidePhotoRef[] },
  ): Promise<PublicGuideTask> {
    sceneGuidePolicy.requireCollector(actor);
    if (input.photoRefs.length < 1 || input.photoRefs.length > 5) {
      throw new SceneGuideFailure(
        "VALIDATION",
        "请选择 1~5 张环境照片",
        400,
      );
    }
    const task = await this.collectionTasks.findOneBy({
      id: input.sceneTypeTaskId,
    });
    if (!task || task.taskType !== "scene_type" || task.status !== "published") {
      throw new SceneGuideFailure(
        "NOT_FOUND",
        "场景型任务不存在或未发布",
        404,
      );
    }
    if (!this.storage.getObjectBytes) {
      throw new SceneGuideFailure(
        "UNSUPPORTED",
        "对象存储不支持读取对象",
        501,
      );
    }

    // 读取照片字节并转 dataUrl
    const dataUrls: string[] = [];
    for (const photo of input.photoRefs) {
      const bytes = await this.storage.getObjectBytes({
        objectKey: photo.objectKey,
      });
      const contentType = photo.contentType ?? "image/jpeg";
      dataUrls.push(`data:${contentType};base64,${bytes.toString("base64")}`);
    }

    let recognition: EnvRecognitionRaw & { model: string };
    let card: TaskCardRaw & { model: string };
    try {
      recognition = await this.provider.recognizeEnvObjects(dataUrls);
      card = await this.provider.generateTaskCard({
        sceneName: task.sceneName,
        taskDescription: task.description,
        requirements: (task.normalizedRequirements?.requirements ?? []).map(
          (item) => item.content,
        ),
        envObjects: envObjectsFromRaw(recognition),
        sceneSummary: recognition.scene_summary,
      });
    } catch (error) {
      // 生成失败：只记录错误，不落库（数采可重试）
      throw new SceneGuideFailure(
        "GENERATION_FAILED",
        error instanceof Error ? error.message : "AI 生成任务卡失败",
        502,
      );
    }

    const row = this.tasks.create({
      id: guidId("GT"),
      sceneTypeTaskId: task.id,
      ownerAccountId: actor.id,
      photoRefs: input.photoRefs,
      envObjects: envObjectsFromRaw(recognition),
      taskCard: toTaskCard(card),
      visionModel: recognition.model ?? card.model,
      cardPromptVersion: "scene_guide_v1",
      status: "ai_generated" as GuideTaskStatus,
      editedAt: null,
      submissionId: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    } as Partial<GuideTaskEntity>);
    const saved = await this.tasks.save(row);
    await this.audit.record(
      this.tasks.manager,
      actor,
      "guide_task_generate",
      { id: saved.id, name: task.title },
      `数采生成场景指导任务卡「${task.title}」：识别 ${saved.envObjects.length} 个物体，生成 ${saved.taskCard?.steps.length ?? 0} 步`,
      null,
      {
        id: saved.id,
        sceneTypeTaskId: saved.sceneTypeTaskId,
        status: saved.status,
        envObjectCount: saved.envObjects.length,
        stepCount: saved.taskCard?.steps.length ?? 0,
      },
    );
    return publicGuideTask(saved);
  }

  /** 数采编辑并提交任务卡（→ in_review）。 */
  async submitEdited(
    actor: PublicUser,
    id: string,
    input: {
      sceneName: string;
      card: TaskCardRaw;
    },
  ): Promise<PublicGuideTask> {
    sceneGuidePolicy.requireCollector(actor);
    const task = await this.tasks.findOneBy({ id });
    if (!task) {
      throw new SceneGuideFailure("NOT_FOUND", "指导任务卡不存在", 404);
    }
    if (task.ownerAccountId !== actor.id && actor.role !== "admin") {
      throw new SceneGuideFailure("FORBIDDEN", "只能编辑自己的指导任务卡", 403);
    }
    if (["approved", "rejected"].includes(task.status)) {
      throw new SceneGuideFailure(
        "NOT_EDITABLE",
        "已审核的任务卡不可再编辑",
        409,
      );
    }
    const card = envelopeTaskCardSchema.parse(input.card);
    task.taskCard = toTaskCard(card);
    task.editedAt = new Date();
    task.status = "in_review";
    const saved = await this.tasks.save(task);
    await this.audit.record(
      this.tasks.manager,
      actor,
      "guide_task_submit_edited",
      { id: saved.id, name: input.sceneName || saved.id },
      `数采编辑指导任务卡并提交审核（${saved.taskCard?.steps.length ?? 0} 步）`,
      { status: "ai_generated" },
      { status: saved.status },
    );
    return publicGuideTask(saved);
  }

  /** 管理员审核：approved / rejected。 */
  async review(
    actor: PublicUser,
    id: string,
    input: {
      decision: "approved" | "rejected";
      comment?: string;
    },
  ): Promise<PublicGuideTask> {
    sceneGuidePolicy.requireAdmin(actor);
    const task = await this.tasks.findOneBy({ id });
    if (!task) {
      throw new SceneGuideFailure("NOT_FOUND", "指导任务卡不存在", 404);
    }
    if (task.status !== "in_review" && task.status !== "ai_generated") {
      throw new SceneGuideFailure(
        "NOT_REVIEWABLE",
        "仅待审核或 AI 生成的任务卡可审核",
        409,
      );
    }
    task.status = input.decision;
    const saved = await this.tasks.save(task);
    await this.audit.record(
      this.tasks.manager,
      actor,
      "guide_task_review",
      { id: saved.id, name: saved.id },
      `管理员${input.decision === "approved" ? "通过" : "驳回"}指导任务卡${input.comment ? `：${input.comment}` : ""}`,
      { status: task.status },
      { status: saved.status, decision: input.decision, comment: input.comment ?? null },
    );
    return publicGuideTask(saved);
  }

  /** 采集完成后回填 submission_id。 */
  async backfillSubmission(
    actor: PublicUser,
    id: string,
    submissionId: string,
  ): Promise<PublicGuideTask> {
    sceneGuidePolicy.requireCollector(actor);
    const task = await this.tasks.findOneBy({ id });
    if (!task) {
      throw new SceneGuideFailure("NOT_FOUND", "指导任务卡不存在", 404);
    }
    task.submissionId = submissionId;
    const saved = await this.tasks.save(task);
    return publicGuideTask(saved);
  }

  /** 数采查看自己的指导任务卡列表。 */
  async listMine(actor: PublicUser): Promise<PublicGuideTask[]> {
    sceneGuidePolicy.requireCollector(actor);
    const rows = await this.tasks.find({
      where: { ownerAccountId: actor.id },
      order: { updatedAt: "DESC", id: "DESC" },
    });
    return rows.map(publicGuideTask);
  }

  /** 数采 / 管理员查看单个指导任务卡。 */
  async get(
    actor: PublicUser,
    id: string,
  ): Promise<PublicGuideTask> {
    sceneGuidePolicy.requireCollector(actor);
    const task = await this.tasks.findOneBy({ id });
    if (!task) {
      throw new SceneGuideFailure("NOT_FOUND", "指导任务卡不存在", 404);
    }
    if (task.ownerAccountId !== actor.id && actor.role !== "admin") {
      throw new SceneGuideFailure("FORBIDDEN", "无权查看该指导任务卡", 403);
    }
    return publicGuideTask(task);
  }

  /** 管理员：全部指导任务卡（审核用）。 */
  async listForAdmin(actor: PublicUser): Promise<PublicGuideTask[]> {
    sceneGuidePolicy.requireAdmin(actor);
    const rows = await this.tasks.find({
      order: { updatedAt: "DESC", id: "DESC" },
    });
    return rows.map(publicGuideTask);
  }
}
