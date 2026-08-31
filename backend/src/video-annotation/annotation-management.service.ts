import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { DataSource, In, Not } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { AnnotationCorrectionEntity } from "../database/entities/annotation-correction.entity.js";
import { AnnotationModelCallEntity } from "../database/entities/annotation-model-call.entity.js";
import { AnnotationReviewEntity } from "../database/entities/annotation-review.entity.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { SubmissionFailure } from "../submissions/submission-failure.js";
import {
  normalizeVideoAnnotation,
  parseRawVideoAnnotation,
  type RawVideoAnnotation,
} from "./video-annotation.js";
import {
  createQueuedAnnotationRun,
  enqueueAnnotationRun,
} from "./annotation-run.queue.js";
import type {
  AnnotationCorrectionDto,
  DiscardAnnotationRunDto,
  ReviewAnnotationRunDto,
} from "./dto/annotation-run.dto.js";

const ALLOWED_CORRECTION_PATHS = [
  /^video_summary$/u,
  /^scene\.(?:coarse_label|fine_label|confidence)$/u,
  /^temporal_structure_type$/u,
  /^model_assessability$/u,
  /^assessability_reason$/u,
  /^tasks\[\d+\]\.(?:task_label|task_verb|task_object|evidence_level|execution_pattern|manipulated_objects|tools|hand_mode|interaction_primitives|completion|result_observability|result_status|result_evidence_type|visible_postcondition|failure_recovery|complexity_signals|uncertainty_reasons|confidence)$/u,
  /^uncertain_fields$/u,
  /^global_limitations$/u,
] as const;

function publicRun(
  run: AnnotationRunEntity,
  review?: AnnotationReviewEntity,
  corrections: AnnotationCorrectionEntity[] = [],
  modelCalls: AnnotationModelCallEntity[] = [],
) {
  return {
    id: run.id,
    submissionId: run.submissionId,
    trigger: run.trigger,
    pipelineVersion: run.pipelineVersion,
    schemaVersion: run.schemaVersion,
    evidencePolicyVersion: run.evidencePolicyVersion,
    promptVersion: run.promptVersion,
    promptContentSha256: run.promptContentSha256,
    model: run.model,
    labelSetVersionId: run.labelSetVersionId,
    labelSetRevision: run.labelSetRevision,
    executionStatus: run.executionStatus,
    reviewStatus: run.reviewStatus,
    publicationStatus: run.publicationStatus,
    attemptCount: run.attemptCount,
    fullModelAttempts: run.fullModelAttempts,
    schemaRepairCalls: run.schemaRepairCalls,
    targetedRepairCalls: run.targetedRepairCalls,
    infrastructureRetryCount: run.infrastructureRetryCount,
    providerCallCount: run.providerCallCount,
    reviewRevision: run.reviewRevision,
    autoEligibility: run.autoEligibility,
    autoGateVersion: run.autoGateVersion,
    autoGateIssues: run.autoGateIssues,
    wouldAutoAccept: run.wouldAutoAccept,
    autoAcceptEnabledSnapshot: run.autoAcceptEnabledSnapshot,
    autoGateEvaluatedAt: run.autoGateEvaluatedAt?.getTime() ?? null,
    auditStatus: run.auditStatus,
    auditSelectedAt: run.auditSelectedAt?.getTime() ?? null,
    lastErrorCode: run.lastErrorCode,
    lastErrorMessage: run.lastErrorMessage,
    nextRetryAt: run.nextRetryAt?.getTime() ?? null,
    candidate: run.normalizedResult,
    humanResult: run.humanResult,
    review: review
      ? {
          id: review.id,
          revision: review.revision,
          disposition: review.disposition,
          reviewKind: review.reviewKind,
          reviewedFields: review.reviewedFields,
          reasonCodes: review.reasonCodes,
          reviewDurationMs: review.reviewDurationMs,
          reason: review.reason,
          reviewerAccountId: review.reviewerAccountId,
          reviewerName: review.reviewerName,
          createdAt: review.createdAt.getTime(),
        }
      : null,
    modelCalls: modelCalls.map((call) => ({
      id: call.id,
      logicalFullAttempt: call.logicalFullAttempt,
      callKind: call.callKind,
      callStatus: call.callStatus,
      httpStatus: call.httpStatus,
      providerRequestId: call.providerRequestId,
      responseModel: call.responseModel,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      totalTokens: call.totalTokens,
      latencyMs: call.latencyMs,
      errorCode: call.errorCode,
      errorMessage: call.errorMessage,
      createdAt: call.createdAt.getTime(),
    })),
    corrections: corrections.map((correction) => ({
      id: correction.id,
      targetType: correction.targetType,
      targetId: correction.targetId,
      fieldPath: correction.fieldPath,
      previousValue: correction.previousValue,
      nextValue: correction.nextValue,
      reasonCode: correction.reasonCode,
      comment: correction.comment,
      reviewerAccountId: correction.reviewerAccountId,
      createdAt: correction.createdAt.getTime(),
    })),
    queuedAt: run.queuedAt.getTime(),
    startedAt: run.startedAt?.getTime() ?? null,
    completedAt: run.completedAt?.getTime() ?? null,
    createdAt: run.createdAt.getTime(),
    updatedAt: run.updatedAt.getTime(),
  };
}

