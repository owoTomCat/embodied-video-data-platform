import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";

import type { PublicUser } from "../auth/auth.types.js";
import { AnnotationReviewEntity } from "../database/entities/annotation-review.entity.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import {
  TaskSegmentAssetEntity,
  type TaskSegmentGenerationStatus,
} from "../database/entities/task-segment-asset.entity.js";
import { acceptedAnnotationRun } from "../delivery/delivery-annotation.js";
import { OperationsFailure } from "../operations/operations-failure.js";
import { TASK_SEGMENT_ROUTING_KEY } from "../messaging/rabbitmq-topology.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import type { TaskSegmentQueryDto } from "./dto/task-segment-query.dto.js";

export const TASK_SEGMENT_GENERATION_POLICY_VERSION =
  "task_segment_v1_policy_v1" as const;
/** SEG-DEC-002：pre/post padding（毫秒），正式规则为前后各 0.5s */
export const TASK_SEGMENT_PADDING_MS = 500;
/** SEG-DEC-003：最短片段时长（毫秒），按 padding 后的实际片段长度判定 */
export const TASK_SEGMENT_MIN_CLIP_MS = 3_000;
type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function jsonSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function requireAdmin(actor: PublicUser): void {
  if (actor.role !== "admin") {
    throw new OperationsFailure("FORBIDDEN", "仅管理员可管理任务片段 Demo", 403);
  }
}

function publicAsset(asset: TaskSegmentAssetEntity) {
  return {
    id: asset.id,
    submissionId: asset.submissionId,
    annotationRunId: asset.annotationRunId,
    taskIndex: asset.taskIndex,
    pipelineVersion: asset.pipelineVersion,
    promptVersion: asset.promptVersion,
    schemaVersion: asset.schemaVersion,
    evidencePolicyVersion: asset.evidencePolicyVersion,
    ontologyVersion: asset.ontologyVersion,
    taskLabel: asset.taskLabel,
    taskVerb: asset.taskVerb,
    completion: asset.completion,
    resultStatus: asset.resultStatus,
    sourceStartMs: asset.sourceStartMs,
    sourceEndMs: asset.sourceEndMs,
    clipStartMs: asset.clipStartMs,
    clipEndMs: asset.clipEndMs,
    coverageSnapshot: asset.coverageSnapshot,
    evidenceSnapshot: asset.evidenceSnapshot,
    validationWarnings: asset.validationWarnings,
    sourceObjectKey: asset.sourceObjectKey,
    sourceSha256: asset.sourceSha256,
    clipObjectKey: asset.clipObjectKey,
    clipSha256: asset.clipSha256,
    clipSizeBytes: asset.clipSizeBytes,
    clipDurationMs: asset.clipDurationMs,
    codec: asset.codec,
    width: asset.width,
    height: asset.height,
    frameRate: asset.frameRate,
    hasAudio: asset.hasAudio,
    generationStatus: asset.generationStatus,
    attemptCount: asset.attemptCount,
    failureCode: asset.failureCode,
    failureMessage: asset.failureMessage,
    usageStatus: asset.usageStatus,
    generationPolicyVersion: asset.generationPolicyVersion,
    createdAt: asset.createdAt.getTime(),
    startedAt: asset.startedAt?.getTime() ?? null,
    completedAt: asset.completedAt?.getTime() ?? null,
    updatedAt: asset.updatedAt.getTime(),
  };
}

function clipObjectKey(input: {
  submissionId: string;
  annotationRunId: string;
  taskIndex: number;
}): string {
  return `task-segments/demo/${input.submissionId}/${input.annotationRunId}/task-${input.taskIndex}.mp4`;
}

function evidenceSnapshot(task: JsonRecord): JsonRecord {
  return jsonSnapshot({
    evidenceLevel: task.evidence_level ?? null,
    evidenceTimestampsMs: task.evidence_timestamps_ms ?? [],
    resultObservability: task.result_observability ?? null,
    resultEvidenceType: task.result_evidence_type ?? null,
    resultEvidenceTimestampsMs: task.result_evidence_timestamps_ms ?? [],
    failureRecovery: task.effective_failure_recovery ?? task.failure_recovery ?? null,
    failureEvidenceTimestampsMs: task.failure_evidence_timestamps_ms ?? [],
    recoveryEvidenceTimestampsMs: task.recovery_evidence_timestamps_ms ?? [],
    uncertaintyReasons: task.uncertainty_reasons ?? [],
    confidence: task.confidence ?? null,
  });
}

