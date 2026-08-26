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
import {
  GENERIC_TASK_TEMPLATE,
  presetSceneSummaries,
  type PresetScene,
} from "./preset-scenes.js";
import { TaskFailure } from "./tasks.failure.js";
import { TasksPolicy } from "./tasks.policy.js";
import { RequirementNormalizerService } from "./requirement-normalizer.service.js";
import type {
  ConfirmNormalizedRequirementsDto,
  CreateTaskDto,
  UpdateTaskDto,
} from "./dto/tasks.dto.js";

export type PublicTask = {
  id: string;
  title: string;
  description: string;
  sceneName: string;
  sceneLabelId: string | null;
  taskType: CollectionTaskType;
  rawRequirements: string;
  normalizedRequirements: NormalizedTaskRequirements | null;
  normalizationStatus: string;
  pricePointsPerMinute: number | null;
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
  normalizedRequirements: NormalizedTaskRequirements | null;
  pricePointsPerMinute: number | null;
  status: CollectionTaskStatus;
  revision: number;
  publishedAt: number | null;
};

export function publicTask(task: CollectionTaskEntity): PublicTask {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    sceneName: task.sceneName,
    sceneLabelId: task.sceneLabelId,
    taskType: task.taskType,
    rawRequirements: task.rawRequirements,
    normalizedRequirements: task.normalizedRequirements,
    normalizationStatus: task.normalizationStatus,
    pricePointsPerMinute: numericOrNull(task.pricePointsPerMinute),
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

function publicTaskForCollector(
  task: CollectionTaskEntity,
): PublicTaskForCollector {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    sceneName: task.sceneName,
    sceneLabelId: task.sceneLabelId,
    taskType: task.taskType,
    normalizedRequirements: task.normalizedRequirements,
    pricePointsPerMinute: numericOrNull(task.pricePointsPerMinute),
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
    return {
      tasks: [...rows, ...paused].map(publicTaskForCollector),
    };
  }

  /** 管理员：任务类型选择器使用的预设场景目录（含默认模板内容） */
  async listPresetScenes(
    actor: PublicUser,
  ): Promise<{ presetScenes: PresetScene[]; generic: typeof GENERIC_TASK_TEMPLATE }> {
    this.policy.requireManage(actor);
    return {
      presetScenes: presetSceneSummaries(),
      generic: GENERIC_TASK_TEMPLATE,
    };
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
    return {
      tasks: rows.map(publicTask),
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
    if (actor.role === "admin") return publicTask(task);
    if (!COLLECTOR_VISIBLE_STATUSES.includes(task.status)) {
      throw new TaskFailure(
        "TASK_NOT_VISIBLE",
        "该任务当前不可见",
        404,
      );
    }
    return publicTaskForCollector(task);
  }

  /** 管理员：创建任务（draft） */
  async create(
    actor: PublicUser,
    input: CreateTaskDto,
  ): Promise<PublicTask> {
    this.policy.requireManage(actor);
    const task = await this.tasks.save(
      this.tasks.create({
        id: `TASK-${randomUUID().slice(0, 8)}`,
        title: input.title.trim(),
        description: input.description?.trim() ?? "",
        sceneName: input.sceneName.trim(),
        taskType: input.taskType ?? "custom",
        sceneLabelId: null,
        rawRequirements: input.rawRequirements.trim(),
        normalizedRequirements: null,
        normalizationStatus: "pending",
        pricePointsPerMinute:
          input.pricePointsPerMinute === null ||
          input.pricePointsPerMinute === undefined
            ? null
            : input.pricePointsPerMinute.toFixed(2),
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
      `创建采集任务 ${task.title}（场景：${task.sceneName}）`,
      null,
      { id: task.id, title: task.title, sceneName: task.sceneName },
    );
    return publicTask(task);
  }

  /** 管理员：编辑任务；已发布任务编辑后需重新规范化并确认 */
  async update(
    actor: PublicUser,
    id: string,
    input: UpdateTaskDto,
  ): Promise<PublicTask> {
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
    if (input.rawRequirements !== undefined) {
      task.rawRequirements = input.rawRequirements.trim();
      task.normalizationStatus = "pending";
    }
    if (input.pricePointsPerMinute !== undefined) {
      task.pricePointsPerMinute =
        input.pricePointsPerMinute === null
          ? null
          : input.pricePointsPerMinute.toFixed(2);
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
    return publicTask(saved);
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
    // 通用任务不绑定具体场景，跳过场景标签解析，避免向标签字典写入「通用」占位标签
    const sceneLabelId =
      task.taskType === "generic"
        ? null
        : await this.resolveSceneLabelId(actor, task);
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