function requireRead(actor: PublicUser, submission: SubmissionEntity): void {
  if (actor.role === "admin") return;
  if (actor.role === "leader" && actor.teamId === submission.teamId) return;
  if (actor.role === "collector" && actor.id === submission.ownerId) return;
  throw new SubmissionFailure("FORBIDDEN", "无权查看该视频标注", 403);
}

function requireReview(actor: PublicUser, submission: SubmissionEntity): void {
  if (actor.role === "admin") return;
  if (actor.role === "leader" && actor.teamId === submission.teamId) return;
  throw new SubmissionFailure("FORBIDDEN", "无权复核该视频标注", 403);
}

function requireAdmin(actor: PublicUser): void {
  if (actor.role === "admin") return;
  throw new SubmissionFailure("FORBIDDEN", "仅管理员可重跑候选标注", 403);
}

function pathTokens(path: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  for (const segment of path.split(".")) {
    const match = /^([a-z_]+)(?:\[(\d+)\])?$/u.exec(segment);
    if (!match) throw new SubmissionFailure("ANNOTATION_FIELD_PATH_INVALID", `字段路径无效：${path}`, 400);
    tokens.push(match[1]!);
    if (match[2] !== undefined) tokens.push(Number(match[2]));
  }
  return tokens;
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const token of pathTokens(path)) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[token];
  }
  return current;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedPaths(left: unknown, right: unknown, prefix = ""): string[] {
  if (sameValue(left, right)) return [];
  if (Array.isArray(left) || Array.isArray(right)) {
    if (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value) => value !== null && typeof value === "object" && !Array.isArray(value)) &&
      right.every((value) => value !== null && typeof value === "object" && !Array.isArray(value))
    ) {
      return left.flatMap((value, index) =>
        changedPaths(value, right[index], `${prefix}[${index}]`),
      );
    }
    return prefix ? [prefix] : ["result"];
  }
  if (
    left &&
    right &&
    typeof left === "object" &&
    typeof right === "object"
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);
    return [...keys].flatMap((key) =>
      changedPaths(
        leftRecord[key],
        rightRecord[key],
        prefix ? `${prefix}.${key}` : key,
      ),
    );
  }
  return prefix ? [prefix] : ["result"];
}

function correctionPathAllowed(path: string): boolean {
  return ALLOWED_CORRECTION_PATHS.some((pattern) => pattern.test(path));
}

function correctionIdentity(path: string): {
  targetType: AnnotationCorrectionDto["targetType"];
  targetId: string;
} {
  if (path.startsWith("scene.")) {
    return { targetType: "scene", targetId: "scene" };
  }
  const task = /^tasks\[(\d+)\]\.([a-z_]+)$/u.exec(path);
  if (!task) return { targetType: "annotation", targetId: "video" };
  const field = task[2]!;
  const targetType = field === "tools"
    ? "tool"
    : field === "manipulated_objects"
      ? "object"
      : field === "interaction_primitives"
        ? "interaction"
        : field === "completion"
          ? "completion"
          : field === "failure_recovery"
            ? "failure_recovery"
            : field === "evidence_level"
              ? "evidence"
              : field.startsWith("result_") || field === "visible_postcondition"
                ? "outcome"
                : "task_segment";
  return { targetType, targetId: `task-${task[1]}` };
}