function timestampWarnings(input: {
  task: JsonRecord;
  coverage: JsonRecord[];
  taskCount: number;
  durationMs: number;
}): string[] {
  const warnings: string[] = [];
  const check = (values: unknown, path: string) => {
    if (!Array.isArray(values)) return;
    for (const value of values) {
      const timestamp = finiteNumber(value);
      if (timestamp === null || timestamp < 0 || timestamp > input.durationMs) {
        warnings.push(`${path} contains an out-of-range timestamp: ${String(value)}`);
      }
    }
  };
  check(input.task.evidence_timestamps_ms, "task.evidence_timestamps_ms");
  check(input.task.result_evidence_timestamps_ms, "task.result_evidence_timestamps_ms");
  check(input.task.failure_evidence_timestamps_ms, "task.failure_evidence_timestamps_ms");
  check(input.task.recovery_evidence_timestamps_ms, "task.recovery_evidence_timestamps_ms");
  for (const [index, segment] of input.coverage.entries()) {
    check(segment.evidence_timestamps_ms, `coverage_segments[${index}].evidence_timestamps_ms`);
    const linked = segment.linked_task_index;
    if (
      linked !== null &&
      linked !== undefined &&
      (!Number.isInteger(linked) || Number(linked) < 0 || Number(linked) >= input.taskCount)
    ) {
      warnings.push(`coverage_segments[${index}].linked_task_index is invalid: ${String(linked)}`);
    }
    const start = finiteNumber(segment.start_ms);
    const end = finiteNumber(segment.end_ms);
    if (start === null || end === null || start < 0 || end <= start || end > input.durationMs) {
      warnings.push(`coverage_segments[${index}] has an out-of-range interval`);
    }
  }
  return warnings;
}

async function enqueueAsset(
  manager: EntityManager,
  asset: TaskSegmentAssetEntity,
  now = new Date(),
): Promise<void> {
  const repository = manager.getRepository(JobOutboxEntity);
  const existing = await repository.findOneBy({
    eventType: TASK_SEGMENT_ROUTING_KEY,
    aggregateId: asset.id,
  });
  const payload = { assetId: asset.id, submissionId: asset.submissionId };
  if (existing) {
    existing.aggregateType = "task_segment_asset";
    existing.payload = payload;
    existing.status = "pending";
    existing.availableAt = now;
    existing.publishedAt = null;
    existing.lastError = null;
    await repository.save(existing);
    return;
  }
  await repository.save({
    id: `JOB-${randomUUID()}`,
    aggregateType: "task_segment_asset",
    aggregateId: asset.id,
    eventType: TASK_SEGMENT_ROUTING_KEY,
    payload,
    status: "pending",
    attempts: 0,
    availableAt: now,
  });
}

@Injectable()
export class TaskSegmentService {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async generate(actor: PublicUser, runId: string) {
    requireAdmin(actor);
    return this.dataSource.transaction(async (manager) => {
      const run = await manager.getRepository(AnnotationRunEntity).findOne({
        where: { id: runId },
        lock: { mode: "pessimistic_write" },
      });
      if (!run) throw new OperationsFailure("NOT_FOUND", "Annotation Run 不存在", 404);
      return this.enqueueForPublishedRun(manager, run);
    });
  }

