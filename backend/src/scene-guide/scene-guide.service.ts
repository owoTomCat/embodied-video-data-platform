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
import { SceneCategoryPricingEntity } from "../database/entities/scene-category-pricing.entity.js";
import { SceneEntity } from "../database/entities/scene.entity.js";
import { SceneLibraryEntity } from "../database/entities/scene-library.entity.js";
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
  type TaskCardsRaw,
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
  sceneTypeTaskId: string | null;
  sceneLibraryId: string | null;
  ownerAccountId: string;
  title: string | null;
  taskIndex: number;
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
    sceneLibraryId: task.sceneLibraryId,
    ownerAccountId: task.ownerAccountId,
    title: task.title,
    taskIndex: task.taskIndex,
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

export type PublicLibrary = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  sceneId: string | null;
  scene: { id: string; name: string; categoryKey: string } | null;
  collectionTaskId: string | null;
  photoRefs: Array<{ objectKey: string; contentType?: string; name?: string }>;
  coverObjectKey: string | null;
  description: string;
  enabled: boolean;
  ownerAccountId: string | null;
  taskCount: number;
  createdAt: number;
  updatedAt: number;
};

@Injectable()
export class SceneGuideService {
  constructor(
    @InjectRepository(GuideTaskEntity)
    private readonly tasks: Repository<GuideTaskEntity>,
    @InjectRepository(CollectionTaskEntity)
    private readonly collectionTasks: Repository<CollectionTaskEntity>,
    @InjectRepository(SceneLibraryEntity)
    private readonly libraries: Repository<SceneLibraryEntity>,
    @InjectRepository(SceneEntity)
    private readonly scenes: Repository<SceneEntity>,
    @InjectRepository(SceneCategoryPricingEntity)
    private readonly pricing: Repository<SceneCategoryPricingEntity>,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    @Inject(SCENE_GUIDE_PROVIDER)
    private readonly provider: QwenSceneGuideProvider,
    private readonly audit: AuditService,
  ) {}

  // ---------- 数采个人场景库 ----------

  /** 数采：我的场景库列表（含任务卡数量） */
  async listMyLibraries(actor: PublicUser): Promise<PublicLibrary[]> {
    sceneGuidePolicy.requireCollector(actor);
    const rows = await this.libraries.find({
      where: { ownerAccountId: actor.id },
      order: { createdAt: "DESC", id: "DESC" },
    });
    const [scenes, pricingRows] = await Promise.all([
      this.scenes.find(),
      this.pricing.find(),
    ]);
    const byId = new Map(scenes.map((item) => [item.id, item]));
    const pricingByKey = new Map(pricingRows.map((item) => [item.categoryKey, item]));
    const taskCounts = await this.taskCountByLibrary(actor.id);
    return rows.map((row) =>
      this.toLibraryView(row, byId, pricingByKey, taskCounts),
    );
  }

  /** 数采：计费大类分类（任务大厅分栏）。 */
  async listCategories(actor: PublicUser): Promise<Array<{ categoryKey: string; name: string }>> {
    sceneGuidePolicy.requireCollector(actor);
    const rows = await this.pricing.find({
      order: { categoryKey: "ASC" },
    });
    return rows.map((row) => ({ categoryKey: row.categoryKey, name: row.name }));
  }

  /** 数采：某个一级大场景分类下的个人场景库列表（任务大厅进入某大场景后展示）。 */
  async listLibrariesByCategory(
    actor: PublicUser,
    categoryKey: string,
  ): Promise<PublicLibrary[]> {
    sceneGuidePolicy.requireCollector(actor);
    const rows = await this.libraries.find({
      where: { ownerAccountId: actor.id, categoryKey },
      order: { createdAt: "DESC", id: "DESC" },
    });
    const [scenes, pricingRows] = await Promise.all([
      this.scenes.find(),
      this.pricing.find(),
    ]);
    const byId = new Map(scenes.map((item) => [item.id, item]));
    const pricingByKey = new Map(pricingRows.map((item) => [item.categoryKey, item]));
    const taskCounts = await this.taskCountByLibrary(actor.id);
    return rows.map((row) =>
      this.toLibraryView(row, byId, pricingByKey, taskCounts),
    );
  }