function normalizedHumanResult(input: {
  run: AnnotationRunEntity;
  raw: RawVideoAnnotation;
  durationMs: number;
}): Record<string, unknown> {
  const normalized = normalizeVideoAnnotation({
    raw: input.raw,
    frames: input.run.sourceTimestampsMs.map((timestampMs) => ({
      timestampMs,
      dataUrl: "data:image/jpeg;base64,",
    })),
    durationMs: input.durationMs,
    promptVersion: input.run.promptVersion ?? "",
    promptContentSha256: input.run.promptContentSha256 ?? "",
    model: input.run.model ?? "",
    requestId: null,
    modelDurationMs: 0,
    enabledLabels: (input.run.labelSetSnapshot?.labels ?? []).flatMap((label) =>
      label.enabled &&
      (label.type === "scene" || label.type === "action" || label.type === "object")
        ? [{ id: label.id, name: label.name, type: label.type }]
        : [],
    ),
  });
  if (normalized.validation.errors.length > 0) {
    throw new SubmissionFailure(
      "ANNOTATION_CORRECTION_EVIDENCE_INVALID",
      `修正标注证据校验失败：${normalized.validation.errors.slice(0, 10).join("；")}`,
      400,
    );
  }
  return JSON.parse(JSON.stringify({
    source: "human_correction",
    schemaVersion: normalized.schemaVersion,
    policyVersion: normalized.policyVersion,
    raw: input.raw,
    effective: normalized.effective,
    labelMappings: normalized.labelMappings,
    validation: normalized.validation,
  })) as Record<string, unknown>;
}

