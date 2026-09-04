import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import { LabelSetService } from "../ai-quality/label-set.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import {
  CollectionTaskEntity,
  type CollectionTaskStatus,
  type CollectionTaskType,
  type NormalizedTaskRequirements,
} from "../database/entities/collection-task.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { SceneEntity } from "../database/entities/scene.entity.js";
import { SceneTaskTargetEntity } from "../database/entities/scene-task-target.entity.js";
import { GENERIC_TASK_TEMPLATE } from "./generic-task-template.js";
import { TaskFailure } from "./tasks.failure.js";
import { TasksPolicy } from "./tasks.policy.js";
import { RequirementNormalizerService } from "./requirement-normalizer.service.js";
import { ScenePricingService } from "../scene-pricing/scene-pricing.service.js";
import type {
  ConfirmNormalizedRequirementsDto,
  CreateTaskDto,
  SceneTargetDto,
  UpdateTaskDto,
} from "./dto/tasks.dto.js";

export type PublicTask = {
  id: string;
  title: string;
  description: string;
  sceneName: string;
  sceneLabelId: string | null;
  taskType: CollectionTaskType;
  categoryKey: string | null;
  targetDurationSeconds: number | null;
  sceneTargets: Array<{ sceneId: string; targetDurationSeconds: number }>;
  rawRequirements: string;
  normalizedRequirements: NormalizedTaskRequirements | null;
  normalizationStatus: string;
  pricePerHour: number | null;
  status: CollectionTaskStatus;
  revision: number;
  createdByName: string;
  publishedAt: number | null;
  pausedAt: number | null;
  closedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type PublicTaskForCollector = {
  id: string;
  title: string;
  description: string;
  sceneName: string;
  sceneLabelId: string | null;
  taskType: CollectionTaskType;
  categoryKey: string | null;
  targetDurationSeconds: number | null;
  /** 已收集的合格有效时长（秒），用于任务大厅补量进度条 */
  currentDurationSeconds: number;
  /** 场景型任务的可选场景目标（scene_type 用；custom/generic 为空） */
  sceneTargets: Array<{ sceneId: string; targetDurationSeconds: number }>;
  normalizedRequirements: NormalizedTaskRequirements | null;
  pricePerHour: number | null;
  status: CollectionTaskStatus;
  revision: number;
  publishedAt: number | null;
};

export function publicTask(
  task: CollectionTaskEntity,
  sceneTargets: Array<{ sceneId: string; targetDurationSeconds: number }> = [],
): PublicTask {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    sceneName: task.sceneName,
    sceneLabelId: task.sceneLabelId,
    taskType: task.taskType,
    categoryKey: task.categoryKey,
    targetDurationSeconds: numericOrNull(task.targetDurationSeconds),
    sceneTargets,
    rawRequirements: task.rawRequirements,
    normalizedRequirements: task.normalizedRequirements,
    normalizationStatus: task.normalizationStatus,
    pricePerHour: numericOrNull(task.pricePerHour),
    status: task.status,
    revision: task.revision,
    createdByName: task.createdByName,
    publishedAt: task.publishedAt?.getTime() ?? null,
    pausedAt: task.pausedAt?.getTime() ?? null,
    closedAt: task.closedAt?.getTime() ?? null,
    createdAt: task.createdAt.getTime(),
    updatedAt: task.updatedAt.getTime(),
  };
}

export function publicTaskForCollector(
  task: CollectionTaskEntity,
  currentDurationSeconds = 0,
  sceneTargets: Array<{ sceneId: string; targetDurationSeconds: number }> = [],
): PublicTaskForCollector {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    sceneName: task.sceneName,
    sceneLabelId: task.sceneLabelId,
    taskType: task.taskType,
    categoryKey: task.categoryKey,
    targetDurationSeconds: numericOrNull(task.targetDurationSeconds),
    currentDurationSeconds,
    sceneTargets,
    normalizedRequirements: task.normalizedRequirements,
    pricePerHour: numericOrNull(task.pricePerHour),
    status: task.status,
    revision: task.revision,
    publishedAt: task.publishedAt?.getTime() ?? null,
  };
}

function numericOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export { numericOrNull };

export function assertTaskCanBeDeleted(
  task: Pick<CollectionTaskEntity, "status">,
  linkedSubmissionCount: number,
): void {
  if (task.status !== "draft") {
    throw new TaskFailure(
      "TASK_NOT_DELETABLE",
      "只有尚未发布的草稿任务可以删除；已发布任务请使用关闭操作保留数据追溯",
      409,
    );
  }
  if (linkedSubmissionCount > 0) {
    throw new TaskFailure(
      "TASK_HAS_SUBMISSIONS",
      "该任务已有提交数据，不能删除",
      409,
    );
  }
}

const COLLECTOR_VISIBLE_STATUSES: CollectionTaskStatus[] = [
  "published",
  "paused",
];

@Injectable()
export class TasksService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CollectionTaskEntity)
    private readonly tasks: Repository<CollectionTaskEntity>,
    private readonly policy: TasksPolicy,
    private readonly audit: AuditService,
    private readonly labelSets: LabelSetService,
    private readonly normalizer: RequirementNormalizerService,
    private readonly scenePricing: ScenePricingService,
    @InjectRepository(SceneEntity)
    private readonly scenes: Repository<SceneEntity>,
    @InjectRepository(SceneTaskTargetEntity)
    private readonly sceneTargets: Repository<SceneTaskTargetEntity>,
  ) {}

  /** 数采人员 / 团长：任务大厅（published + paused） */
  async listForCollectors(
    actor: PublicUser,
  ): Promise<{ tasks: PublicTaskForCollector[] }> {
    this.policy.requireListForCollectors(actor);
    const rows = await this.tasks.find({
      where: { status: "published" },
      order: { publishedAt: "DESC", createdAt: "DESC" },
    });
    const paused = await this.tasks.find({
      where: { status: "paused" },
      order: { pausedAt: "DESC", createdAt: "DESC" },
    });
    const currentByTask = await this.currentDurationByTask();
    const all = [...rows, ...paused];
    const targetsByTask = await this.loadSceneTargets(all.map((task) => task.id));
    return {
      tasks: all.map((task) =>
        publicTaskForCollector(
          task,
          currentByTask.get(task.id) ?? 0,
          targetsByTask.get(task.id) ?? [],
        ),
      ),
    };
  }

  /** 各任务已收集的合格有效时长（秒）：按 task_id 或 collection_task_id 归口，供补量进度条 */
  private async currentDurationByTask(): Promise<Map<string, number>> {
    const rows = await this.dataSource.query<Array<{
      task_id: string;
      current_ms: string;
    }>>(
      `SELECT COALESCE(submission.task_id, submission.collection_task_id) AS task_id,
              COALESCE(SUM(
                COALESCE(quality.manual_billable_duration_ms, quality.billable_duration_ms, 0)
              ), 0)::float AS current_ms
         FROM submissions submission
         LEFT JOIN video_quality_results quality ON quality.submission_id = submission.id
        WHERE COALESCE(submission.task_id, submission.collection_task_id) IS NOT NULL
          AND quality.passed = true
          AND quality.status IN ('scored', 'review_pending')
        GROUP BY 1`,
    );
    return new Map(
      rows.map((row) => [
        row.task_id,
        Math.round((Number(row.current_ms) || 0) / 1000),
      ]),
    );
  }

  /** 管理员：任务类型选择器使用的通用任务模板 */
  async listTaskTypeCatalog(
    actor: PublicUser,
  ): Promise<{ generic: typeof GENERIC_TASK_TEMPLATE }> {
    this.policy.requireManage(actor);
    return { generic: GENERIC_TASK_TEMPLATE };
  }

  /** 管理员：任务管理列表（状态筛选 + 关键词 + 分页） */
  async listManage(
    actor: PublicUser,
    query: {
      status?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<{ tasks: PublicTask[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }> {
    this.policy.requireManage(actor);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const builder = this.tasks.createQueryBuilder("task");
    if (query.status && query.status !== "all") {
      builder.andWhere("task.status = :status", { status: query.status });
    }
    if (query.q?.trim()) {
      builder.andWhere(
        "(task.title ILIKE :keyword OR task.sceneName ILIKE :keyword)",
        { keyword: `%${query.q.trim()}%` },
      );
    }
    const total = await builder.getCount();
    const rows = await builder
      .orderBy("task.updatedAt", "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();
    const targetsByTask = await this.loadSceneTargets(rows.map((row) => row.id));
    return {
      tasks: rows.map((task) => publicTask(task, targetsByTask.get(task.id) ?? [])),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async get(
    actor: PublicUser,
    id: string,
  ): Promise<PublicTask | PublicTaskForCollector> {
    this.policy.requireRead(actor);
    const task = await this.findEntity(id);
    if (actor.role === "admin") {
      const targetsByTask = await this.loadSceneTargets([id]);
      return publicTask(task, targetsByTask.get(id) ?? []);
    }
    if (!COLLECTOR_VISIBLE_STATUSES.includes(task.status)) {
      throw new TaskFailure(
        "TASK_NOT_VISIBLE",
        "该任务当前不可见",
        404,
      );
    }
    const currentByTask = await this.currentDurationByTask();
    const targetsByTask = await this.loadSceneTargets([id]);
    return publicTaskForCollector(
      task,
      currentByTask.get(task.id) ?? 0,
      targetsByTask.get(id) ?? [],
    );
  }

  /** 管理员：创建任务（draft）；创建成功后自动后台规范化，需人工核查 */
  async create(
    actor: PublicUser,
    input: CreateTaskDto,
  ): Promise<{
    task: PublicTask;
    autoNormalized: boolean;
    normalizationFailed: boolean;
  }> {
    this.policy.requireManage(actor);
    const sceneName = input.sceneName.trim();
    const explicitPrice =
      input.pricePerHour === null ||
      input.pricePerHour === undefined
        ? null
        : input.pricePerHour;
    const price = explicitPrice ?? null;
    // 场景型任务：绑定计费大类 + 按场景目标
    let categoryKey: string | null = null;
    let totalTargetSeconds: string | null = null;
    let resolvedSceneTargets: Array<{
      sceneId: string;
      targetDurationSeconds: number;
    }> = [];
    if (input.taskType === "scene_type") {
      const resolved = await this.resolveSceneTypeTargets(
        actor,
        input.categoryKey,
        input.sceneTargets ?? [],
      );
      categoryKey = resolved.categoryKey;
      totalTargetSeconds = resolved.totalTargetSeconds;
      resolvedSceneTargets = resolved.resolvedTargets;
    }
    const task = await this.tasks.save(
      this.tasks.create({
        id: `TASK-${randomUUID().slice(0, 8)}`,
        title: input.title.trim(),
        description: input.description?.trim() ?? "",
        sceneName,
        taskType: input.taskType ?? "scene_type",
        sceneLabelId: null,
        categoryKey,
        targetDurationSeconds: totalTargetSeconds,
        rawRequirements: input.rawRequirements.trim(),
        normalizedRequirements: null,
        normalizationStatus: "pending",
        pricePerHour: price === null ? null : price.toFixed(2),
        status: "draft",
        revision: 1,
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
      }),
    );
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "task_create",
      { id: task.id, name: task.title },
      `创建采集任务 ${task.title}（场景：${sceneName}）`,
      null,
      { id: task.id, title: task.title, sceneName },
    );
    if (input.taskType === "scene_type") {
      await this.saveSceneTargets(task.id, resolvedSceneTargets);
    }
    // 创建成功后自动在后台进行 AI 规范化，结果直接落库，管理员只需核查一遍
    const normalized = await this.runAutoNormalize(task, actor);
    const final = await this.tasks.save(task);
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "task_auto_normalize",
      { id: final.id, name: final.title },
      normalized.autoNormalized
        ? `创建后自动规范化提示词：${final.normalizedRequirements?.requirements.length ?? 0} 条要求（硬性 ${final.normalizedRequirements?.requirements.filter((item) => item.type === "hard").length ?? 0} 条）`
        : "创建后自动规范化提示词失败（任务已创建，可手动重试）",
      null,
      {
        id: final.id,
        normalizationStatus: final.normalizationStatus,
        ...normalized,
      },
    );
    return {
      task: publicTask(final, resolvedSceneTargets),
      ...normalized,
    };
  }

  /**
   * 管理员：编辑任务。
   * 若提示词相关内容（场景名 / 说明 / 原始要求）发生变化，保存后自动触发
   * AI 要求规范化并直接落库：成功 → ready（任务立即可用），失败 → failed（不阻断编辑，可重试）。
   * 返回 { task, autoNormalized, normalizationFailed } 供前端同步规范化信息。
   */
  async update(
    actor: PublicUser,
    id: string,
    input: UpdateTaskDto,
  ): Promise<{
    task: PublicTask;
    autoNormalized: boolean;
    normalizationFailed: boolean;
  }> {
    this.policy.requireManage(actor);
    const task = await this.findEntity(id);
    if (task.status === "closed") {
      throw new TaskFailure(
        "TASK_CLOSED",
        "已关闭的任务不可编辑",
        409,
      );
    }
    const before = publicTask(task);
    if (input.title !== undefined) task.title = input.title.trim();
    if (input.description !== undefined) {
      task.description = input.description.trim();
    }
    if (input.sceneName !== undefined) {
      task.sceneName = input.sceneName.trim();
      // 场景变化后，已确认的规范化要求可能不再适用，需要重新规范化
      task.normalizationStatus = "pending";
    }
    if (input.taskType !== undefined) {
      task.taskType = input.taskType;
    }
    if (input.categoryKey !== undefined) {
      task.categoryKey = input.categoryKey;
    }
    if (input.rawRequirements !== undefined) {
      task.rawRequirements = input.rawRequirements.trim();
      task.normalizationStatus = "pending";
    }
    if (input.pricePerHour !== undefined) {
      task.pricePerHour =
        input.pricePerHour === null
          ? null
          : input.pricePerHour.toFixed(2);
    }
    const saved = await this.tasks.save(task);
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "task_update",
      { id: task.id, name: task.title },
      `编辑采集任务 ${task.title}`,
      { title: before.title, sceneName: before.sceneName },
      {
        title: saved.title,
        sceneName: saved.sceneName,
        normalizationStatus: saved.normalizationStatus,
      },
    );

    let savedSceneTargets: Array<{
      sceneId: string;
      targetDurationSeconds: number;
    }> = [];
    if (saved.taskType === "scene_type") {
      // 仅在客户端携带非空场景目标时才校验并覆写目标，避免编辑旧任务时因
      // 现有目标缺失（空数组）被误报“至少设置一个场景目标”。空 / 未定义则保留现有目标。
      const existing =
        (await this.loadSceneTargets([saved.id])).get(saved.id) ?? [];
      if (input.sceneTargets !== undefined && input.sceneTargets.length > 0) {
        const resolved = await this.resolveSceneTypeTargets(
          actor,
          saved.categoryKey ?? undefined,
          input.sceneTargets,
        );
        saved.categoryKey = resolved.categoryKey;
        saved.targetDurationSeconds = resolved.totalTargetSeconds;
        await this.tasks.save(saved);
        await this.saveSceneTargets(saved.id, resolved.resolvedTargets);
        savedSceneTargets = resolved.resolvedTargets;
      } else {
        savedSceneTargets = existing;
      }
    }

    // 提示词相关内容是否变化（场景名 / 说明 / 原始要求）
    const promptChanged =
      saved.sceneName !== before.sceneName ||
      saved.description !== before.description ||
      saved.rawRequirements !== before.rawRequirements;

    if (!promptChanged) {
      return {
        task: publicTask(saved, savedSceneTargets),
        autoNormalized: false,
        normalizationFailed: false,
      };
    }

    let autoNormalized = false;
    let normalizationFailed = false;
    try {
      const normalized = await this.normalizer.normalize({
        sceneName: saved.sceneName,
        description: saved.description,
        rawRequirements: saved.rawRequirements,
      });
      if (normalized.requirements.length > 0) {
        saved.normalizedRequirements = normalized;
        saved.normalizationStatus = "ready";
        autoNormalized = true;
      } else {
        saved.normalizationStatus = "failed";
        normalizationFailed = true;
      }
    } catch {
      // 规范化失败不阻断编辑：任务已保存，标记 failed 供前端提示重试
      saved.normalizationStatus = "failed";
      normalizationFailed = true;
    }
    const final = await this.tasks.save(saved);
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "task_auto_normalize",
      { id: final.id, name: final.title },
      autoNormalized
        ? `编辑后自动规范化提示词：${final.normalizedRequirements?.requirements.length ?? 0} 条要求（硬性 ${final.normalizedRequirements?.requirements.filter((item) => item.type === "hard").length ?? 0} 条）`
        : `编辑后自动规范化提示词失败（任务已保存，可手动重试）`,
      { id: final.id, title: before.title },
      {
        id: final.id,
        normalizationStatus: final.normalizationStatus,
        autoNormalized,
        normalizationFailed,
      },
    );
    return {
      task: publicTask(final, savedSceneTargets),
      autoNormalized,
      normalizationFailed,
    };
  }

  /** 后台 AI 要求规范化：成功 → ready（结果落库），失败 → failed（不阻断，可重试） */
  private async runAutoNormalize(
    task: CollectionTaskEntity,
    _actor: PublicUser,
  ): Promise<{ autoNormalized: boolean; normalizationFailed: boolean }> {
    let autoNormalized = false;
    let normalizationFailed = false;
    try {
      const normalized = await this.normalizer.normalize({
        sceneName: task.sceneName,
        description: task.description,
        rawRequirements: task.rawRequirements,
      });
      if (normalized.requirements.length > 0) {
        task.normalizedRequirements = normalized;
        task.normalizationStatus = "ready";
        autoNormalized = true;
      } else {
        task.normalizationStatus = "failed";
        normalizationFailed = true;
      }
    } catch {
      task.normalizationStatus = "failed";
      normalizationFailed = true;
    }
    return { autoNormalized, normalizationFailed };
  }

  /** 管理员：仅删除尚未发布的草稿，避免破坏任务与已提交数据的追溯关系。 */
  async delete(actor: PublicUser, id: string): Promise<void> {
    this.policy.requireManage(actor);
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(CollectionTaskEntity);
      const task = await repository.findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!task) {
        throw new TaskFailure("NOT_FOUND", "采集任务不存在", 404);
      }
      const linkedSubmissionCount = await manager
        .getRepository(SubmissionEntity)
        .countBy({ taskId: task.id });
      assertTaskCanBeDeleted(task, linkedSubmissionCount);
      await this.audit.record(
        manager,
        actor,
        "task_delete",
        { id: task.id, name: task.title },
        `删除草稿采集任务 ${task.title}`,
        {
          id: task.id,
          title: task.title,
          sceneName: task.sceneName,
          status: task.status,
        },
        null,
      );
      await repository.remove(task);
    });
  }

  /** 管理员：AI 规范化预览（不落库，返回结果供确认） */
  async normalize(
    actor: PublicUser,
    id: string,
  ): Promise<{ normalized: NormalizedTaskRequirements }> {
    this.policy.requireManage(actor);
    const task = await this.findEntity(id);
    if (task.status === "closed") {
      throw new TaskFailure(
        "TASK_CLOSED",
        "已关闭的任务不可操作",
        409,
      );
    }
    const normalized = await this.normalizer.normalize({
      sceneName: task.sceneName,
      description: task.description,
      rawRequirements: task.rawRequirements,
    });
    return { normalized };
  }

  /** 管理员：确认规范化结果（管理员可在预览基础上编辑后再确认） */
  async confirmRequirements(
    actor: PublicUser,
    id: string,
    input: ConfirmNormalizedRequirementsDto,
  ): Promise<PublicTask> {
    this.policy.requireManage(actor);
    const task = await this.findEntity(id);
    if (task.status === "closed") {
      throw new TaskFailure(
        "TASK_CLOSED",
        "已关闭的任务不可操作",
        409,
      );
    }
    const normalized: NormalizedTaskRequirements = {
      scene_description: input.scene_description.trim(),
      requirements: input.requirements.map((item) => ({
        type: item.type,
        content: item.content.trim(),
        ...(item.rationale?.trim() ? { rationale: item.rationale.trim() } : {}),
      })),
      quality_notes: (input.quality_notes ?? [])
        .map((note) => note.trim())
        .filter(Boolean),
    };
    if (normalized.requirements.length === 0) {
      throw new TaskFailure(
        "VALIDATION",
        "规范化要求至少需要一条",
        400,
      );
    }
    task.normalizedRequirements = normalized;
    task.normalizationStatus = "ready";
    const saved = await this.tasks.save(task);
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "task_normalize_confirm",
      { id: task.id, name: task.title },
      `确认采集任务 ${task.title} 的 AI 规范化要求`,
      null,
      {
        requirements: normalized.requirements.length,
        hardCount: normalized.requirements.filter(
          (item) => item.type === "hard",
        ).length,
      },
    );
    return publicTask(saved);
  }

  /** 管理员：发布任务（全新场景自动加入标签字典并生成新版本） */
  async publish(actor: PublicUser, id: string): Promise<PublicTask> {
    this.policy.requireManage(actor);
    const task = await this.findEntity(id);
    if (!["draft", "paused"].includes(task.status)) {
      throw new TaskFailure(
        "TASK_NOT_PUBLISHABLE",
        "只有草稿或已暂停的任务可以发布",
        409,
      );
    }
    if (task.normalizationStatus !== "ready" || !task.normalizedRequirements) {
      throw new TaskFailure(
        "TASK_REQUIREMENTS_NOT_READY",
        "请先完成 AI 要求规范化并确认后再发布任务",
        409,
      );
    }
    // 通用任务与场景型任务不写自由文本场景标签字典（结构化场景不走标签字典）
    const sceneLabelId = null as string | null;
    const previouslyPublished = task.publishedAt !== null;
    task.sceneLabelId = sceneLabelId;
    task.status = "published";
    task.publishedAt = task.publishedAt ?? new Date();
    task.pausedAt = null;
    task.closedAt = null;
    if (previouslyPublished) task.revision += 1;
    const saved = await this.tasks.save(task);
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "task_publish",
      { id: task.id, name: task.title },
      `发布采集任务 ${task.title}（场景：${task.sceneName}，版本 V${saved.revision}）`,
      { revision: task.revision - (previouslyPublished ? 1 : 0) },
      { revision: saved.revision, status: saved.status, sceneLabelId },
    );
    return publicTask(saved);
  }

  async pause(actor: PublicUser, id: string): Promise<PublicTask> {
    this.policy.requireManage(actor);
    const task = await this.findEntity(id);
    if (task.status !== "published") {
      throw new TaskFailure(
        "TASK_NOT_PAUSABLE",
        "只有已发布的任务可以暂停",
        409,
      );
    }
    task.status = "paused";
    task.pausedAt = new Date();
    const saved = await this.tasks.save(task);
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "task_pause",
      { id: task.id, name: task.title },
      `暂停采集任务 ${task.title}`,
      { status: "published" },
      { status: "paused" },
    );
    return publicTask(saved);
  }

  async resume(actor: PublicUser, id: string): Promise<PublicTask> {
    this.policy.requireManage(actor);
    const task = await this.findEntity(id);
    if (task.status !== "paused") {
      throw new TaskFailure(
        "TASK_NOT_RESUMABLE",
        "只有已暂停的任务可以恢复",
        409,
      );
    }
    task.status = "published";
    task.pausedAt = null;
    const saved = await this.tasks.save(task);
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "task_resume",
      { id: task.id, name: task.title },
      `恢复采集任务 ${task.title}`,
      { status: "paused" },
      { status: "published" },
    );
    return publicTask(saved);
  }

  async close(actor: PublicUser, id: string): Promise<PublicTask> {
    this.policy.requireManage(actor);
    const task = await this.findEntity(id);
    if (task.status === "closed" || task.status === "draft") {
      throw new TaskFailure(
        "TASK_NOT_CLOSABLE",
        "只有已发布或已暂停的任务可以关闭",
        409,
      );
    }
    task.status = "closed";
    task.closedAt = new Date();
    const saved = await this.tasks.save(task);
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "task_close",
      { id: task.id, name: task.title },
      `关闭采集任务 ${task.title}`,
      { status: task.status },
      { status: "closed" },
    );
    return publicTask(saved);
  }

  /** 重新开启已结束的任务：恢复为发布状态，保留全部历史（提交/统计/场景目标），并记录审计 */
  async reopen(actor: PublicUser, id: string): Promise<PublicTask> {
    this.policy.requireManage(actor);
    const task = await this.findEntity(id);
    if (task.status !== "closed") {
      throw new TaskFailure(
        "TASK_NOT_REOPENABLE",
        "只有已结束的任务可以重新开启",
        409,
      );
    }
    task.status = "published";
    task.closedAt = null;
    task.pausedAt = null;
    const saved = await this.tasks.save(task);
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "task_reopen",
      { id: task.id, name: task.title },
      `重新开启采集任务 ${task.title}（可继续提交）`,
      { status: "closed" },
      { status: "published" },
    );
    return publicTask(saved);
  }

  /** 校验并归一化场景型任务的计费大类 + 按场景目标 */
  private async resolveSceneTypeTargets(
    actor: PublicUser,
    categoryKeyInput: string | undefined,
    sceneTargets: SceneTargetDto[],
  ): Promise<{
    categoryKey: string;
    totalTargetSeconds: string;
    resolvedTargets: Array<{ sceneId: string; targetDurationSeconds: number }>;
  }> {
    if (!categoryKeyInput) {
      throw new TaskFailure("VALIDATION", "场景型任务请选择计费大类", 400);
    }
    const pricing = await this.scenePricing.get(categoryKeyInput);
    if (!pricing) {
      throw new TaskFailure("VALIDATION", "计费大类不存在", 400);
    }
    if (sceneTargets.length === 0) {
      throw new TaskFailure(
        "VALIDATION",
        "场景型任务请至少设置一个场景目标",
        400,
      );
    }
    const resolvedTargets: Array<{
      sceneId: string;
      targetDurationSeconds: number;
    }> = [];
    let total = 0;
    for (const target of sceneTargets) {
      let sceneId = target.sceneId;
      if (!sceneId) {
        // 新场景：按场景名新建（同分类复用，跨分类拒绝，名称不允许重复）
        const name = target.sceneName?.trim();
        if (!name) {
          throw new TaskFailure(
            "VALIDATION",
            "请提供现有场景或填写新场景名称",
            400,
          );
        }
        sceneId = await this.ensureScene(actor, categoryKeyInput, name);
      }
      const scene = await this.scenes.findOneBy({ id: sceneId });
      if (!scene || !scene.enabled) {
        throw new TaskFailure("VALIDATION", "包含不存在或已停用的场景", 400);
      }
      if (scene.categoryKey !== categoryKeyInput) {
        throw new TaskFailure(
          "VALIDATION",
          `场景「${scene.name}」不属于所选计费大类`,
          400,
        );
      }
      total += target.targetDurationSeconds;
      resolvedTargets.push({
        sceneId,
        targetDurationSeconds: target.targetDurationSeconds,
      });
    }
    return {
      categoryKey: categoryKeyInput,
      totalTargetSeconds: String(total),
      resolvedTargets,
    };
  }

  /** 解析/新建场景：场景名不允许重复；新建场景（入库、立即出现在场景管理）并同步新增对应标签 */
  private async ensureScene(
    actor: PublicUser,
    categoryKey: string,
    name: string,
  ): Promise<string> {
    const existing = await this.scenes.findOneBy({ name });
    if (existing) {
      if (existing.categoryKey !== categoryKey) {
        throw new TaskFailure(
          "VALIDATION",
          `场景「${name}」已存在于计费大类「${existing.categoryKey}」，场景名不允许重复`,
          400,
        );
      }
      return existing.id; // 同分类下复用已有场景
    }
    const scene = await this.scenes.save(
      this.scenes.create({
        id: `SC-${randomUUID().slice(0, 8).toUpperCase()}`,
        name,
        categoryKey,
        description: "",
        enabled: true,
      }),
    );
    // 同步新增对应标签（type=scene）；标签已存在则复用
    try {
      await this.labelSets.createLabel(actor, { name, type: "scene" });
    } catch {
      // 同名标签已存在则忽略
    }
    return scene.id;
  }

  /** 保存场景型任务的按场景目标 */
  private async saveSceneTargets(
    taskId: string,
    sceneTargets: SceneTargetDto[],
  ): Promise<void> {
    await this.sceneTargets.delete({ taskId });
    const rows = sceneTargets.map((target) =>
      this.sceneTargets.create({
        id: `STT-${randomUUID().slice(0, 8).toUpperCase()}`,
        taskId,
        sceneId: target.sceneId,
        targetDurationSeconds: String(target.targetDurationSeconds),
      }),
    );
    await this.sceneTargets.save(rows);
  }

  /** 批量读取若干任务的按场景目标，按 taskId 分组（无目标的返回空数组） */
  private async loadSceneTargets(
    taskIds: string[],
  ): Promise<Map<string, Array<{ sceneId: string; targetDurationSeconds: number }>>> {
    const result = new Map<
      string,
      Array<{ sceneId: string; targetDurationSeconds: number }>
    >();
    if (taskIds.length === 0) return result;
    const rows = await this.sceneTargets
      .createQueryBuilder("st")
      .where("st.taskId IN (:...ids)", { ids: taskIds })
      .getMany();
    for (const row of rows) {
      const list = result.get(row.taskId) ?? [];
      list.push({
        sceneId: row.sceneId,
        targetDurationSeconds: numericOrNull(row.targetDurationSeconds) ?? 0,
      });
      result.set(row.taskId, list);
    }
    return result;
  }

  private async findEntity(id: string): Promise<CollectionTaskEntity> {
    const task = await this.tasks.findOneBy({ id });
    if (!task) {
      throw new TaskFailure("NOT_FOUND", "采集任务不存在", 404);
    }
    return task;
  }

  /**
   * 把任务场景名解析为标签字典中的场景标签 id。
   * 已存在（含停用）则复用；全新场景自动追加到激活标签版本并生成新版本（写入审计）。
   */
  private async resolveSceneLabelId(
    actor: PublicUser,
    task: CollectionTaskEntity,
  ): Promise<string | null> {
    const active = await this.labelSets.getActiveLabelSetForWorker();
    const existing = active?.labels.find(
      (label) =>
        label.type === "scene" && label.name === task.sceneName,
    );
    if (existing) return existing.id;
    try {
      const next = await this.labelSets.createLabel(actor, {
        name: task.sceneName,
        type: "scene",
      });
      const created = next.labels.find(
        (label) =>
          label.type === "scene" && label.name === task.sceneName,
      );
      return created?.id ?? null;
    } catch {
      // 并发发布冲突：重新读取激活版本，避免重复创建同名场景
      const refreshed = await this.labelSets.getActiveLabelSetForWorker();
      const found = refreshed?.labels.find(
        (label) =>
          label.type === "scene" && label.name === task.sceneName,
      );
      return found?.id ?? null;
    }
  }
}