  /** 数采：创建自己的场景库（强制单场景；category_key 由 scene 继承） */
  async createLibrary(
    actor: PublicUser,
    input: {
      name: string;
      sceneId: string;
      collectionTaskId?: string | null;
      description?: string;
      photoRefs?: GuidePhotoRef[];
    },
  ): Promise<PublicLibrary> {
    sceneGuidePolicy.requireCollector(actor);
    if (!input.name?.trim()) {
      throw new SceneGuideFailure("VALIDATION", "请填写场景库名称", 400);
    }
    const scene = await this.scenes.findOneBy({ id: input.sceneId });
    if (!scene || !scene.enabled) {
      throw new SceneGuideFailure("VALIDATION", "场景不存在或已停用", 400);
    }
    const photoRefs = input.photoRefs ?? [];
    const row = await this.libraries.save(
      this.libraries.create({
        id: `SL-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: input.name.trim(),
        categoryKey: scene.categoryKey,
        sceneId: scene.id,
        collectionTaskId: input.collectionTaskId ?? null,
        photoRefs,
        coverObjectKey: photoRefs[0]?.objectKey ?? null,
        description: input.description?.trim() ?? "",
        enabled: true,
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
        ownerAccountId: actor.id,
      }),
    );
    await this.audit.record(
      this.libraries.manager,
      actor,
      "collector_library_create",
      { id: row.id, name: row.name },
      `数采新建场景库「${row.name}」（场景：${scene.name}）`,
      null,
      {
        id: row.id,
        name: row.name,
        categoryKey: row.categoryKey,
        sceneId: row.sceneId,
        collectionTaskId: row.collectionTaskId,
        photoRefs: row.photoRefs,
      },
    );
    return (await this.listMyLibraries(actor)).find((item) => item.id === row.id)!;
  }

  /** 数采：删除自己的场景库（其下任务卡级联删除） */
  async deleteLibrary(actor: PublicUser, id: string): Promise<{ deleted: boolean }> {
    sceneGuidePolicy.requireCollector(actor);
    const row = await this.libraries.findOneBy({ id });
    if (!row) {
      throw new SceneGuideFailure("NOT_FOUND", "场景库不存在", 404);
    }
    if (row.ownerAccountId !== actor.id && actor.role !== "admin") {
      throw new SceneGuideFailure("FORBIDDEN", "只能删除自己的场景库", 403);
    }
    await this.libraries.delete({ id });
    await this.audit.record(
      this.libraries.manager,
      actor,
      "collector_library_delete",
      { id: row.id, name: row.name },
      `数采删除场景库「${row.name}」`,
      { id: row.id, name: row.name },
      null,
    );
    return { deleted: true };
  }

  // ---------- 任务卡 ----------

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

  /** 拍照指导：从 MinIO 读取照片 → Qwen-VL 识别环境物体 → LLM 生成 3-5 张任务卡 → 落库（ai_generated）。 */
  async generate(
    actor: PublicUser,
    input: { sceneLibraryId: string; photoRefs: GuidePhotoRef[] },
  ): Promise<PublicGuideTask[]> {
    sceneGuidePolicy.requireCollector(actor);
    if (input.photoRefs.length < 1 || input.photoRefs.length > 5) {
      throw new SceneGuideFailure(
        "VALIDATION",
        "请选择 1~5 张环境照片",
        400,
      );
    }
    const library = await this.libraries.findOneBy({ id: input.sceneLibraryId });
    if (!library) {
      throw new SceneGuideFailure("NOT_FOUND", "场景库不存在", 404);
    }
    if (library.ownerAccountId !== actor.id && actor.role !== "admin") {
      throw new SceneGuideFailure("FORBIDDEN", "只能在自己的场景库下生成任务卡", 403);
    }
    if (!this.storage.getObjectBytes) {
      throw new SceneGuideFailure(
        "UNSUPPORTED",
        "对象存储不支持读取对象",
        501,
      );
    }

    const dataUrls: string[] = [];
    for (const photo of input.photoRefs) {
      const bytes = await this.storage.getObjectBytes({
        objectKey: photo.objectKey,
      });
      const contentType = photo.contentType ?? "image/jpeg";
      dataUrls.push(`data:${contentType};base64,${bytes.toString("base64")}`);
    }

    let recognition: EnvRecognitionRaw & { model: string };
    let cards: TaskCardsRaw & { model: string };
    try {
      recognition = await this.provider.recognizeEnvObjects(dataUrls);
      if (recognition.objects.length === 0) {
        throw new SceneGuideFailure(
          "NO_OBJECTS",
          "未能从照片中识别出可操作的物体，请拍摄更清晰的、包含环境物体的照片后重试",
          400,
        );
      }
      cards = await this.provider.generateTaskCards({
        sceneName: library.name,
        taskDescription: library.description,
        requirements: [],
        envObjects: envObjectsFromRaw(recognition),
        sceneSummary: recognition.scene_summary ?? cardsSceneSummaryFallback(recognition),
      });
      if (cards.tasks.length === 0) {
        throw new SceneGuideFailure(
          "NO_TASKS",
          "未能根据环境物体生成任务卡，请重新拍摄或稍后重试",
          502,
        );
      }
    } catch (error) {
      if (error instanceof SceneGuideFailure) throw error;
      throw new SceneGuideFailure(
        "GENERATION_FAILED",
        error instanceof Error ? error.message : "AI 生成任务卡失败",
        502,
      );
    }

    const rows: GuideTaskEntity[] = [];
    for (const [index, card] of cards.tasks.entries()) {
      const parsed = envelopeTaskCardSchema.parse(card);
      const row = this.tasks.create({
        id: guidId("GT"),
        sceneLibraryId: library.id,
        sceneTypeTaskId: null,
        ownerAccountId: actor.id,
        title: parsed.title,
        taskIndex: index,
        photoRefs: input.photoRefs,
        envObjects: envObjectsFromRaw(recognition),
        taskCard: parsed,
        visionModel: recognition.model ?? cards.model,
        cardPromptVersion: "scene_guide_v1",
        status: "ai_generated" as GuideTaskStatus,
        editedAt: null,
        submissionId: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      } as Partial<GuideTaskEntity>);
      rows.push(row);
    }
    const saved = await this.tasks.save(rows);
    await this.audit.record(
      this.tasks.manager,
      actor,
      "guide_task_generate",
      { id: library.id, name: library.name },
      `数采在场景库「${library.name}」生成 ${saved.length} 张任务卡：识别 ${saved[0]?.envObjects.length ?? 0} 个物体`,
      null,
      {
        libraryId: library.id,
        taskCardCount: saved.length,
        envObjectCount: saved[0]?.envObjects.length ?? 0,
      },
    );
    return saved.map(publicGuideTask);
  }

  /** 数采：某场景库下的任务卡列表。 */
  async listByLibrary(
    actor: PublicUser,
    libraryId: string,
  ): Promise<PublicGuideTask[]> {
    sceneGuidePolicy.requireCollector(actor);
    const library = await this.libraries.findOneBy({ id: libraryId });
    if (!library) {
      throw new SceneGuideFailure("NOT_FOUND", "场景库不存在", 404);
    }
    if (library.ownerAccountId !== actor.id && actor.role !== "admin") {
      throw new SceneGuideFailure("FORBIDDEN", "无权查看该场景库任务卡", 403);
    }
    const rows = await this.tasks.find({
      where: { sceneLibraryId: libraryId, ownerAccountId: actor.id },
      order: { taskIndex: "ASC", createdAt: "DESC", id: "DESC" },
    });
    return rows.map(publicGuideTask);
  }

  /** 数采 / 管理员查看单个指导任务卡。 */
  async get(actor: PublicUser, id: string): Promise<PublicGuideTask> {
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

  /** 管理员：全部场景库（统一管理）。 */
  async listAllLibraries(actor: PublicUser): Promise<PublicLibrary[]> {
    sceneGuidePolicy.requireAdmin(actor);
    const rows = await this.libraries.find({
      order: { createdAt: "DESC", id: "DESC" },
    });
    const [scenes, pricingRows] = await Promise.all([
      this.scenes.find(),
      this.pricing.find(),
    ]);
    const byId = new Map(scenes.map((item) => [item.id, item]));
    const pricingByKey = new Map(pricingRows.map((item) => [item.categoryKey, item]));
    const taskCounts = await this.taskCountByLibrary(null);
    return rows.map((row) =>
      this.toLibraryView(row, byId, pricingByKey, taskCounts),
    );
  }

  /** 数采：查看单个场景库（含任务卡）。 */
  async getLibraryDetail(
    actor: PublicUser,
    id: string,
  ): Promise<PublicLibrary & { tasks: PublicGuideTask[] }> {
    sceneGuidePolicy.requireCollector(actor);
    const library = (await this.listMyLibraries(actor)).find((item) => item.id === id);
    if (!library) {
      throw new SceneGuideFailure("NOT_FOUND", "场景库不存在", 404);
    }
    const tasks = await this.listByLibrary(actor, id);
    return { ...library, tasks };
  }

  /** 数采：获取场景库/任务卡照片的预签名下载 URL（用于场景库卡片封面展示）。 */
  async resolvePhotoUrl(actor: PublicUser, objectKey: string): Promise<{ url: string; expiresAt: number }> {
    sceneGuidePolicy.requireCollector(actor);
    if (!this.storage.presignDownloadObject) {
      throw new SceneGuideFailure("UNSUPPORTED", "对象存储不支持预签名下载", 501);
    }
    const download = await this.storage.presignDownloadObject({
      objectKey,
      expiresInSeconds: 900,
    });
    return { url: download.url, expiresAt: download.expiresAt.getTime() };
  }

  // ---------- helpers ----------

  private async taskCountByLibrary(callerOwner: string | null) {
    const rows = await this.tasks
      .createQueryBuilder("task")
      .select("task.sceneLibraryId", "libraryId")
      .addSelect("COUNT(*)", "cnt")
      .where(
        callerOwner === null
          ? "task.sceneLibraryId IS NOT NULL"
          : "task.sceneLibraryId IS NOT NULL AND task.ownerAccountId = :owner",
      )
      .setParameters(callerOwner === null ? {} : { owner: callerOwner })
      .groupBy("task.sceneLibraryId")
      .getRawMany<{ libraryId: string; cnt: string }>();
    return new Map(rows.map((row) => [row.libraryId, Number(row.cnt)]));
  }

  private toLibraryView(
    row: SceneLibraryEntity,
    sceneById: Map<string, SceneEntity>,
    pricingByCategoryKey: Map<string, SceneCategoryPricingEntity>,
    taskCounts: Map<string, number>,
  ): PublicLibrary {
    const categoryName =
      pricingByCategoryKey.get(row.categoryKey)?.name ?? row.categoryKey;
    const scene = row.sceneId ? sceneById.get(row.sceneId) ?? null : null;
    return {
      id: row.id,
      name: row.name,
      categoryKey: row.categoryKey,
      categoryName,
      sceneId: row.sceneId,
      scene: scene
        ? { id: scene.id, name: scene.name, categoryKey: scene.categoryKey }
        : null,
      collectionTaskId: row.collectionTaskId,
      photoRefs: row.photoRefs,
      coverObjectKey: row.coverObjectKey,
      description: row.description,
      enabled: row.enabled,
      ownerAccountId: row.ownerAccountId,
      taskCount: taskCounts.get(row.id) ?? 0,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }
}

function cardsSceneSummaryFallback(
  _recognition: EnvRecognitionRaw,
): string {
  return "";
}