@Injectable()
export class AnnotationManagementService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async list(actor: PublicUser, submissionId: string) {
    const submission = await this.dataSource.getRepository(SubmissionEntity).findOneBy({
      id: submissionId,
    });
    if (!submission) throw new SubmissionFailure("NOT_FOUND", "视频提交不存在", 404);
    requireRead(actor, submission);
    const runs = await this.dataSource.getRepository(AnnotationRunEntity).find({
      where: { submissionId },
      order: { createdAt: "DESC", id: "DESC" },
    });
    if (runs.length === 0) return { runs: [] };
    const runIds = runs.map((run) => run.id);
    const [reviews, corrections] = await Promise.all([
      this.dataSource.getRepository(AnnotationReviewEntity).find({
        where: { annotationRunId: In(runIds) },
        order: { revision: "DESC" },
      }),
      this.dataSource.getRepository(AnnotationCorrectionEntity).find({
        where: { annotationRunId: In(runIds) },
        order: { createdAt: "ASC", id: "ASC" },
      }),
    ]);
    const latestReviews = new Map<string, AnnotationReviewEntity>();
    for (const review of reviews) {
      if (!latestReviews.has(review.annotationRunId)) {
        latestReviews.set(review.annotationRunId, review);
      }
    }
    return {
      runs: runs.map((run) =>
        publicRun(
          run,
          latestReviews.get(run.id),
          corrections.filter((correction) => correction.annotationRunId === run.id),
        ),
      ),
    };
  }

  async get(actor: PublicUser, runId: string) {
    const run = await this.dataSource.getRepository(AnnotationRunEntity).findOneBy({ id: runId });
    if (!run) throw new SubmissionFailure("NOT_FOUND", "候选标注运行不存在", 404);
    const submission = await this.dataSource.getRepository(SubmissionEntity).findOneBy({
      id: run.submissionId,
    });
    if (!submission) throw new SubmissionFailure("NOT_FOUND", "视频提交不存在", 404);
    requireRead(actor, submission);
    const [review, corrections, modelCalls] = await Promise.all([
      this.dataSource.getRepository(AnnotationReviewEntity).findOne({
        where: { annotationRunId: run.id },
        order: { revision: "DESC" },
      }),
      this.dataSource.getRepository(AnnotationCorrectionEntity).find({
        where: { annotationRunId: run.id },
        order: { createdAt: "ASC", id: "ASC" },
      }),
      this.dataSource.getRepository(AnnotationModelCallEntity).find({
        where: { annotationRunId: run.id },
        order: { createdAt: "ASC", id: "ASC" },
      }),
    ]);
    return { run: publicRun(run, review ?? undefined, corrections, modelCalls) };
  }

  async createNewVersion(actor: PublicUser, submissionId: string, reason: string) {
    requireAdmin(actor);
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 2) {
      throw new SubmissionFailure("VALIDATION", "请填写重跑原因", 400);
    }
    return this.dataSource.transaction(async (manager) => {
      const submission = await manager.getRepository(SubmissionEntity).findOne({
        where: { id: submissionId },
        lock: { mode: "pessimistic_write" },
      });
      if (!submission) throw new SubmissionFailure("NOT_FOUND", "视频提交不存在", 404);
      if (submission.uploadStatus !== "uploaded" || submission.storageStatus !== "available") {
        throw new SubmissionFailure("ANNOTATION_SOURCE_UNAVAILABLE", "视频源文件当前不可用于标注", 409);
      }
      const active = await manager
        .getRepository(AnnotationRunEntity)
        .createQueryBuilder("run")
        .setLock("pessimistic_write")
        .where("run.submission_id = :submissionId", { submissionId })
        .andWhere(`(
          run.execution_status IN ('queued', 'running', 'retry_scheduled')
          OR (
            run.execution_status = 'succeeded'
            AND run.review_status = 'pending'
            AND run.publication_status = 'candidate_only'
          )
        )`)
        .getOne();
      if (active) {
        throw new SubmissionFailure("ANNOTATION_RUN_ACTIVE", "当前已有未结束的候选标注运行", 409);
      }
      const run = await createQueuedAnnotationRun(manager, submissionId, "manual");
      await this.audit.record(
        manager,
        actor,
        "annotation.run.create",
        { id: submission.id, name: submission.originalFileName },
        trimmedReason,
        null,
        { runId: run.id, trigger: run.trigger },
      );
      return { run: publicRun(run) };
    });
  }

  async retry(actor: PublicUser, runId: string, reason: string) {
    requireAdmin(actor);
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 2) {
      throw new SubmissionFailure("VALIDATION", "请填写重试原因", 400);
    }
    const existing = await this.dataSource.getRepository(AnnotationRunEntity).findOneBy({ id: runId });
    if (!existing) throw new SubmissionFailure("NOT_FOUND", "候选标注运行不存在", 404);
    return this.dataSource.transaction(async (manager) => {
      const submission = await manager.getRepository(SubmissionEntity).findOne({
        where: { id: existing.submissionId },
        lock: { mode: "pessimistic_write" },
      });
      if (!submission) throw new SubmissionFailure("NOT_FOUND", "视频提交不存在", 404);
      const repository = manager.getRepository(AnnotationRunEntity);
      const run = await repository.findOne({
        where: { id: runId },
        lock: { mode: "pessimistic_write" },
      });
      if (!run) throw new SubmissionFailure("NOT_FOUND", "候选标注运行不存在", 404);
      if (run.submissionId !== submission.id) {
        throw new SubmissionFailure("ANNOTATION_RUN_CONFLICT", "候选标注所属视频已变化", 409);
      }
      if (submission.uploadStatus !== "uploaded" || submission.storageStatus !== "available") {
        throw new SubmissionFailure("ANNOTATION_SOURCE_UNAVAILABLE", "视频源文件当前不可用于标注", 409);
      }
      if (!["system_failed", "stuck"].includes(run.executionStatus)) {
        throw new SubmissionFailure("ANNOTATION_RETRY_INVALID", "当前运行状态不允许重试", 409);
      }
      if (run.fullModelAttempts >= 2) {
        throw new SubmissionFailure(
          "ANNOTATION_FULL_MODEL_BUDGET_EXHAUSTED",
          "完整模型调用预算已耗尽，请创建新版本运行",
          409,
        );
      }
      const otherActive = await repository.findOne({
        where: {
          id: Not(run.id),
          submissionId: run.submissionId,
          executionStatus: In(["queued", "running", "retry_scheduled"]),
        },
        lock: { mode: "pessimistic_write" },
      });
      if (otherActive) {
        throw new SubmissionFailure(
          "ANNOTATION_RUN_ACTIVE",
          "当前已有其他未结束的候选标注运行",
          409,
        );
      }
      const before = { executionStatus: run.executionStatus, attemptCount: run.attemptCount };
      run.executionStatus = "queued";
      run.queuedAt = new Date();
      run.startedAt = null;
      run.completedAt = null;
      run.nextRetryAt = null;
      run.lastErrorCode = null;
      run.lastErrorMessage = null;
      await repository.save(run);
      await enqueueAnnotationRun(manager, run);
      await this.audit.record(
        manager,
        actor,
        "annotation.run.retry",
        { id: submission.id, name: submission.originalFileName },
        trimmedReason,
        before,
        { runId: run.id, executionStatus: run.executionStatus, attemptCount: run.attemptCount },
      );
      return { run: publicRun(run) };
    });
  }

  async discard(actor: PublicUser, runId: string, input: DiscardAnnotationRunDto) {
    requireAdmin(actor);
    const existing = await this.dataSource.getRepository(AnnotationRunEntity).findOneBy({ id: runId });
    if (!existing) throw new SubmissionFailure("NOT_FOUND", "候选标注运行不存在", 404);
    return this.dataSource.transaction(async (manager) => {
      const submission = await manager.getRepository(SubmissionEntity).findOne({
        where: { id: existing.submissionId },
        lock: { mode: "pessimistic_write" },
      });
      if (!submission) throw new SubmissionFailure("NOT_FOUND", "视频提交不存在", 404);
      const repository = manager.getRepository(AnnotationRunEntity);
      const run = await repository.findOne({
        where: { id: runId },
        lock: { mode: "pessimistic_write" },
      });
      if (!run || run.submissionId !== submission.id) {
        throw new SubmissionFailure("ANNOTATION_RUN_CONFLICT", "候选标注运行已变化", 409);
      }
      if (
        run.executionStatus !== "succeeded" ||
        run.reviewStatus !== "pending" ||
        run.publicationStatus !== "candidate_only"
      ) {
        throw new SubmissionFailure("ANNOTATION_DISCARD_INVALID", "当前运行不是可废弃的待复核候选", 409);
      }
      if (input.expectedReviewRevision !== run.reviewRevision) {
        throw new SubmissionFailure("ANNOTATION_REVIEW_CONFLICT", "标注已被更新，请刷新后重试", 409);
      }
      run.publicationStatus = "superseded";
      await repository.save(run);
      await this.audit.record(
        manager,
        actor,
        "annotation.run.discard",
        { id: submission.id, name: submission.originalFileName },
        input.reason.trim(),
        {
          runId: run.id,
          executionStatus: run.executionStatus,
          reviewStatus: run.reviewStatus,
          publicationStatus: "candidate_only",
        },
        {
          runId: run.id,
          publicationStatus: run.publicationStatus,
          reasonCode: input.reasonCode,
        },
      );
      return { run: publicRun(run) };
    });
  }

  async review(actor: PublicUser, runId: string, input: ReviewAnnotationRunDto) {
    const existing = await this.dataSource.getRepository(AnnotationRunEntity).findOneBy({ id: runId });
    if (!existing) throw new SubmissionFailure("NOT_FOUND", "候选标注运行不存在", 404);
    return this.dataSource.transaction(async (manager) => {
      const submission = await manager.getRepository(SubmissionEntity).findOne({
        where: { id: existing.submissionId },
        lock: { mode: "pessimistic_write" },
      });
      if (!submission) throw new SubmissionFailure("NOT_FOUND", "视频提交不存在", 404);
      const repository = manager.getRepository(AnnotationRunEntity);
      const run = await repository.findOne({
        where: { id: runId },
        lock: { mode: "pessimistic_write" },
      });
      if (!run) throw new SubmissionFailure("NOT_FOUND", "候选标注运行不存在", 404);
      if (run.submissionId !== submission.id) {
        throw new SubmissionFailure("ANNOTATION_RUN_CONFLICT", "候选标注所属视频已变化", 409);
      }
      requireReview(actor, submission);
      const reviewKind =
        run.reviewStatus === "not_required" &&
        run.publicationStatus === "auto_accepted" &&
        run.auditStatus === "pending"
          ? "audit"
          : "blocking";
      if (
        reviewKind === "blocking" &&
        run.reviewStatus !== "pending"
      ) {
        throw new SubmissionFailure("ANNOTATION_ALREADY_REVIEWED", "该运行已有不可变人工结论，请创建新版本运行", 409);
      }
      if (
        reviewKind === "blocking" &&
        run.publicationStatus !== "candidate_only"
      ) {
        throw new SubmissionFailure("ANNOTATION_CANDIDATE_SUPERSEDED", "候选标注已被废弃或替代", 409);
      }
      if (reviewKind === "audit" && run.auditStatus !== "pending") {
        throw new SubmissionFailure("ANNOTATION_AUDIT_RESOLVED", "该自动发布运行已完成抽检", 409);
      }
      if (run.executionStatus !== "succeeded" || !run.rawResult || !run.normalizedResult) {
        throw new SubmissionFailure("ANNOTATION_CANDIDATE_NOT_READY", "候选标注尚未成功生成", 409);
      }
      if (input.expectedReviewRevision !== run.reviewRevision) {
        throw new SubmissionFailure("ANNOTATION_REVIEW_CONFLICT", "标注已被其他审核人更新，请刷新后重试", 409);
      }
      const candidateValidation = (run.normalizedResult.validation ?? null) as
        | { errors?: unknown }
        | null;
      let humanResult: Record<string, unknown> | null = null;
      const corrections = input.corrections ?? [];
      if (input.disposition === "accepted_unchanged") {
        if (Array.isArray(candidateValidation?.errors) && candidateValidation.errors.length > 0) {
          throw new SubmissionFailure("ANNOTATION_VALIDATION_FAILED", "候选标注存在结构或证据错误，不能直接接受", 409);
        }
        if (input.correctedResult || corrections.length > 0) {
          throw new SubmissionFailure("ANNOTATION_CORRECTION_UNEXPECTED", "未修正接受不能携带修正内容", 400);
        }
      } else if (input.disposition === "accepted_corrected") {
        if (!input.correctedResult || corrections.length === 0) {
          throw new SubmissionFailure("ANNOTATION_CORRECTION_REQUIRED", "接受修正结果必须提交字段级修正记录", 400);
        }
        let correctedRaw: RawVideoAnnotation;
        try {
          correctedRaw = parseRawVideoAnnotation(input.correctedResult);
        } catch (error) {
          throw new SubmissionFailure(
            "ANNOTATION_CORRECTION_INVALID",
            `修正标注不符合 v2 Schema：${error instanceof Error ? error.message.slice(0, 1_000) : "unknown"}`,
            400,
          );
        }
        if (correctedRaw.video_id !== run.rawResult.video_id) {
          throw new SubmissionFailure("ANNOTATION_CORRECTION_VIDEO_MISMATCH", "修正标注的 video_id 与原候选不一致", 400);
        }
        const descriptorPaths = new Set(corrections.map((correction) => correction.fieldPath));
        if (descriptorPaths.size !== corrections.length) {
          throw new SubmissionFailure("ANNOTATION_CORRECTION_DUPLICATE", "同一字段只能提交一条修正记录", 400);
        }
        for (const path of descriptorPaths) {
          if (!correctionPathAllowed(path)) {
            throw new SubmissionFailure("ANNOTATION_FIELD_NOT_EDITABLE", `当前不允许修改字段：${path}`, 400);
          }
        }
        for (const correction of corrections) {
          const expected = correctionIdentity(correction.fieldPath);
          if (
            correction.targetType !== expected.targetType ||
            correction.targetId !== expected.targetId
          ) {
            throw new SubmissionFailure(
              "ANNOTATION_CORRECTION_TARGET_INVALID",
              `修正目标与字段路径不一致：${correction.fieldPath}`,
              400,
            );
          }
        }
        const actualPaths = changedPaths(run.rawResult, correctedRaw);
        if (actualPaths.length === 0) {
          throw new SubmissionFailure("ANNOTATION_CORRECTION_EMPTY", "修正结果没有发生变化", 400);
        }
        const uncovered = actualPaths.filter((path) => !descriptorPaths.has(path));
        if (uncovered.length > 0) {
          throw new SubmissionFailure("ANNOTATION_CORRECTION_UNTRACKED", `存在未记录的字段修改：${uncovered.slice(0, 10).join("，")}`, 400);
        }
        const unchangedDescriptors = [...descriptorPaths].filter(
          (path) => !actualPaths.includes(path),
        );
        if (unchangedDescriptors.length > 0) {
          throw new SubmissionFailure(
            "ANNOTATION_CORRECTION_NOT_CHANGED",
            `修正记录对应字段没有变化：${unchangedDescriptors.slice(0, 10).join("，")}`,
            400,
          );
        }
        const metadata = await manager.getRepository(MediaMetadataEntity).findOneBy({ submissionId: run.submissionId });
        if (!metadata || run.sourceTimestampsMs.length < 4) {
          throw new SubmissionFailure("ANNOTATION_CORRECTION_EVIDENCE_MISSING", "原候选缺少可复算的媒体证据", 409);
        }
        humanResult = normalizedHumanResult({
          run,
          raw: correctedRaw,
          durationMs: Math.round(Number(metadata.durationSeconds) * 1_000),
        });
      } else if (input.correctedResult || corrections.length > 0) {
        throw new SubmissionFailure("ANNOTATION_CORRECTION_UNEXPECTED", "拒绝或无法判断时不能发布修正标注", 400);
      }

      const nextRevision = run.reviewRevision + 1;
      const review = manager.getRepository(AnnotationReviewEntity).create({
        id: `ANV-${randomUUID()}`,
        annotationRunId: run.id,
        revision: nextRevision,
        disposition: input.disposition,
        reviewKind,
        reviewedFields: [...new Set(input.reviewedFields)],
        reasonCodes: [...new Set(input.reasonCodes)],
        reviewDurationMs: input.reviewDurationMs,
        reason: input.reason.trim(),
        reviewerAccountId: actor.id,
        reviewerName: actor.displayName,
        correctedResult: humanResult,
      });
      await manager.getRepository(AnnotationReviewEntity).save(review);
      if (input.disposition === "accepted_corrected") {
        await manager.getRepository(AnnotationCorrectionEntity).save(
          corrections.map((correction: AnnotationCorrectionDto) => ({
            id: `ANC-${randomUUID()}`,
            annotationRunId: run.id,
            reviewId: review.id,
            targetType: correction.targetType,
            targetId: correction.targetId,
            fieldPath: correction.fieldPath,
            previousValue: valueAtPath(run.rawResult, correction.fieldPath) ?? null,
            nextValue: valueAtPath(input.correctedResult, correction.fieldPath) ?? null,
            reasonCode: correction.reasonCode,
            comment: correction.comment?.trim() || null,
            reviewerAccountId: actor.id,
          })),
        );
      }
      if (["accepted_unchanged", "accepted_corrected"].includes(input.disposition)) {
        await repository.update(
          {
            submissionId: run.submissionId,
            publicationStatus: In(["human_verified", "auto_accepted"]),
          },
          { publicationStatus: "superseded" },
        );
        run.publicationStatus = "human_verified";
      } else if (input.disposition === "rejected") {
        run.publicationStatus = "rejected";
      } else {
        run.publicationStatus = "candidate_only";
      }
      run.reviewStatus = input.disposition;
      run.reviewRevision = nextRevision;
      run.humanResult = humanResult;
      if (reviewKind === "audit") run.auditStatus = "completed";
      await repository.save(run);
      await this.audit.record(
        manager,
        actor,
        "annotation.run.review",
        { id: submission.id, name: submission.originalFileName },
        input.reason.trim(),
        {
          runId: run.id,
          reviewRevision: nextRevision - 1,
          reviewStatus: reviewKind === "audit" ? "not_required" : "pending",
          reviewKind,
        },
        {
          runId: run.id,
          reviewRevision: nextRevision,
          reviewStatus: run.reviewStatus,
          publicationStatus: run.publicationStatus,
          reviewedFields: review.reviewedFields,
          reasonCodes: review.reasonCodes,
          correctionCount: corrections.length,
          reviewKind,
        },
      );
      return { run: publicRun(run) };
    });
  }
}