  /**
   * 为已正式发布的 Run 创建任务切片资产并进入生成队列（幂等）。
   * 管理员手动触发（generate）与 Run 正式发布自动触发共用此入口；
   * 必须在调用方事务内执行，复用调用方已锁定的 Run。
   */
  async enqueueForPublishedRun(
    manager: EntityManager,
    run: AnnotationRunEntity,
  ): Promise<{
    annotationRunId: string;
    taskCount: number;
    created: number;
    existing: number;
    skipped: number;
  }> {
    const submission = await manager.getRepository(SubmissionEntity).findOneBy({
      id: run.submissionId,
    });
    const metadata = await manager.getRepository(MediaMetadataEntity).findOneBy({
      submissionId: run.submissionId,
    });
    if (!submission || !metadata) {
      throw new OperationsFailure("SOURCE_METADATA_MISSING", "原视频或媒体元数据不存在", 409);
    }
    const review = run.reviewRevision > 0
      ? await manager.getRepository(AnnotationReviewEntity).findOneBy({
          annotationRunId: run.id,
          revision: run.reviewRevision,
        })
      : null;
    const accepted = acceptedAnnotationRun(run, review);
    if (!accepted) {
      const snapshot = run.normalizedResult as Record<string, unknown> | null;
      console.log("[tsg-dbg] not published:", JSON.stringify({
        exec: run.executionStatus, pub: run.publicationStatus, review: run.reviewStatus,
        reviewRev: run.reviewRevision, elig: run.autoEligibility, gateVer: run.autoGateVersion,
        candSchema: snapshot?.schemaVersion, runSchema: run.schemaVersion,
        candPolicy: snapshot?.policyVersion, runPolicy: run.evidencePolicyVersion,
        candPrompt: snapshot?.promptVersion, runPrompt: run.promptVersion,
        candSha: snapshot?.promptContentSha256, runSha: run.promptContentSha256,
        candModel: snapshot?.model, runModel: run.model,
        hasExample: Boolean(run.outputExampleSnapshot),
        hasSystemPrompt: Boolean(run.systemPromptSnapshot),
        errors: (snapshot?.validation as Record<string, unknown> | undefined)?.errors,
        issues: (run.autoGateIssues ?? []).map((issue) => `${issue.level}:${issue.resolution}`),
      }));
      throw new OperationsFailure(
        "ANNOTATION_RUN_NOT_PUBLISHED",
        "只允许从当前正式 auto_accepted 或 human_verified Run 生成片段",
        409,
      );
    }
    const tasks = Array.isArray(accepted.effective.tasks)
      ? accepted.effective.tasks
      : [];
    const coverage = Array.isArray(accepted.effective.coverage_segments)
      ? accepted.effective.coverage_segments
          .map(record)
          .filter((value): value is JsonRecord => value !== null)
      : [];
    const durationMs = Math.round(Number(metadata.durationSeconds) * 1_000);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new OperationsFailure("SOURCE_METADATA_INVALID", "原视频时长无效", 409);
    }
    const repository = manager.getRepository(TaskSegmentAssetEntity);
    const existing = await repository.findBy({ annotationRunId: run.id });
    const existingByTask = new Map(existing.map((asset) => [asset.taskIndex, asset]));
    let created = 0;
    let existingCount = 0;
    let skipped = 0;

    for (const [taskIndex, value] of tasks.entries()) {
      if (existingByTask.has(taskIndex)) {
        existingCount += 1;
        continue;
      }
      const task = record(value);
      if (!task) {
        throw new OperationsFailure("ANNOTATION_TASK_INVALID", `Task ${taskIndex} 不是对象`, 409);
      }
      const startMs = finiteNumber(task.start_ms) ?? 0;
      const endMs = finiteNumber(task.end_ms) ?? 0;
      // SEG-DEC-005：completion=uncertain（采样不足以区分）不入库，
      // 记录 skipped + 原因码，保留审计链；failed/incomplete/complete/partial 均保留状态入库。
      const completion = stringValue(task.effective_completion ?? task.completion, "uncertain");
      let clipStartMs = startMs;
      let clipEndMs = endMs;
      let generationStatus: TaskSegmentGenerationStatus = "queued";
      let failureCode: string | null = null;
      let failureMessage: string | null = null;
      if (startMs < 0 || endMs <= startMs) {
        generationStatus = "skipped";
        failureCode = "INVALID_TIME_RANGE";
        failureMessage = `Task ${taskIndex} 的时间区间无效：${startMs}ms → ${endMs}ms`;
      } else if (endMs > durationMs) {
        generationStatus = "skipped";
        failureCode = "END_EXCEEDS_SOURCE_DURATION";
        failureMessage = `Task ${taskIndex} 结束时间 ${endMs}ms 超过原视频 ${durationMs}ms`;
      } else if (completion === "uncertain") {
        generationStatus = "skipped";
        failureCode = "TASK_STATUS_UNCERTAIN";
        failureMessage = `Task ${taskIndex} 的 completion=uncertain（采样不足以区分），不入库`;
      } else {
        // SEG-DEC-002：前后各 0.5s padding，clamp 到视频范围
        clipStartMs = Math.max(0, startMs - TASK_SEGMENT_PADDING_MS);
        clipEndMs = Math.min(durationMs, endMs + TASK_SEGMENT_PADDING_MS);
        if (clipEndMs - clipStartMs < TASK_SEGMENT_MIN_CLIP_MS) {
          generationStatus = "skipped";
          failureCode = "TASK_TOO_SHORT";
          failureMessage =
            `Task ${taskIndex} padding 后片段长度 ${clipEndMs - clipStartMs}ms ` +
            `小于最短 ${TASK_SEGMENT_MIN_CLIP_MS}ms（任务区间 ${startMs}ms → ${endMs}ms）`;
        }
      }
      const linkedCoverage = coverage.filter(
        (segment) => segment.linked_task_index === taskIndex,
      );
      const asset = repository.create({
        id: `TSA-${randomUUID()}`,
        submissionId: submission.id,
        annotationRunId: run.id,
        taskIndex,
        pipelineVersion: run.pipelineVersion,
        promptVersion: run.promptVersion!,
        schemaVersion: run.schemaVersion,
        evidencePolicyVersion: run.evidencePolicyVersion,
        ontologyVersion: run.labelSetVersionId,
        taskLabel: stringValue(task.task_label, `Task ${taskIndex + 1}`),
        taskVerb: stringValue(task.task_verb, "uncertain"),
        completion,
        resultStatus: stringValue(task.effective_result_status ?? task.result_status, "unknown"),
        sourceStartMs: startMs,
        sourceEndMs: endMs,
        clipStartMs,
        clipEndMs,
        coverageSnapshot: jsonSnapshot(linkedCoverage),
        evidenceSnapshot: evidenceSnapshot(task),
        validationWarnings: timestampWarnings({
          task,
          coverage,
          taskCount: tasks.length,
          durationMs,
        }),
        sourceObjectKey: submission.objectKey,
        sourceSha256: submission.checksumSha256,
        clipObjectKey: clipObjectKey({
          submissionId: submission.id,
          annotationRunId: run.id,
          taskIndex,
        }),
        generationStatus,
        failureCode,
        failureMessage,
        completedAt: generationStatus === "skipped" ? new Date() : null,
        usageStatus: "internal_only",
        generationPolicyVersion: TASK_SEGMENT_GENERATION_POLICY_VERSION,
      });
      await repository.save(asset);
      if (generationStatus === "queued") await enqueueAsset(manager, asset);
      else skipped += 1;
      created += 1;
    }

    return {
      annotationRunId: run.id,
      taskCount: tasks.length,
      created,
      existing: existingCount,
      skipped,
    };
  }
  async retry(actor: PublicUser, assetId: string) {
    requireAdmin(actor);
    const asset = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(TaskSegmentAssetEntity);
      const current = await repository.findOne({
        where: { id: assetId },
        lock: { mode: "pessimistic_write" },
      });
      if (!current) throw new OperationsFailure("NOT_FOUND", "任务片段资产不存在", 404);
      if (!(["failed", "skipped"] as TaskSegmentGenerationStatus[]).includes(current.generationStatus)) {
        throw new OperationsFailure("TASK_SEGMENT_NOT_RETRYABLE", "只有 failed 或 skipped 资产可以显式重试", 409);
      }
      current.generationStatus = "queued";
      current.failureCode = null;
      current.failureMessage = null;
      current.startedAt = null;
      current.completedAt = null;
      await repository.save(current);
      await enqueueAsset(manager, current);
      return current;
    });
    return { asset: publicAsset(asset) };
  }

  async list(actor: PublicUser, input: TaskSegmentQueryDto) {
    requireAdmin(actor);
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    const query = this.dataSource.getRepository(TaskSegmentAssetEntity)
      .createQueryBuilder("asset")
      .orderBy("asset.createdAt", "DESC")
      .addOrderBy("asset.id", "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize);
    if (input.annotationRunId) {
      query.andWhere("asset.annotationRunId = :annotationRunId", {
        annotationRunId: input.annotationRunId,
      });
    }
    if (input.submissionId) {
      query.andWhere("asset.submissionId = :submissionId", {
        submissionId: input.submissionId,
      });
    }
    if (input.status) {
      query.andWhere("asset.generationStatus = :status", { status: input.status });
    }
    const [assets, total] = await query.getManyAndCount();
    return {
      assets: assets.map(publicAsset),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
    };
  }

  async get(actor: PublicUser, assetId: string) {
    requireAdmin(actor);
    const asset = await this.dataSource.getRepository(TaskSegmentAssetEntity).findOneBy({ id: assetId });
    if (!asset) throw new OperationsFailure("NOT_FOUND", "任务片段资产不存在", 404);
    return { asset: publicAsset(asset) };
  }

  async preview(actor: PublicUser, assetId: string) {
    requireAdmin(actor);
    const asset = await this.dataSource.getRepository(TaskSegmentAssetEntity).findOneBy({ id: assetId });
    if (!asset) throw new OperationsFailure("NOT_FOUND", "任务片段资产不存在", 404);
    if (asset.generationStatus !== "ready" || !asset.clipObjectKey) {
      throw new OperationsFailure("TASK_SEGMENT_NOT_READY", "只有 ready 资产可以预览", 409);
    }
    try {
      const signed = await this.storage.presignDownloadObject({
        objectKey: asset.clipObjectKey,
        expiresInSeconds: 15 * 60,
      });
      return {
        assetId: asset.id,
        url: signed.url,
        contentType: "video/mp4",
        expiresAt: signed.expiresAt.getTime(),
      };
    } catch (error) {
      throw new OperationsFailure(
        "TASK_SEGMENT_PREVIEW_FAILED",
        error instanceof Error ? error.message.slice(0, 1_000) : "片段预览地址生成失败",
        503,
      );
    }
  }
}
