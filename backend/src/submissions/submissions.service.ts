import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Readable } from "node:stream";

import { Inject, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, DataSource, EntityManager, In, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import { AiQualityPromptService } from "../ai-quality/ai-quality-prompt.service.js";
import {
  evaluationSystemPrompt,
  parseTaskRequirementsSnapshot,
  promptContentSha256,
} from "../ai-quality/evaluation-context.js";
import { LabelSetService } from "../ai-quality/label-set.service.js";
import { QualityRuleService } from "../ai-quality/quality-rule.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { AuditLogEntity } from "../database/entities/audit-log.entity.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { CollectionTaskEntity } from "../database/entities/collection-task.entity.js";
import { csvDocument } from "../csv/csv.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { DeliveryPackageItemEntity } from "../database/entities/delivery-package-item.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "../database/entities/media-segment.entity.js";
import { PointCycleAdjustmentEntity } from "../database/entities/point-cycle-adjustment.entity.js";
import { PointCycleEntity } from "../database/entities/point-cycle.entity.js";
import { PointCycleItemEntity } from "../database/entities/point-cycle-item.entity.js";
import { PointRuleVersionEntity } from "../database/entities/point-rule-version.entity.js";
import { QualityRuleVersionEntity } from "../database/entities/quality-rule-version.entity.js";
import { SubmissionDuplicateCandidateEntity } from "../database/entities/submission-duplicate-candidate.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import {
  coefficientForScore,
  DEFAULT_COEFFICIENT_BANDS,
  labelSetSnapshot,
  passesQualityRule,
  pointsForRule,
  qualityRuleSnapshot,
  settlementRatioForScore,
  type PointRuleSnapshot,
  type QualityRuleSnapshot,
} from "../rules/rule-calculator.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import type {
  CompleteUploadDto,
  CreateUploadDto,
  DeleteSubmissionDto,
  DeleteSubmissionObjectsDto,
  RenameSubmissionDto,
  ReviewIssueDto,
  ReviewSubmissionQualityDto,
  VerifyResumeUploadDto,
} from "./dto/upload.dto.js";
import { SubmissionFailure } from "./submission-failure.js";
import { SubmissionsPolicy } from "./submissions.policy.js";

const MAX_SYNCHRONOUS_CSV_ROWS = 50_000;

/** 任务维度统计（按任务汇总提交/质检/积分，taskId 为 null 表示未关联任务） */
export type SubmissionTaskStat = {
  taskId: string | null;
  title: string;
  sceneName: string;
  taskType: "generic" | "preset" | "custom" | "none";
  total: number;
  reviewed: number;
  passed: number;
  failed: number;
  pending: number;
  passRate: number | null;
  avgScore: number | null;
  effectiveMinutes: number;
  lockedPoints: number;
};

export const UPLOAD_PART_SIZE_BYTES = 16 * 1024 * 1024;
export const UPLOAD_POLICY_VERSION = "DATA-AUTH-2026-08";
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const PREVIEW_URL_TTL_SECONDS = 10 * 60;
const DEFAULT_STORAGE_RETENTION_DAYS = 180;
const ACTIVE_PROCESSING_STATUSES = new Set([
  "queued",
  "probing",
  "awaiting_ai",
  "ai_processing",
]);
const REVIEW_AUDIT_ACTIONS = [
  "quality_review",
  "point_cycle_adjustment",
  "asset_quarantine",
  "asset_release",
  "storage_object_delete",
  "duplicate_candidate_clear",
  "ai_quality_rerun",
  "submission_rename",
];
const HLS_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]+\.(?:m3u8|ts)$/u;
const QUALITY_EFFECTIVE_PASSED_SQL = `
  CASE
    WHEN quality.passed IS NOT NULL THEN quality.passed
    WHEN quality.status = 'review_pending' AND quality.manualFinalScore IS NULL
      THEN NULL
    WHEN COALESCE(quality.manualFinalScore, quality.finalScore) IS NULL
      THEN NULL
    ELSE COALESCE(quality.manualFinalScore, quality.finalScore) >= COALESCE(
      (quality.qualityRuleSnapshot ->> 'passThreshold')::numeric,
      60
    )
  END
`;
const QUALITY_PASSED_SQL = `(${QUALITY_EFFECTIVE_PASSED_SQL}) IS TRUE`;
const QUALITY_FAILED_SQL = `(${QUALITY_EFFECTIVE_PASSED_SQL}) IS FALSE`;
const POINT_RULE_ELIGIBLE_SQL = `
  (
    (
      NOT EXISTS (
        SELECT 1
        FROM point_rule_versions AS active_point_rule
        WHERE active_point_rule.active = true
      )
      AND COALESCE(quality.manualFinalScore, quality.finalScore) >= 60
    )
    OR EXISTS (
      SELECT 1
      FROM point_rule_versions AS active_point_rule
      CROSS JOIN LATERAL jsonb_array_elements(
        active_point_rule.coefficient_bands
      ) AS point_band
      WHERE active_point_rule.active = true
        AND COALESCE(quality.manualFinalScore, quality.finalScore) >=
          (point_band ->> 'minScore')::numeric
        AND COALESCE(quality.manualFinalScore, quality.finalScore) <
          (point_band ->> 'maxScore')::numeric + 1
        AND (point_band ->> 'ratio')::numeric > 0
    )
  )
`;

type PublicReviewIssue = { label: string; start: number; end: number };
type SubmissionListStatus =
  | "all"
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "passed"
  | "reviewed"
  | "review_queue"
  | "quality_results"
  | "unsettled";
type SubmissionListQuery = {
  q?: string;
  status?: string;
  taskId?: string;
  page?: number;
  pageSize?: number;
  includeThumbnails?: boolean;
  /** 提交时间范围（createdAt >= dateFrom，ISO 日期或时间） */
  dateFrom?: string;
  dateTo?: string;
  /** 场景筛选（taskSceneName 匹配） */
  scene?: string;
  /** 排序字段：createdAt=提交时间 / finalScore=质量评分 */
  sortBy?: "createdAt" | "finalScore";
  sortOrder?: "asc" | "desc";
};

function decimal(value: number, digits: number): string {
  return value.toFixed(digits);
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}

function hlsDerivedObjectKeys(metadata?: MediaMetadataEntity | null): string[] {
  return metadata?.hlsObjectKeys ?? [];
}

function storageRetentionDays(): number {
  const configured = Number(process.env.SUBMISSION_OBJECT_RETENTION_DAYS);
  if (Number.isInteger(configured) && configured >= 0 && configured <= 3650) {
    return configured;
  }
  return DEFAULT_STORAGE_RETENTION_DAYS;
}

function storageRetainUntil(now = new Date()): Date | null {
  const days = storageRetentionDays();
  if (days === 0) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1_000);
}

function expectedVideoExtension(contentType: string): string | null {
  if (contentType === "video/mp4") return ".mp4";
  if (contentType === "video/quicktime") return ".mov";
  return null;
}

function listStatus(value: string | undefined): SubmissionListStatus {
  const supported = new Set<SubmissionListStatus>([
    "all",
    "uploading",
    "queued",
    "processing",
    "completed",
    "failed",
    "passed",
    "reviewed",
    "review_queue",
    "quality_results",
    "unsettled",
  ]);
  return supported.has(value as SubmissionListStatus)
    ? (value as SubmissionListStatus)
    : "all";
}

function unionDurationMs(intervals: Array<{ startMs: number; endMs: number }>) {
  const sorted = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  let total = 0;
  let current: { startMs: number; endMs: number } | null = null;
  for (const interval of sorted) {
    if (!current) {
      current = { ...interval };
    } else if (interval.startMs <= current.endMs) {
      current.endMs = Math.max(current.endMs, interval.endMs);
    } else {
      total += current.endMs - current.startMs;
      current = { ...interval };
    }
  }
  if (current) total += current.endMs - current.startMs;
  return Math.round(total);
}

function normalizeReviewIssues(
  issues: ReviewIssueDto[],
  durationSeconds: number | null,
): PublicReviewIssue[] {
  return issues.map((issue, index) => {
    const label = issue.label.trim();
    if (!label) {
      throw new SubmissionFailure(
        "INVALID_REVIEW_ISSUE",
        `第 ${index + 1} 个问题区间缺少问题类型`,
        400,
      );
    }
    if (!Number.isFinite(issue.start) || !Number.isFinite(issue.end)) {
      throw new SubmissionFailure(
        "INVALID_REVIEW_ISSUE",
        `第 ${index + 1} 个问题区间时间无效`,
        400,
      );
    }
    const start = Math.round(issue.start * 1_000) / 1_000;
    const end = Math.round(issue.end * 1_000) / 1_000;
    if (end <= start) {
      throw new SubmissionFailure(
        "INVALID_REVIEW_ISSUE",
        `第 ${index + 1} 个问题区间结束时间必须晚于开始时间`,
        400,
      );
    }
    if (durationSeconds !== null && end > durationSeconds + 0.001) {
      throw new SubmissionFailure(
        "INVALID_REVIEW_ISSUE",
        `第 ${index + 1} 个问题区间超出视频时长`,
        400,
      );
    }
    return { label, start, end };
  });
}

function auditValueNumber(
  value: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function reviewAuditActionLabel(action: string): string {
  if (action === "point_cycle_adjustment") return "锁定周期后调整";
  if (action === "asset_quarantine") return "敏感资产隔离";
  if (action === "asset_release") return "解除资产隔离";
  if (action === "storage_object_delete") return "删除视频对象";
  if (action === "duplicate_candidate_clear") return "解除近似重复候选";
  if (action === "ai_quality_rerun") return "重跑 AI 质检";
  if (action === "submission_rename") return "重命名提交数据";
  return "人工复核质量结果";
}

function publicSubmission(submission: SubmissionEntity) {
  const collectionTask = (
    submission as SubmissionEntity & {
      collectionTask?: CollectionTaskEntity | null;
    }
  ).collectionTask;
  const metadata = (
    submission as SubmissionEntity & {
      metadata?: MediaMetadataEntity | null;
      segments?: MediaSegmentEntity[];
    }
  ).metadata;
  const segments = (
    submission as SubmissionEntity & {
      segments?: MediaSegmentEntity[];
    }
  ).segments ?? [];
  const quality = (
    submission as SubmissionEntity & {
      quality?: VideoQualityResultEntity | null;
    }
  ).quality;
  const auditLogs = (
    submission as SubmissionEntity & {
      reviewAuditLogs?: AuditLogEntity[];
    }
  ).reviewAuditLogs ?? [];
  const pointCycleItems = (
    submission as SubmissionEntity & {
      pointCycleItems?: PointCycleItemEntity[];
    }
  ).pointCycleItems ?? [];
  const duplicateCandidates = (
    submission as SubmissionEntity & {
      duplicateCandidates?: SubmissionDuplicateCandidateEntity[];
    }
  ).duplicateCandidates ?? [];
  const effectiveFinalScore = quality?.manualFinalScore ?? quality?.finalScore;
  const effectiveSettlementRatio =
    quality?.manualSettlementRatio ?? quality?.settlementRatio;
  const effectiveInvalidDurationMs =
    quality?.manualInvalidDurationMs ?? quality?.invalidDurationMs;
  const effectiveBillableDurationMs =
    quality?.manualBillableDurationMs ?? quality?.billableDurationMs;
  return {
    id: submission.id,
    fileName: submission.originalFileName,
    ownerId: submission.ownerId,
    ownerName: submission.owner?.displayName ?? "",
    teamId: submission.teamId,
    teamName: submission.team?.name ?? "",
    sizeBytes: submission.expectedSizeBytes,
    uploadStatus: submission.uploadStatus,
    processingStatus: submission.processingStatus,
    failureCode: submission.failureCode ?? undefined,
    failureMessage: submission.failureMessage ?? undefined,
    isTestData: submission.isTestData,
    assetStatus: submission.assetStatus,
    storageStatus: submission.storageStatus,
    storage: {
      status: submission.storageStatus,
      retainUntil: submission.storageRetainUntil?.getTime(),
      deletedAt: submission.storageDeletedAt?.getTime(),
      deletedByAccountId: submission.storageDeletedByAccountId ?? undefined,
      deletedByName: submission.storageDeletedByName ?? undefined,
      deleteReason: submission.storageDeleteReason ?? undefined,
    },
    quarantine:
      submission.assetStatus === "quarantined"
        ? {
            reason: submission.quarantineReason ?? "敏感内容隔离",
            quarantinedAt: submission.quarantinedAt?.getTime(),
            quarantinedByAccountId:
              submission.quarantinedByAccountId ?? undefined,
            quarantinedByName: submission.quarantinedByName ?? undefined,
          }
        : undefined,
    authorization: {
      dataUsageAuthorized: submission.dataUsageAuthorized,
      privacyConfirmed: submission.privacyConfirmed,
      sensitiveContentConfirmed: submission.sensitiveContentConfirmed,
      uploadPolicyVersion: submission.uploadPolicyVersion,
      confirmedAt: submission.authorizationConfirmedAt?.getTime(),
    },
    task: submission.taskId
      ? {
          taskId: submission.taskId,
          title: collectionTask?.title ?? undefined,
          revision: submission.taskRevision,
          sceneName: submission.taskSceneName ?? "",
          taskType: collectionTask?.taskType ?? "custom",
          requirements: submission.taskRequirementsSnapshot ?? undefined,
          pricePointsPerMinute:
            submission.taskPricePointsPerMinute === null ||
            submission.taskPricePointsPerMinute === undefined
              ? null
              : Number(submission.taskPricePointsPerMinute),
        }
      : null,
    settlementStatus: pointCycleItems.length > 0 ? "settled" : "unsettled",
    duplicateCandidates: duplicateCandidates
      .filter((candidate) => candidate.status === "candidate")
      .map((candidate) => ({
        id: candidate.id,
        candidateSubmissionId: candidate.candidateSubmissionId,
        candidateFileName:
          candidate.candidateSubmission?.originalFileName ?? undefined,
        similarity: Number(candidate.similarity),
        status: candidate.status,
        details: candidate.details,
        createdAt: candidate.createdAt.getTime(),
      })),
    createdAt: submission.createdAt.getTime(),
    uploadedAt: submission.uploadedAt?.getTime(),
    media: metadata
      ? {
          durationSeconds: Number(metadata.durationSeconds),
          width: metadata.width,
          height: metadata.height,
          frameRate: Number(metadata.frameRate),
          codec: metadata.codec,
          bitrate: metadata.bitrate,
          sizeBytes: metadata.sizeBytes,
        }
      : undefined,
    segments: segments.map((segment) => ({
      id: segment.id,
      type: segment.type,
      startSeconds: Number(segment.startSeconds),
      endSeconds: Number(segment.endSeconds),
      invalid: segment.invalid,
      evidenceObjectKey: segment.evidenceObjectKey ?? undefined,
    })),
    quality: quality
      ? {
          status: quality.status,
          attempts: quality.attempts,
          promptRevision: quality.promptRevision,
          promptContentSha256: quality.promptContentSha256,
          initialModel: quality.initialModel,
          reviewModel: quality.reviewModel,
          modelRuns: quality.modelRuns,
          finalScore:
            effectiveFinalScore === null || effectiveFinalScore === undefined
              ? null
              : Number(effectiveFinalScore),
          aiFinalScore:
            quality.finalScore === null ? null : Number(quality.finalScore),
          rawTotalScore:
            quality.rawTotalScore === null
              ? null
              : Number(quality.rawTotalScore),
          settlementRatio:
            effectiveSettlementRatio === null ||
            effectiveSettlementRatio === undefined
              ? null
              : Number(effectiveSettlementRatio),
          passed:
            quality.passed !== null
              ? quality.passed
              : quality.status === "review_pending" &&
                  quality.manualFinalScore === null
                ? null
                : effectiveFinalScore === null ||
                    effectiveFinalScore === undefined
                  ? null
                  : Number(effectiveFinalScore) >=
                    (quality.qualityRuleSnapshot?.passThreshold ?? 60),
          passThreshold: quality.qualityRuleSnapshot?.passThreshold ?? 60,
          invalidDurationMs:
            effectiveInvalidDurationMs === null ||
            effectiveInvalidDurationMs === undefined
              ? null
              : Number(effectiveInvalidDurationMs),
          billableDurationMs:
            effectiveBillableDurationMs === null ||
            effectiveBillableDurationMs === undefined
              ? null
              : Number(effectiveBillableDurationMs),
          summary: quality.summary,
          recommendations: quality.recommendations,
          deductions: quality.deductions,
          reviewRequired: quality.reviewRequired,
          reviewReasons: quality.reviewReasons,
          reviewRevision: quality.reviewRevision,
          manualReview:
            quality.manualReviewedAt &&
            quality.manualReviewedByAccountId &&
            quality.manualReviewedByName &&
            quality.manualReviewReason
              ? {
                  reviewedByAccountId: quality.manualReviewedByAccountId,
                  reviewedByName: quality.manualReviewedByName,
                  reviewedAt: quality.manualReviewedAt.getTime(),
                  reason: quality.manualReviewReason,
                  issues: quality.manualIssues ?? [],
                  finalScore:
                    quality.manualFinalScore === null
                      ? null
                      : Number(quality.manualFinalScore),
                }
              : undefined,
          manualIssues: quality.manualIssues ?? [],
          lastError: quality.lastError ?? undefined,
          progressStage: quality.progressStage ?? undefined,
          progressUpdatedAt: quality.progressUpdatedAt?.getTime(),
          stuckReason: quality.stuckReason ?? undefined,
          detectedTask:
            quality.normalizedResult &&
            typeof quality.normalizedResult.detectedTask === "object"
              ? quality.normalizedResult.detectedTask
              : undefined,
          invalidSegments:
            quality.normalizedResult &&
            Array.isArray(quality.normalizedResult.invalidSegments)
              ? quality.normalizedResult.invalidSegments
              : [],
          dimensions:
            quality.normalizedResult &&
            typeof quality.normalizedResult.dimensions === "object"
              ? (quality.normalizedResult.dimensions as Record<
                  string,
                  unknown
                >)
              : undefined,
          hardVeto:
            quality.normalizedResult &&
            typeof quality.normalizedResult.hardVeto === "object"
              ? (quality.normalizedResult.hardVeto as {
                  triggered: boolean;
                  reasons: Array<string | Record<string, unknown>>;
                })
              : undefined,
          taskCompliance:
            quality.normalizedResult &&
            typeof quality.normalizedResult.taskCompliance === "object"
              ? (quality.normalizedResult.taskCompliance as Record<
                  string,
                  unknown
                >)
              : undefined,
          candidateAnnotation:
            quality.normalizedResult &&
            typeof quality.normalizedResult.candidateAnnotation === "object"
              ? (quality.normalizedResult.candidateAnnotation as Record<
                  string,
                  unknown
                >)
              : undefined,
          annotationReview:
            quality.normalizedResult &&
            typeof quality.normalizedResult.annotationReview === "object"
              ? (quality.normalizedResult.annotationReview as Record<
                  string,
                  unknown
                >)
              : undefined,
          billingObservations:
            quality.rawModelResult &&
            typeof quality.rawModelResult.billing_observations === "object"
              ? quality.rawModelResult.billing_observations
              : undefined,
          startedAt: quality.startedAt?.getTime(),
          completedAt: quality.completedAt?.getTime(),
        }
      : undefined,
    audit: auditLogs.map((log) => ({
      id: log.id,
      actor: log.actorName,
      action: reviewAuditActionLabel(log.action),
      reason: log.summary,
      createdAt: log.createdAt.getTime(),
      previousScore: auditValueNumber(log.beforeValue, "finalScore"),
      nextScore: auditValueNumber(log.afterValue, "finalScore"),
    })),
  };
}

@Injectable()
export class SubmissionsService {
  constructor(
    @InjectRepository(SubmissionEntity)
    private readonly submissions: Repository<SubmissionEntity>,
    @InjectRepository(CollectionTaskEntity)
    private readonly tasks: Repository<CollectionTaskEntity>,
    private readonly dataSource: DataSource,
    private readonly policy: SubmissionsPolicy,
    private readonly audit: AuditService,
    private readonly prompts: AiQualityPromptService,
    private readonly qualityRules: QualityRuleService,
    private readonly labelSets: LabelSetService,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
  ) {}

  async createUpload(actor: PublicUser, input: CreateUploadDto) {
    this.policy.requireCreate(actor);
    if (
      !input.dataUsageAuthorized ||
      !input.privacyConfirmed ||
      !input.sensitiveContentConfirmed
    ) {
      throw new SubmissionFailure(
        "UPLOAD_AUTHORIZATION_REQUIRED",
        "上传前必须确认数据授权、隐私规范和敏感内容处理要求",
        400,
      );
    }
    if (!input.taskRequirementsConfirmed) {
      throw new SubmissionFailure(
        "TASK_REQUIREMENTS_NOT_CONFIRMED",
        "上传前必须确认已阅读并理解任务要求",
        400,
      );
    }
    const task = await this.tasks.findOneBy({ id: input.taskId });
    if (!task) {
      throw new SubmissionFailure("TASK_NOT_FOUND", "采集任务不存在", 404);
    }
    if (task.status !== "published") {
      throw new SubmissionFailure(
        "TASK_NOT_ACCEPTING",
        "该采集任务当前不接受提交",
        409,
      );
    }
    if (task.normalizationStatus !== "ready" || !task.normalizedRequirements) {
      throw new SubmissionFailure(
        "TASK_REQUIREMENTS_NOT_READY",
        "采集任务要求尚未就绪",
        409,
      );
    }
    const taskRequirements = task.normalizedRequirements;
    const extension = extname(input.fileName).toLocaleLowerCase("en-US");
    const expectedExtension =
      input.contentType === "video/mp4" ? ".mp4" : ".mov";
    if (extension !== expectedExtension) {
      throw new SubmissionFailure(
        "INVALID_FILE_TYPE",
        "文件扩展名与视频格式不一致",
        400,
      );
    }
    const id = `SUB-${randomUUID()}`;
    const objectKey = `uploads/${actor.teamId}/${actor.id}/${id}/original${extension}`;
    let uploadId: string | null = null;
    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`submission-checksum:${input.checksumSha256}`],
        );
        const repository = manager.getRepository(SubmissionEntity);
        const duplicate = await repository
          .createQueryBuilder("submission")
          .where("submission.checksumSha256 = :checksumSha256", {
            checksumSha256: input.checksumSha256,
          })
          .andWhere("submission.uploadStatus IN (:...uploadStatuses)", {
            uploadStatuses: ["created", "uploading", "completing", "uploaded"],
          })
          .andWhere("submission.storageStatus = :available", {
            available: "available",
          })
          .orderBy("submission.createdAt", "ASC")
          .addOrderBy("submission.id", "ASC")
          .getOne();
        if (duplicate) {
          throw new SubmissionFailure(
            "DUPLICATE_VIDEO",
            `该视频已登记，重复任务编号 ${duplicate.id}`,
            409,
          );
        }

        ({ uploadId } = await this.storage.createMultipartUpload({
          objectKey,
          contentType: input.contentType,
          checksumSha256: input.checksumSha256,
        }));
        const submission = await repository.save(
          repository.create({
          id,
          ownerId: actor.id,
          teamId: actor.teamId,
          originalFileName: input.fileName,
          contentType: input.contentType,
          expectedSizeBytes: String(input.sizeBytes),
          checksumSha256: input.checksumSha256,
          objectKey,
          multipartUploadId: uploadId,
          uploadStatus: "uploading",
          processingStatus: "uploading",
          isTestData: false,
          // 任务关联与快照：锁定任务版本、场景名、规范化要求与单价，
          // 后续任务修改不影响本提交的 AI 质检与结算。
          taskId: task.id,
          taskRevision: task.revision,
          taskSceneName: task.sceneName,
          taskRequirementsSnapshot: {
            scene_name: task.sceneName,
            scene_description: taskRequirements.scene_description,
            requirements: taskRequirements.requirements,
            quality_notes: taskRequirements.quality_notes ?? [],
          },
          taskPricePointsPerMinute: task.pricePointsPerMinute,
          dataUsageAuthorized: true,
          privacyConfirmed: true,
          sensitiveContentConfirmed: true,
          uploadPolicyVersion: UPLOAD_POLICY_VERSION,
          authorizationConfirmedAt: new Date(),
          storageStatus: "available",
          storageRetainUntil: storageRetainUntil(),
          }),
        );
        return {
          submission: publicSubmission(submission),
          upload: {
            uploadId,
            partSizeBytes: UPLOAD_PART_SIZE_BYTES,
            partCount: Math.ceil(input.sizeBytes / UPLOAD_PART_SIZE_BYTES),
            expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
          },
        };
      });
    } catch (error) {
      if (uploadId) {
        await this.storage
          .abortMultipartUpload({ objectKey, uploadId })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async presignParts(
    actor: PublicUser,
    id: string,
    partNumbers: number[],
  ) {
    const submission = await this.findEntity(id);
    this.policy.requireUploadControl(actor, submission);
    this.requireUploading(submission);
    const uploadId = submission.multipartUploadId!;
    const partCount = Math.ceil(
      Number(submission.expectedSizeBytes) / UPLOAD_PART_SIZE_BYTES,
    );
    const uniqueParts = [...new Set(partNumbers)].sort((a, b) => a - b);
    if (
      uniqueParts.length !== partNumbers.length ||
      uniqueParts.some((partNumber) => partNumber > partCount)
    ) {
      throw new SubmissionFailure(
        "INVALID_PARTS",
        "分片编号无效或重复",
        400,
      );
    }
    return {
      parts: await Promise.all(
        uniqueParts.map((partNumber) =>
          this.storage.presignUploadPart({
            objectKey: submission.objectKey,
            uploadId,
            partNumber,
            expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
          }),
        ),
      ),
    };
  }

  async verifyResumeUpload(
    actor: PublicUser,
    id: string,
    input: VerifyResumeUploadDto,
  ) {
    const submission = await this.findEntity(id);
    this.policy.requireUploadControl(actor, submission);
    this.requireUploading(submission);
    if (
      input.fileName !== submission.originalFileName ||
      String(input.sizeBytes) !== submission.expectedSizeBytes ||
      input.checksumSha256 !== submission.checksumSha256
    ) {
      throw new SubmissionFailure(
        "RESUME_FILE_MISMATCH",
        "请选择同名、同大小且内容一致的原始视频继续上传",
        409,
      );
    }
    return {
      submission: publicSubmission(submission),
      upload: {
        uploadId: submission.multipartUploadId!,
        partSizeBytes: UPLOAD_PART_SIZE_BYTES,
        partCount: Math.ceil(
          Number(submission.expectedSizeBytes) / UPLOAD_PART_SIZE_BYTES,
        ),
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      },
    };
  }

  async activeUploads(actor: PublicUser) {
    if (actor.role !== "collector" || !actor.teamId) {
      return [];
    }
    const submissions = await this.submissions.find({
      where: {
        ownerId: actor.id,
        uploadStatus: "uploading",
        processingStatus: "uploading",
        storageStatus: "available",
      },
      order: { createdAt: "DESC" },
    });
    return submissions
      .filter((submission) => submission.multipartUploadId)
      .map((submission) => ({
        submission: publicSubmission(submission),
        upload: {
          uploadId: submission.multipartUploadId!,
          partSizeBytes: UPLOAD_PART_SIZE_BYTES,
          partCount: Math.ceil(
            Number(submission.expectedSizeBytes) / UPLOAD_PART_SIZE_BYTES,
          ),
          expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        },
      }));
  }

  async completeUpload(
    actor: PublicUser,
    id: string,
    input: CompleteUploadDto,
  ) {
    const parts = [...input.parts].sort(
      (left, right) => left.partNumber - right.partNumber,
    );
    const submission = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SubmissionEntity);
      const locked = await repository.findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!locked) {
        throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
      }
      this.policy.requireUploadControl(actor, locked);
      if (locked.uploadStatus === "uploaded") return locked;
      if (locked.storageStatus !== "available") {
        throw new SubmissionFailure(
          "UPLOAD_NOT_ACTIVE",
          "该视频正在执行对象删除，无法完成上传",
          409,
        );
      }
      if (
        !["uploading", "completing"].includes(locked.uploadStatus) ||
        !locked.multipartUploadId
      ) {
        throw new SubmissionFailure(
          "UPLOAD_NOT_ACTIVE",
          "当前上传任务不可完成",
          409,
        );
      }
      const expectedPartCount = Math.ceil(
        Number(locked.expectedSizeBytes) / UPLOAD_PART_SIZE_BYTES,
      );
      if (
        parts.length !== expectedPartCount ||
        parts.some((part, index) => part.partNumber !== index + 1)
      ) {
        throw new SubmissionFailure(
          "INVALID_PARTS",
          "必须提交完整且连续的分片列表",
          400,
        );
      }
      locked.uploadStatus = "completing";
      locked.multipartCompletionParts = parts;
      return await repository.save(locked);
    });
    if (submission.uploadStatus === "uploaded") {
      return { submission: publicSubmission(await this.findEntity(id)) };
    }

    const object = await this.ensureMultipartObject(submission);
    if (object.sizeBytes !== submission.expectedSizeBytes) {
      await this.dataSource.transaction(async (manager) => {
        const repository = manager.getRepository(SubmissionEntity);
        const locked = await repository.findOne({
          where: { id },
          lock: { mode: "pessimistic_write" },
        });
        if (!locked) return;
        locked.uploadStatus = "uploaded";
        locked.processingStatus = "system_failed";
        locked.failureCode = "OBJECT_SIZE_MISMATCH";
        locked.failureMessage = "上传对象大小与创建上传时声明的不一致";
        locked.uploadedAt = new Date();
        locked.multipartUploadId = null;
        locked.multipartCompletionParts = null;
        await repository.save(locked);
      });
      throw new SubmissionFailure(
        "OBJECT_SIZE_MISMATCH",
        "上传文件大小校验失败，请重新上传",
        422,
      );
    }
    return { submission: publicSubmission(await this.finalizeCompletedUpload(id)) };
  }

  async abortUpload(actor: PublicUser, id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SubmissionEntity);
      const submission = await repository.findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!submission) {
        throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
      }
      this.policy.requireUploadControl(actor, submission);
      this.requireUploading(submission);
      submission.storageStatus = "delete_pending";
      submission.storageDeleteMode = "objects";
      submission.storageDeleteObjectKeys = [submission.objectKey];
      submission.storageDeleteForce = true;
      submission.storageDeletedByAccountId = actor.id;
      submission.storageDeletedByName = actor.displayName;
      submission.storageDeleteReason = "上传已取消";
      await repository.save(submission);
    });
    await this.processPendingStorageDelete(id);
  }

  async list(actor: PublicUser, input: SubmissionListQuery = {}) {
    const page = Math.max(1, input.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 100));
    const paged = input.page !== undefined || input.pageSize !== undefined;
    const status = listStatus(input.status);
    const q = input.q?.trim();
    const taskId = input.taskId?.trim();
    const idQuery = this.createListIdQuery(actor, status, q, taskId, {
      scene: input.scene,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    });
    const total = await idQuery.getCount();
    if (paged) {
      idQuery.skip((page - 1) * pageSize).take(pageSize);
    }
    const rows = await idQuery.getRawMany<{ id: string }>();
    const ids = rows.map((row) => row.id);
    const submissions = await this.findDetailedByIds(ids);
    const ordered = new Map(
      submissions.map((submission) => [submission.id, submission]),
    );
    const thumbnails = input.includeThumbnails
      ? await this.thumbnailMap(submissions)
      : new Map<
          string,
          { url: string; expiresAt: number; contentType: string }
        >();
    const taskSources = await this.listTaskSources(actor);
    return {
      submissions: ids.flatMap((id) => {
        const submission = ordered.get(id);
        if (!submission) return [];
        const item = publicSubmission(submission);
        const thumbnail = thumbnails.get(id);
        return [thumbnail ? { ...item, thumbnail } : item];
      }),
      pagination: {
        page,
        pageSize: paged ? pageSize : total,
        total,
        totalPages: paged ? Math.max(1, Math.ceil(total / pageSize)) : 1,
      },
      taskSources,
    };
  }

  private async thumbnailMap(
    submissions: SubmissionEntity[],
  ): Promise<
    Map<
      string,
      { url: string; expiresAt: number; contentType: string }
    >
  > {
    const result = new Map<
      string,
      { url: string; expiresAt: number; contentType: string }
    >();
    await Promise.all(
      submissions.map(async (submission) => {
        if (submission.storageStatus !== "available") return;
        const metadata = (
          submission as SubmissionEntity & {
            metadata?: MediaMetadataEntity | null;
          }
        ).metadata;
        const objectKey = metadata?.thumbnailObjectKey;
        if (!objectKey) return;
        try {
          const signed = await this.storage.presignDownloadObject({
            objectKey,
            expiresInSeconds: PREVIEW_URL_TTL_SECONDS,
          });
          result.set(submission.id, {
            url: signed.url,
            expiresAt: signed.expiresAt.getTime(),
            contentType: "image/jpeg",
          });
        } catch {
          // 缩略图签名失败不应阻断列表返回，仅跳过该条缩略图。
        }
      }),
    );
    return result;
  }

  async exportCsv(actor: PublicUser, input: SubmissionListQuery = {}) {
    const status = listStatus(input.status);
    const q = input.q?.trim();
    const idQuery = this.createListIdQuery(actor, status, q, undefined, {
      scene: input.scene,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    });
    const total = await idQuery.getCount();
    if (total > MAX_SYNCHRONOUS_CSV_ROWS) {
      throw new PayloadTooLargeException({
        code: "EXPORT_TOO_LARGE",
        message: `导出结果超过 ${MAX_SYNCHRONOUS_CSV_ROWS} 条，请缩小筛选范围`,
      });
    }
    const ids = (
      await idQuery.take(MAX_SYNCHRONOUS_CSV_ROWS).getRawMany<{ id: string }>()
    ).map((row) => row.id);
    const submissions = await this.findDetailedByIds(ids);
    const ordered = new Map(
      submissions.map((submission) => [submission.id, submission]),
    );
    const rows = [
      [
        "submission_id",
        "file_name",
        "owner_name",
        "team_name",
        "upload_status",
        "processing_status",
        "quality_status",
        "final_score",
        "settlement_status",
        "asset_status",
        "storage_status",
        "duplicate_candidate_count",
        "duration_seconds",
        "created_at",
        "uploaded_at",
      ],
      ...ids.flatMap((id) => {
        const submission = ordered.get(id);
        if (!submission) return [];
        const item = publicSubmission(submission);
        return [
          [
            item.id,
            item.fileName,
            item.ownerName,
            item.teamName,
            item.uploadStatus,
            item.processingStatus,
            item.quality?.status ?? "",
            item.quality?.finalScore ?? "",
            item.settlementStatus,
            item.assetStatus,
            item.storageStatus,
            item.duplicateCandidates.length,
            item.media?.durationSeconds ?? "",
            new Date(item.createdAt).toISOString(),
            item.uploadedAt ? new Date(item.uploadedAt).toISOString() : "",
          ],
        ];
      }),
    ];
    return csvDocument(rows);
  }

  async get(actor: PublicUser, id: string) {
    const submission = await this.submissions
      .createQueryBuilder("submission")
      .leftJoinAndSelect("submission.owner", "owner")
      .leftJoinAndSelect("submission.team", "team")
      .leftJoinAndMapOne(
        "submission.metadata",
        MediaMetadataEntity,
        "metadata",
        "metadata.submissionId = submission.id",
      )
      .leftJoinAndMapMany(
        "submission.segments",
        MediaSegmentEntity,
        "segment",
        "segment.submissionId = submission.id",
      )
      .leftJoinAndMapOne(
        "submission.quality",
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .leftJoinAndMapMany(
        "submission.duplicateCandidates",
        SubmissionDuplicateCandidateEntity,
        "duplicateCandidate",
        "duplicateCandidate.submissionId = submission.id",
      )
      .leftJoinAndSelect(
        "duplicateCandidate.candidateSubmission",
        "duplicateCandidateSubmission",
      )
      .leftJoinAndMapMany(
        "submission.reviewAuditLogs",
        AuditLogEntity,
        "reviewAudit",
        "reviewAudit.targetAccountId = submission.id AND reviewAudit.action IN (:...reviewActions)",
        { reviewActions: REVIEW_AUDIT_ACTIONS },
      )
      .where("submission.id = :id", { id })
      .orderBy("segment.startSeconds", "ASC")
      .addOrderBy("duplicateCandidate.similarity", "DESC")
      .addOrderBy("reviewAudit.createdAt", "ASC")
      .getOne();
    if (!submission) {
      throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
    }
    this.policy.requireRead(actor, submission);
    return publicSubmission(submission);
  }

  async reviewQuality(
    actor: PublicUser,
    id: string,
    input: ReviewSubmissionQualityDto,
  ) {
    const reason = input.reason.trim();
    if (!reason) {
      throw new SubmissionFailure(
        "REVIEW_REASON_REQUIRED",
        "请填写调整原因",
        400,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const submission = await manager
        .getRepository(SubmissionEntity)
        .findOne({
          where: { id },
          lock: { mode: "pessimistic_write" },
        });
      if (!submission) {
        throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
      }
      this.policy.requireQualityReview(actor, submission);
      if (submission.processingStatus !== "completed") {
        throw new SubmissionFailure(
          "QUALITY_NOT_COMPLETED",
          "视频尚未完成 AI 质检，暂不能人工复核",
          409,
        );
      }
      const lockedItem = await manager
        .getRepository(PointCycleItemEntity)
        .findOne({
          where: { submissionId: id },
          lock: { mode: "pessimistic_write" },
        });
      // 已进入锁定/结算周期的视频不允许再修改质检结果（锁定即最终结算依据）
      if (lockedItem) {
        const cycle = await manager
          .getRepository(PointCycleEntity)
          .findOneBy({ id: lockedItem.cycleId });
        if (cycle && (cycle.status === "locked" || cycle.status === "settled")) {
          throw new SubmissionFailure(
            "SUBMISSION_IN_LOCKED_CYCLE",
            "该视频已进入锁定/结算周期，质检结果不允许再修改；如需纠错请在下次锁定前处理",
            409,
          );
        }
      }

      const quality = await manager
        .getRepository(VideoQualityResultEntity)
        .findOne({
          where: { submissionId: id },
          lock: { mode: "pessimistic_write" },
        });
      if (!quality) {
        throw new SubmissionFailure(
          "QUALITY_RESULT_NOT_FOUND",
          "视频质检结果不存在",
          404,
        );
      }
      if (quality.status === "hard_reject") {
        throw new SubmissionFailure(
          "QUALITY_HARD_REJECT_IMMUTABLE",
          "硬否决结果不能通过人工复核改为通过",
          409,
        );
      }
      if (
        input.expectedReviewRevision !== undefined &&
        input.expectedReviewRevision !== quality.reviewRevision
      ) {
        throw new SubmissionFailure(
          "REVIEW_CONFLICT",
          "该视频质检结果已被更新，请刷新后再复核",
          409,
        );
      }

      const metadata = await manager
        .getRepository(MediaMetadataEntity)
        .findOneBy({ submissionId: id });
      const currentBillableDurationMs =
        quality.manualBillableDurationMs ?? quality.billableDurationMs;
      const currentInvalidDurationMs =
        quality.manualInvalidDurationMs ?? quality.invalidDurationMs;
      const existingDurationMs =
        currentBillableDurationMs !== null && currentInvalidDurationMs !== null
          ? Number(currentBillableDurationMs) + Number(currentInvalidDurationMs)
          : null;
      const durationSeconds =
        metadata?.durationSeconds !== undefined
          ? Number(metadata.durationSeconds)
          : existingDurationMs === null
            ? null
            : existingDurationMs / 1_000;
      const issues = normalizeReviewIssues(
        input.issues,
        Number.isFinite(durationSeconds) ? durationSeconds : null,
      );
      const invalidDurationMs = unionDurationMs(
        issues.map((issue) => ({
          startMs: Math.round(issue.start * 1_000),
          endMs: Math.round(issue.end * 1_000),
        })),
      );
      const durationMs =
        durationSeconds === null
          ? null
          : Math.max(0, Math.round(durationSeconds * 1_000));
      const billableDurationMs =
        durationMs === null ? null : Math.max(0, durationMs - invalidDurationMs);
      const finalScore = Math.round(input.finalScore * 10) / 10;
      const qualityRule = await this.qualityRuleForResult(manager, quality);
      const passed = passesQualityRule(finalScore, qualityRule.passThreshold);
      const settlementRatio = settlementRatioForScore({
        score: finalScore,
        passThreshold: qualityRule.passThreshold,
      });
      const before = {
        finalScore:
          quality.manualFinalScore === null
            ? quality.finalScore === null
              ? null
              : Number(quality.finalScore)
            : Number(quality.manualFinalScore),
        invalidDurationMs:
          quality.manualInvalidDurationMs === null
            ? quality.invalidDurationMs === null
              ? null
              : Number(quality.invalidDurationMs)
            : Number(quality.manualInvalidDurationMs),
        reviewRevision: quality.reviewRevision,
        assetStatus: submission.assetStatus,
        quarantineReason: submission.quarantineReason,
      };

      quality.manualFinalScore = decimal(finalScore, 1);
      quality.manualSettlementRatio = decimal(settlementRatio, 4);
      quality.passed = passed;
      quality.manualInvalidDurationMs = String(invalidDurationMs);
      quality.manualBillableDurationMs =
        billableDurationMs === null ? null : String(billableDurationMs);
      quality.manualIssues = issues;
      quality.manualReviewReason = reason;
      quality.manualReviewedByAccountId = actor.id;
      quality.manualReviewedByName = actor.displayName;
      quality.manualReviewedAt = new Date();
      quality.reviewRevision += 1;
      await manager.getRepository(VideoQualityResultEntity).save(quality);

      const after = {
        finalScore,
        invalidDurationMs,
        reviewRevision: quality.reviewRevision,
      };
      const previousAssetStatus = submission.assetStatus;
      const previousQuarantineReason = submission.quarantineReason;
      const shouldQuarantine = input.quarantine === true;
      const shouldRelease = input.quarantine === false;
      if (shouldQuarantine) {
        submission.assetStatus = "quarantined";
        submission.quarantineReason = reason;
        submission.quarantinedAt = new Date();
        submission.quarantinedByAccountId = actor.id;
        submission.quarantinedByName = actor.displayName;
        await manager.getRepository(SubmissionEntity).save(submission);
      } else if (shouldRelease) {
        submission.assetStatus = "active";
        submission.quarantineReason = null;
        submission.quarantinedAt = null;
        submission.quarantinedByAccountId = null;
        submission.quarantinedByName = null;
        await manager.getRepository(SubmissionEntity).save(submission);
      }
      const quarantineAction =
        previousAssetStatus !== submission.assetStatus
          ? submission.assetStatus === "quarantined"
            ? "asset_quarantine"
            : "asset_release"
          : null;
      if (lockedItem) {
        if (durationMs === null || billableDurationMs === null) {
          throw new SubmissionFailure(
            "MEDIA_DURATION_REQUIRED",
            "视频时长未知，不能计算锁定后调整",
            409,
          );
        }
        const adjustmentRepository = manager.getRepository(
          PointCycleAdjustmentEntity,
        );
        const latestAdjustment = await adjustmentRepository
          .createQueryBuilder("adjustment")
          .setLock("pessimistic_write")
          .where("adjustment.submissionId = :id", { id })
          .orderBy("adjustment.createdAt", "DESC")
          .addOrderBy("adjustment.id", "DESC")
          .getOne();
        const previousFinalScore = latestAdjustment
          ? Number(latestAdjustment.nextFinalScore)
          : Number(lockedItem.finalScore);
        const previousSettlementRatio = latestAdjustment
          ? Number(latestAdjustment.nextSettlementRatio)
          : Number(lockedItem.settlementRatio);
        const previousInvalidDurationMs = latestAdjustment
          ? Number(latestAdjustment.nextInvalidDurationMs)
          : Math.max(
              0,
              durationMs - Number(lockedItem.effectiveDurationMs),
            );
        const previousEffectiveDurationMs = latestAdjustment
          ? Number(latestAdjustment.nextEffectiveDurationMs)
          : Number(lockedItem.effectiveDurationMs);
        const previousPoints = latestAdjustment
          ? Number(latestAdjustment.nextPoints)
          : Number(lockedItem.points);
        const pointRule = await this.pointRuleForCycle(
          manager,
          lockedItem.cycleId,
        );
        const cycleSettlementRatio = passed
          ? coefficientForScore(finalScore, pointRule.coefficientBands)
          : 0;
        const nextPoints = pointsForRule({
          pointsPerMinute: Number(lockedItem.pointsPerMinute),
          effectiveDurationMs: billableDurationMs,
          settlementRatio: cycleSettlementRatio,
        });
        const pointsDelta =
          Math.round((nextPoints - previousPoints) * 100) / 100;
        const adjustment = await adjustmentRepository.save({
          id: `PCA-${randomUUID()}`,
          pointCycleItemId: lockedItem.id,
          submissionId: submission.id,
          previousFinalScore: decimal(previousFinalScore, 1),
          nextFinalScore: decimal(finalScore, 1),
          previousSettlementRatio: decimal(previousSettlementRatio, 4),
          nextSettlementRatio: decimal(cycleSettlementRatio, 4),
          previousInvalidDurationMs: String(previousInvalidDurationMs),
          nextInvalidDurationMs: String(invalidDurationMs),
          previousEffectiveDurationMs: String(previousEffectiveDurationMs),
          nextEffectiveDurationMs: String(billableDurationMs),
          previousPoints: decimal(previousPoints, 2),
          nextPoints: decimal(nextPoints, 2),
          pointsDelta: decimal(pointsDelta, 2),
          reason,
          createdByAccountId: actor.id,
          createdByName: actor.displayName,
        });
        await this.audit.record(
          manager,
          actor,
          "point_cycle_adjustment",
          { id: submission.id, name: submission.originalFileName },
          reason,
          {
            ...before,
            finalScore: previousFinalScore,
            settlementRatio: previousSettlementRatio,
            invalidDurationMs: previousInvalidDurationMs,
            effectiveDurationMs: previousEffectiveDurationMs,
            points: previousPoints,
          },
          {
            ...after,
            adjustmentId: adjustment.id,
            pointCycleItemId: lockedItem.id,
            settlementRatio: cycleSettlementRatio,
            effectiveDurationMs: billableDurationMs,
            points: nextPoints,
            pointsDelta,
            assetStatus: submission.assetStatus,
            quarantineReason: submission.quarantineReason,
          },
        );
        if (quarantineAction) {
          await this.audit.record(
            manager,
            actor,
            quarantineAction,
            { id: submission.id, name: submission.originalFileName },
            submission.assetStatus === "quarantined"
              ? "人工复核将视频移入敏感隔离区"
              : "人工复核解除视频敏感隔离",
            {
              assetStatus: previousAssetStatus,
              quarantineReason: previousQuarantineReason,
            },
            {
              assetStatus: submission.assetStatus,
              quarantineReason: submission.quarantineReason,
            },
          );
        }
        return;
      }
      await this.audit.record(
        manager,
        actor,
        "quality_review",
        { id: submission.id, name: submission.originalFileName },
        reason,
        before,
        {
          ...after,
          assetStatus: submission.assetStatus,
          quarantineReason: submission.quarantineReason,
        },
      );
      if (quarantineAction) {
        await this.audit.record(
          manager,
          actor,
          quarantineAction,
          { id: submission.id, name: submission.originalFileName },
          submission.assetStatus === "quarantined"
            ? "人工复核将视频移入敏感隔离区"
            : "人工复核解除视频敏感隔离",
          {
            assetStatus: previousAssetStatus,
            quarantineReason: previousQuarantineReason,
          },
          {
            assetStatus: submission.assetStatus,
            quarantineReason: submission.quarantineReason,
          },
        );
      }
    });

    return this.get(actor, id);
  }

  async renameSubmission(
    actor: PublicUser,
    id: string,
    input: RenameSubmissionDto,
  ) {
    this.policy.requireSubmissionRename(actor);
    const fileName = input.fileName.trim();
    if (!fileName) {
      throw new SubmissionFailure(
        "SUBMISSION_NAME_REQUIRED",
        "请填写视频文件名",
        400,
      );
    }
    const reason = input.reason?.trim() || "管理员重命名提交数据";

    await this.dataSource.transaction(async (manager) => {
      const submission = await manager
        .getRepository(SubmissionEntity)
        .findOne({
          where: { id },
          lock: { mode: "pessimistic_write" },
        });
      if (!submission) {
        throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
      }
      await this.assertSubmissionNotLockedForManagement(
        manager,
        id,
        "重命名",
      );
      const expectedExtension = expectedVideoExtension(submission.contentType);
      if (
        expectedExtension &&
        extname(fileName).toLocaleLowerCase("en-US") !== expectedExtension
      ) {
        throw new SubmissionFailure(
          "INVALID_FILE_NAME",
          "文件扩展名需与视频格式保持一致",
          400,
        );
      }
      if (submission.originalFileName === fileName) return;

      const previousFileName = submission.originalFileName;
      submission.originalFileName = fileName;
      await manager.getRepository(SubmissionEntity).save(submission);
      await this.audit.record(
        manager,
        actor,
        "submission_rename",
        { id: submission.id, name: fileName },
        reason,
        { fileName: previousFileName },
        { fileName },
      );
    });

    return this.get(actor, id);
  }

  async rerunAiQuality(actor: PublicUser, id: string, reasonInput: string) {
    this.policy.requireAiQualityRerun(actor);
    const reason = reasonInput.trim();
    if (!reason) {
      throw new SubmissionFailure(
        "RERUN_REASON_REQUIRED",
        "请填写重跑原因",
        400,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const submission = await manager
        .getRepository(SubmissionEntity)
        .findOne({
          where: { id },
          lock: { mode: "pessimistic_write" },
        });
      if (!submission) {
        throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
      }
      if (submission.uploadStatus !== "uploaded") {
        throw new SubmissionFailure(
          "UPLOAD_NOT_COMPLETED",
          "视频尚未完成上传，不能重跑 AI 质检",
          409,
        );
      }
      if (
        !["awaiting_ai", "completed", "system_failed", "stuck"].includes(
          submission.processingStatus,
        )
      ) {
        throw new SubmissionFailure(
          "AI_RERUN_NOT_READY",
          "视频尚未完成媒体解析，不能重跑 AI 质检",
          409,
        );
      }
      const metadata = await manager
        .getRepository(MediaMetadataEntity)
        .exists({ where: { submissionId: id } });
      if (!metadata) {
        throw new SubmissionFailure(
          "MEDIA_METADATA_NOT_READY",
          "视频媒体元数据尚未生成，不能重跑 AI 质检",
          409,
        );
      }
      const locked = await manager
        .getRepository(PointCycleItemEntity)
        .exists({ where: { submissionId: id } });
      if (locked) {
        throw new SubmissionFailure(
          "POINT_CYCLE_LOCKED",
          "视频已进入结算周期，不能重跑 AI 质检",
          409,
        );
      }

      const quality = await manager
        .getRepository(VideoQualityResultEntity)
        .findOne({
          where: { submissionId: id },
          lock: { mode: "pessimistic_write" },
        });
      const before = {
        processingStatus: submission.processingStatus,
        qualityStatus: quality?.status ?? null,
        attempts: quality?.attempts ?? 0,
      };
      if (quality) {
        quality.status = "queued";
        quality.finalScore = null;
        quality.rawTotalScore = null;
        quality.settlementRatio = null;
        quality.passed = null;
        quality.invalidDurationMs = null;
        quality.billableDurationMs = null;
        quality.manualFinalScore = null;
        quality.manualSettlementRatio = null;
        quality.manualInvalidDurationMs = null;
        quality.manualBillableDurationMs = null;
        quality.manualIssues = null;
        quality.manualReviewReason = null;
        quality.manualReviewedByAccountId = null;
        quality.manualReviewedByName = null;
        quality.manualReviewedAt = null;
        quality.summary = "";
        quality.recommendations = [];
        quality.deductions = [];
        quality.reviewRequired = false;
        quality.reviewReasons = [];
        quality.normalizedResult = null;
        quality.rawModelResult = null;
        quality.lastError = null;
        quality.progressStage = null;
        quality.progressUpdatedAt = null;
        quality.stuckReason = null;
        quality.startedAt = null;
        quality.completedAt = null;
        // 重跑使用当前生效的提示词/规则/标签快照（例如提示词升级后重跑可识别新场景分类）；
        // 任务要求沿用提交时锁定的快照，保证判定基准一致。
        const [activePrompt, qualityRule, labelSet] = await Promise.all([
          this.prompts.getActive(),
          this.qualityRules.ensureDefault(),
          this.labelSets.ensureDefault(),
        ]);
        const ruleSnapshot = qualityRuleSnapshot(qualityRule);
        const labelsSnapshot = labelSetSnapshot(labelSet);
        const taskSnapshot = submission.taskRequirementsSnapshot
          ? parseTaskRequirementsSnapshot(submission.taskRequirementsSnapshot)
          : null;
        const systemPromptSnapshot = evaluationSystemPrompt({
          basePrompt: activePrompt.systemPrompt,
          qualityRule: ruleSnapshot,
          labelSet: labelsSnapshot,
          taskRequirements: taskSnapshot,
        });
        quality.promptVersionId = activePrompt.id;
        quality.promptRevision = activePrompt.revision;
        quality.promptContentSha256 = promptContentSha256(systemPromptSnapshot);
        quality.systemPromptSnapshot = systemPromptSnapshot;
        quality.qualityRuleVersionId = qualityRule.id;
        quality.qualityRuleRevision = qualityRule.revision;
        quality.qualityRuleSnapshot = ruleSnapshot;
        quality.labelSetVersionId = labelSet.id;
        quality.labelSetRevision = labelSet.revision;
        quality.labelSetSnapshot = labelsSnapshot;
        quality.initialModel = activePrompt.initialModel;
        quality.reviewModel = activePrompt.reviewModel;
        await manager.getRepository(VideoQualityResultEntity).save(quality);
      }

      submission.processingStatus = "awaiting_ai";
      submission.failureCode = null;
      submission.failureMessage = null;
      submission.assetStatus = "active";
      submission.quarantineReason = null;
      submission.quarantinedAt = null;
      submission.quarantinedByAccountId = null;
      submission.quarantinedByName = null;
      await manager.getRepository(SubmissionEntity).save(submission);

      const outboxRepository = manager.getRepository(JobOutboxEntity);
      const existingEvent = await outboxRepository.findOne({
        where: { aggregateId: submission.id, eventType: "ai.quality.v1" },
        lock: { mode: "pessimistic_write" },
      });
      if (existingEvent) {
        existingEvent.payload = { submissionId: submission.id };
        existingEvent.status = "pending";
        existingEvent.attempts = 0;
        existingEvent.availableAt = new Date();
        existingEvent.publishedAt = null;
        existingEvent.lastError = null;
        await outboxRepository.save(existingEvent);
      } else {
        await outboxRepository.save({
          id: `JOB-${randomUUID()}`,
          aggregateType: "submission",
          aggregateId: submission.id,
          eventType: "ai.quality.v1",
          payload: { submissionId: submission.id },
          status: "pending",
          attempts: 0,
          availableAt: new Date(),
        });
      }
      await this.audit.record(
        manager,
        actor,
        "ai_quality_rerun",
        { id: submission.id, name: submission.originalFileName },
        reason,
        before,
        {
          processingStatus: "awaiting_ai",
          qualityStatus: "queued",
          attempts: quality?.attempts ?? 0,
          assetStatus: submission.assetStatus,
        },
      );
    });

    return this.get(actor, id);
  }

  async deleteSubmission(
    actor: PublicUser,
    id: string,
    input: DeleteSubmissionDto,
  ) {
    this.policy.requireSubmissionDelete(actor);
    const reason = input.reason.trim();
    if (!reason) {
      throw new SubmissionFailure(
        "DELETE_REASON_REQUIRED",
        "请填写删除原因",
        400,
      );
    }

    const now = new Date();
    const pending = await this.dataSource.transaction(async (manager) => {
      const submission = await manager
        .getRepository(SubmissionEntity)
        .findOne({
          where: { id },
          lock: { mode: "pessimistic_write" },
        });
      if (!submission) {
        throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
      }
      if (submission.storageStatus === "delete_pending") {
        if (submission.storageDeleteMode !== "submission") {
          throw new SubmissionFailure(
            "OBJECT_DELETE_IN_PROGRESS",
            "视频对象删除正在进行，不能同时删除提交记录",
            409,
          );
        }
        return submission;
      }
      if (
        ACTIVE_PROCESSING_STATUSES.has(submission.processingStatus) ||
        submission.uploadStatus === "completing"
      ) {
        throw new SubmissionFailure(
          "SUBMISSION_IN_PROCESSING",
          "视频正在处理，不能删除提交记录",
          409,
        );
      }
      await this.assertSubmissionNotLockedForManagement(
        manager,
        id,
        "删除",
      );

      if (
        submission.uploadStatus === "uploaded" &&
        submission.storageStatus !== "deleted"
      ) {
        if (
          !input.force &&
          submission.storageRetainUntil &&
          submission.storageRetainUntil.getTime() > now.getTime()
        ) {
          throw new SubmissionFailure(
            "RETENTION_NOT_EXPIRED",
            "视频仍在保留期内，需强制删除确认后才能删除提交记录",
            409,
          );
        }
        submission.storageDeleteObjectKeys =
          await this.collectSubmissionObjectKeys(manager, submission);
      } else {
        submission.storageDeleteObjectKeys = [];
      }
      submission.storageStatus = "delete_pending";
      submission.storageDeleteMode = "submission";
      submission.storageDeleteForce = input.force === true;
      submission.storageDeletedByAccountId = actor.id;
      submission.storageDeletedByName = actor.displayName;
      submission.storageDeleteReason = reason;
      return await manager.getRepository(SubmissionEntity).save(submission);
    });
    const result = {
      deletedSubmissionId: id,
      deletedFileName: pending.originalFileName,
      deletedObjectKeys: pending.storageDeleteObjectKeys,
      abortedUploadId:
        pending.uploadStatus === "uploading"
          ? pending.multipartUploadId ?? undefined
          : undefined,
    };
    await this.processPendingStorageDelete(id);
    return result;
  }

  async clearDuplicateCandidate(
    actor: PublicUser,
    id: string,
    candidateId: string,
    reasonInput: string,
  ) {
    this.policy.requireDuplicateCandidateReview(actor);
    const reason = reasonInput.trim();
    if (!reason) {
      throw new SubmissionFailure(
        "DUPLICATE_CLEAR_REASON_REQUIRED",
        "请填写解除近似重复候选的原因",
        400,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const submission = await manager
        .getRepository(SubmissionEntity)
        .findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
      if (!submission) {
        throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
      }
      const candidate = await manager
        .getRepository(SubmissionDuplicateCandidateEntity)
        .findOne({
          where: { id: candidateId, submissionId: id },
          lock: { mode: "pessimistic_write" },
        });
      if (!candidate) {
        throw new SubmissionFailure(
          "DUPLICATE_CANDIDATE_NOT_FOUND",
          "近似重复候选不存在",
          404,
        );
      }
      if (candidate.status === "cleared") return;
      const candidateSubmission = await manager
        .getRepository(SubmissionEntity)
        .findOneBy({ id: candidate.candidateSubmissionId });

      candidate.status = "cleared";
      candidate.clearedReason = reason;
      candidate.clearedByAccountId = actor.id;
      candidate.clearedByName = actor.displayName;
      candidate.clearedAt = new Date();
      await manager
        .getRepository(SubmissionDuplicateCandidateEntity)
        .save(candidate);
      await this.audit.record(
        manager,
        actor,
        "duplicate_candidate_clear",
        { id: submission.id, name: submission.originalFileName },
        reason,
        {
          duplicateCandidateId: candidate.id,
          candidateSubmissionId: candidate.candidateSubmissionId,
          similarity: Number(candidate.similarity),
        },
        {
          status: "cleared",
          candidateFileName: candidateSubmission?.originalFileName ?? null,
        },
      );
    });

    return this.get(actor, id);
  }

  async preview(actor: PublicUser, id: string) {
    const submission = await this.findEntity(id);
    this.policy.requireRead(actor, submission);
    if (submission.storageStatus !== "available") {
      throw new SubmissionFailure(
        submission.storageStatus === "deleted"
          ? "OBJECT_DELETED"
          : "OBJECT_DELETE_IN_PROGRESS",
        submission.storageStatus === "deleted"
          ? "视频对象已删除，不能预览"
          : "视频对象正在删除，暂不能预览",
        submission.storageStatus === "deleted" ? 410 : 409,
      );
    }
    if (submission.uploadStatus !== "uploaded") {
      throw new SubmissionFailure(
        "PREVIEW_NOT_READY",
        "视频尚未完成上传，暂不能预览",
        409,
      );
    }
    const metadata = await this.dataSource
      .getRepository(MediaMetadataEntity)
      .findOneBy({ submissionId: id });
    const segments = await this.dataSource
      .getRepository(MediaSegmentEntity)
      .find({
        where: { submissionId: id },
        order: { startSeconds: "ASC" },
      });
    const videoObjectKey = metadata?.previewObjectKey ?? submission.objectKey;
    const signed = await this.storage.presignDownloadObject({
      objectKey: videoObjectKey,
      expiresInSeconds: PREVIEW_URL_TTL_SECONDS,
    });
    const thumbnail =
      metadata?.thumbnailObjectKey
        ? await this.storage.presignDownloadObject({
            objectKey: metadata.thumbnailObjectKey,
            expiresInSeconds: PREVIEW_URL_TTL_SECONDS,
          })
        : null;
    const evidenceFrames = await Promise.all(
      segments.flatMap((segment) =>
        segment.evidenceObjectKey
          ? [
              this.storage
                .presignDownloadObject({
                  objectKey: segment.evidenceObjectKey,
                  expiresInSeconds: PREVIEW_URL_TTL_SECONDS,
                })
                .then((evidence) => ({
                  segmentId: segment.id,
                  type: segment.type,
                  startSeconds: Number(segment.startSeconds),
                  endSeconds: Number(segment.endSeconds),
                  url: evidence.url,
                  expiresAt: evidence.expiresAt.getTime(),
                  contentType: "image/jpeg",
                })),
            ]
          : [],
      ),
    );
    await this.audit.record(
      this.dataSource.manager,
      actor,
      "storage_preview_link",
      { id: submission.id, name: submission.originalFileName },
      "生成视频预览短期访问链接",
      null,
      {
        objectKey: videoObjectKey,
        source: metadata?.previewObjectKey ? "web_preview" : "original",
        hlsMasterObjectKey: metadata?.hlsMasterObjectKey ?? null,
        expiresInSeconds: PREVIEW_URL_TTL_SECONDS,
        thumbnailObjectKey: metadata?.thumbnailObjectKey ?? null,
        evidenceFrameCount: evidenceFrames.length,
      },
    );
    return {
      url: signed.url,
      expiresAt: signed.expiresAt.getTime(),
      contentType: metadata?.previewObjectKey ? "video/mp4" : submission.contentType,
      fileName: submission.originalFileName,
      source: metadata?.previewObjectKey ? "web_preview" : "original",
      hls:
        metadata?.hlsMasterObjectKey && metadata.hlsBaseObjectKey
          ? {
              url: `/api/v1/submissions/${encodeURIComponent(submission.id)}/preview/hls/master.m3u8`,
              contentType: "application/vnd.apple.mpegurl",
              qualities: metadata.hlsQualities,
            }
          : undefined,
      thumbnail: thumbnail
        ? {
            url: thumbnail.url,
            expiresAt: thumbnail.expiresAt.getTime(),
            contentType: "image/jpeg",
          }
        : undefined,
      evidenceFrames,
    };
  }

  async previewHlsResource(actor: PublicUser, id: string, fileName: string) {
    if (!HLS_FILE_NAME_PATTERN.test(fileName)) {
      throw new SubmissionFailure("HLS_NOT_FOUND", "HLS 资源不存在", 404);
    }
    const submission = await this.findEntity(id);
    this.policy.requireRead(actor, submission);
    if (submission.storageStatus !== "available") {
      throw new SubmissionFailure(
        submission.storageStatus === "deleted"
          ? "OBJECT_DELETED"
          : "OBJECT_DELETE_IN_PROGRESS",
        submission.storageStatus === "deleted"
          ? "视频对象已删除，不能预览"
          : "视频对象正在删除，暂不能预览",
        submission.storageStatus === "deleted" ? 410 : 409,
      );
    }
    const metadata = await this.dataSource
      .getRepository(MediaMetadataEntity)
      .findOneBy({ submissionId: id });
    if (!metadata?.hlsBaseObjectKey || !metadata.hlsMasterObjectKey) {
      throw new SubmissionFailure("HLS_NOT_READY", "HLS 预览尚未生成", 404);
    }
    const objectKey =
      fileName === "master.m3u8"
        ? metadata.hlsMasterObjectKey
        : `${metadata.hlsBaseObjectKey}/${fileName}`;
    if (!metadata.hlsObjectKeys.includes(objectKey)) {
      throw new SubmissionFailure("HLS_NOT_FOUND", "HLS 资源不存在", 404);
    }
    const stream = await this.storage.readObject({ objectKey });
    return {
      contentType: fileName.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : "video/mp2t",
      stream: stream as Readable,
    };
  }

  async deleteObjects(
    actor: PublicUser,
    id: string,
    input: DeleteSubmissionObjectsDto,
  ) {
    this.policy.requireStorageDelete(actor);
    const reason = input.reason.trim();
    if (!reason) {
      throw new SubmissionFailure(
        "DELETE_REASON_REQUIRED",
        "请填写删除原因",
        400,
      );
    }

    const now = new Date();
    const pending = await this.dataSource.transaction(async (manager) => {
      const submission = await manager
        .getRepository(SubmissionEntity)
        .findOne({
          where: { id },
          lock: { mode: "pessimistic_write" },
        });
      if (!submission) {
        throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
      }
      if (submission.storageStatus === "delete_pending") {
        if (submission.storageDeleteMode !== "objects") {
          throw new SubmissionFailure(
            "SUBMISSION_DELETE_IN_PROGRESS",
            "提交记录删除正在进行",
            409,
          );
        }
        return submission;
      }
      if (submission.storageStatus === "deleted") {
        throw new SubmissionFailure(
          "OBJECT_ALREADY_DELETED",
          "视频对象已删除",
          409,
        );
      }
      if (submission.uploadStatus !== "uploaded") {
        throw new SubmissionFailure(
          "OBJECT_NOT_UPLOADED",
          "视频尚未完成上传，不能删除对象",
          409,
        );
      }
      if (ACTIVE_PROCESSING_STATUSES.has(submission.processingStatus)) {
        throw new SubmissionFailure(
          "OBJECT_IN_PROCESSING",
          "视频正在处理，不能删除对象",
          409,
        );
      }
      if (
        !input.force &&
        submission.storageRetainUntil &&
        submission.storageRetainUntil.getTime() > now.getTime()
      ) {
        throw new SubmissionFailure(
          "RETENTION_NOT_EXPIRED",
          "视频仍在保留期内，需强制删除确认后才能删除对象",
          409,
        );
      }

      const objectKeys = await this.collectSubmissionObjectKeys(
        manager,
        submission,
      );
      submission.storageStatus = "delete_pending";
      submission.storageDeletedByAccountId = actor.id;
      submission.storageDeletedByName = actor.displayName;
      submission.storageDeleteReason = reason;
      submission.storageDeleteMode = "objects";
      submission.storageDeleteObjectKeys = objectKeys;
      submission.storageDeleteForce = input.force === true;
      return await manager.getRepository(SubmissionEntity).save(submission);
    });
    await this.processPendingStorageDelete(id);
    return {
      ...(await this.get(actor, id)),
      deletedObjectKeys: pending.storageDeleteObjectKeys,
    };
  }

  private async assertSubmissionNotLockedForManagement(
    manager: EntityManager,
    id: string,
    action: string,
  ): Promise<void> {
    const pointItems = await manager
      .getRepository(PointCycleItemEntity)
      .countBy({ submissionId: id });
    const pointAdjustments = await manager
      .getRepository(PointCycleAdjustmentEntity)
      .countBy({ submissionId: id });
    const deliveryItems = await manager
      .getRepository(DeliveryPackageItemEntity)
      .countBy({ submissionId: id });
    if (pointItems + pointAdjustments > 0) {
      throw new SubmissionFailure(
        "SUBMISSION_LOCKED",
        `视频已进入结算周期，不能${action}`,
        409,
      );
    }
    if (deliveryItems > 0) {
      throw new SubmissionFailure(
        "SUBMISSION_DELIVERED",
        `视频已进入交付包，不能${action}`,
        409,
      );
    }
  }

  private async collectSubmissionObjectKeys(
    manager: EntityManager,
    submission: SubmissionEntity,
  ): Promise<string[]> {
    const metadata = await manager
      .getRepository(MediaMetadataEntity)
      .findOneBy({ submissionId: submission.id });
    const segments = await manager.getRepository(MediaSegmentEntity).find({
      where: { submissionId: submission.id },
    });
    return Array.from(
      new Set(
        [
          submission.objectKey,
          metadata?.previewObjectKey,
          metadata?.thumbnailObjectKey,
          metadata?.hlsMasterObjectKey,
          ...hlsDerivedObjectKeys(metadata),
          ...segments.map((segment) => segment.evidenceObjectKey),
        ].filter((key): key is string => Boolean(key)),
      ),
    );
  }

  private async findEntity(id: string): Promise<SubmissionEntity> {
    const submission = await this.submissions.findOneBy({ id });
    if (!submission) {
      throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
    }
    return submission;
  }

  private applyListScope(
    query: ReturnType<Repository<SubmissionEntity>["createQueryBuilder"]>,
    actor: PublicUser,
  ): void {
    if (actor.role === "leader") {
      query.andWhere("submission.teamId = :teamId", {
        teamId: actor.teamId,
      });
    } else if (actor.role === "collector") {
      query.andWhere("submission.ownerId = :ownerId", {
        ownerId: actor.id,
      });
    }
  }

  private createListIdQuery(
    actor: PublicUser,
    status: SubmissionListStatus,
    q: string | undefined,
    taskId?: string,
    extra: {
      scene?: string;
      dateFrom?: string;
      dateTo?: string;
      sortBy?: "createdAt" | "finalScore";
      sortOrder?: "asc" | "desc";
    } = {},
  ) {
    const idQuery = this.submissions
      .createQueryBuilder("submission")
      .leftJoin("submission.owner", "owner")
      .leftJoin("submission.team", "team")
      .leftJoin(
        CollectionTaskEntity,
        "collectionTask",
        "collectionTask.id = submission.taskId",
      )
      .leftJoin(
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .leftJoin(
        PointCycleItemEntity,
        "pointCycleItem",
        "pointCycleItem.submissionId = submission.id",
      )
      .leftJoin(
        SubmissionDuplicateCandidateEntity,
        "duplicateCandidate",
        "duplicateCandidate.submissionId = submission.id AND duplicateCandidate.status = :duplicateCandidateStatus",
        { duplicateCandidateStatus: "candidate" },
      )
      .select("submission.id", "id")
      .addSelect("submission.createdAt", "created_at")
      .addSelect("quality.finalScore", "final_score")
      .distinct(true);
    this.applyListScope(idQuery, actor);
    this.applyListFilters(idQuery, status, q, taskId);

    // 场景筛选（提交时快照的任务场景名）
    const scene = extra.scene?.trim();
    if (scene) {
      idQuery.andWhere("submission.taskSceneName = :scene", { scene });
    }
    // 提交时间范围
    if (extra.dateFrom) {
      idQuery.andWhere("submission.createdAt >= :dateFrom", {
        dateFrom: new Date(extra.dateFrom),
      });
    }
    if (extra.dateTo) {
      idQuery.andWhere("submission.createdAt <= :dateTo", {
        dateTo: new Date(extra.dateTo),
      });
    }

    // 排序：提交时间 / 质量评分 × 升/降序
    const order: "ASC" | "DESC" =
      extra.sortOrder === "asc" ? "ASC" : "DESC";
    if (extra.sortBy === "finalScore") {
      return idQuery
        .orderBy("quality.finalScore", order, "NULLS LAST")
        .addOrderBy("submission.createdAt", "DESC")
        .addOrderBy("submission.id", "DESC");
    }
    return idQuery
      .orderBy("submission.createdAt", order)
      .addOrderBy("submission.id", "DESC");
  }

  private applyListFilters(
    query: ReturnType<Repository<SubmissionEntity>["createQueryBuilder"]>,
    status: SubmissionListStatus,
    search: string | undefined,
    taskId?: string,
  ): void {
    if (search) {
      const term = `%${escapeLike(search).toLowerCase()}%`;
      query.andWhere(
        new Brackets((builder) => {
          builder
            .where("LOWER(submission.id) LIKE :search ESCAPE '\\'", {
              search: term,
            })
            .orWhere(
              "LOWER(submission.originalFileName) LIKE :search ESCAPE '\\'",
              { search: term },
            )
            .orWhere("LOWER(owner.displayName) LIKE :search ESCAPE '\\'", {
              search: term,
            })
            .orWhere("LOWER(team.name) LIKE :search ESCAPE '\\'", {
              search: term,
            })
            .orWhere(
              "LOWER(COALESCE(submission.taskSceneName, '')) LIKE :search ESCAPE '\\'",
              { search: term },
            )
            .orWhere(
              "LOWER(COALESCE(collectionTask.title, '')) LIKE :search ESCAPE '\\'",
              { search: term },
            );
        }),
      );
    }

    if (taskId === "__none__") {
      query.andWhere("submission.taskId IS NULL");
    } else if (taskId) {
      query.andWhere("submission.taskId = :taskId", { taskId });
    }

    if (status === "all") return;
    if (status === "processing") {
      query.andWhere("submission.processingStatus IN (:...processing)", {
        processing: ["probing", "awaiting_ai", "ai_processing"],
      });
      return;
    }
    if (status === "failed") {
      query.andWhere(
        new Brackets((builder) => {
          builder
            .where("submission.processingStatus = :systemFailed", {
              systemFailed: "system_failed",
            })
            .orWhere("quality.status = :qualityFailed", {
              qualityFailed: "hard_reject",
            })
            .orWhere(
              `quality.status IN (:...scoredQualityStatuses) AND ${QUALITY_FAILED_SQL}`,
              {
                scoredQualityStatuses: ["scored", "review_pending"],
              },
            );
        }),
      );
      return;
    }
    if (status === "passed") {
      query.andWhere(
        `quality.status IN (:...passedStatuses) AND ${QUALITY_PASSED_SQL}`,
        {
          passedStatuses: ["scored", "review_pending"],
        },
      );
      return;
    }
    if (status === "reviewed") {
      query.andWhere(
        new Brackets((builder) => {
          builder
            .where("quality.status IN (:...reviewedStatuses)", {
              reviewedStatuses: [
                "scored",
                "hard_reject",
                "system_failed",
              ],
            })
            .orWhere(
              "quality.status = :reviewPending AND quality.manualFinalScore IS NOT NULL",
              { reviewPending: "review_pending" },
            )
            .orWhere("submission.processingStatus = :systemFailed", {
              systemFailed: "system_failed",
            });
        }),
      );
      return;
    }
    if (status === "quality_results") {
      query.andWhere(
        new Brackets((builder) => {
          builder
            .where("quality.status IN (:...qualityResultStatuses)", {
              qualityResultStatuses: [
                "scored",
                "hard_reject",
                "review_pending",
                "system_failed",
              ],
            })
            .orWhere("submission.processingStatus = :systemFailed", {
              systemFailed: "system_failed",
            });
        }),
      );
      return;
    }
    if (status === "unsettled") {
      query
        .andWhere("submission.processingStatus = :completed", {
          completed: "completed",
        })
        .andWhere("submission.assetStatus = :activeAsset", {
          activeAsset: "active",
        })
        .andWhere("submission.storageStatus = :availableStorage", {
          availableStorage: "available",
        })
        .andWhere(
          `quality.status IN (:...passedStatuses) AND ${QUALITY_PASSED_SQL}`,
          {
            passedStatuses: ["scored", "review_pending"],
          },
        )
        .andWhere(POINT_RULE_ELIGIBLE_SQL)
        .andWhere("pointCycleItem.id IS NULL")
        .andWhere("duplicateCandidate.id IS NULL");
      return;
    }
    if (status === "review_queue") {
      query
        .andWhere("submission.processingStatus = :completed", {
          completed: "completed",
        })
        .andWhere("submission.assetStatus = :activeAsset", {
          activeAsset: "active",
        })
        .andWhere("submission.storageStatus = :availableStorage", {
          availableStorage: "available",
        })
        .andWhere(
          new Brackets((builder) => {
            builder
              .where(
                "quality.status = :reviewPending AND quality.manualFinalScore IS NULL",
                { reviewPending: "review_pending" },
              )
              .orWhere(
                new Brackets((eligible) => {
                  eligible
                    .where(
                      `quality.status IN (:...passedStatuses) AND ${QUALITY_PASSED_SQL}`,
                      { passedStatuses: ["scored", "review_pending"] },
                    )
                    .andWhere(POINT_RULE_ELIGIBLE_SQL);
                }),
              );
          }),
        )
        .andWhere("pointCycleItem.id IS NULL");
      return;
    }
    if (status === "queued") {
      query.andWhere("submission.processingStatus IN (:...queued)", {
        queued: ["queued", "awaiting_ai"],
      });
      return;
    }
    query.andWhere("submission.processingStatus = :status", { status });
  }

  private async listTaskSources(actor: PublicUser): Promise<
    Array<{ taskId: string; title: string; sceneName: string }>
  > {
    const query = this.submissions
      .createQueryBuilder("submission")
      .leftJoin(
        CollectionTaskEntity,
        "collectionTask",
        "collectionTask.id = submission.taskId",
      )
      .select("submission.taskId", "task_id")
      .addSelect("submission.taskSceneName", "scene_name")
      .addSelect("collectionTask.title", "task_title")
      .where("submission.taskId IS NOT NULL")
      .distinct(true);
    this.applyListScope(query, actor);
    const rows = await query.getRawMany<{
      task_id: string;
      scene_name: string | null;
      task_title: string | null;
    }>();
    const sources = new Map<
      string,
      { taskId: string; title: string; sceneName: string }
    >();
    for (const row of rows) {
      if (!row.task_id || sources.has(row.task_id)) continue;
      const sceneName = row.scene_name?.trim() || "未命名场景";
      sources.set(row.task_id, {
        taskId: row.task_id,
        title: row.task_title?.trim() || sceneName,
        sceneName,
      });
    }
    return [...sources.values()].sort((left, right) =>
      left.title.localeCompare(right.title, "zh-CN"),
    );
  }

  /**
   * 任务维度统计（角色范围与提交列表一致）：
   * 每个任务（含未关联任务）的提交数 / 已质检 / 通过 / 未通过 / 均分 / 有效时长 / 锁定积分。
   * 用于三个角色数据页的「按任务汇总」展示，与 taskId 筛选联动。
   */
  async taskStats(
    actor: PublicUser,
  ): Promise<{ stats: SubmissionTaskStat[] }> {
    const query = this.submissions
      .createQueryBuilder("submission")
      .leftJoin(
        CollectionTaskEntity,
        "task",
        "task.id = submission.taskId",
      )
      .leftJoin(
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .leftJoin(
        PointCycleItemEntity,
        "cycle",
        "cycle.submissionId = submission.id",
      )
      .select("submission.taskId", "task_id")
      .addSelect("task.title", "task_title")
      .addSelect("task.scene_name", "scene_name")
      .addSelect("task.task_type", "task_type")
      .addSelect("COUNT(DISTINCT submission.id)", "total")
      .addSelect(
        `COUNT(quality.submissionId) FILTER (
           WHERE quality.status IN ('scored', 'review_pending', 'hard_reject')
         )`,
        "reviewed",
      )
      .addSelect(
        `COUNT(quality.submissionId) FILTER (WHERE quality.passed = true)`,
        "passed",
      )
      .addSelect(
        `COUNT(quality.submissionId) FILTER (
           WHERE quality.passed = false OR quality.status = 'hard_reject'
         )`,
        "failed",
      )
      .addSelect(
        `AVG(COALESCE(quality.manual_final_score, quality.final_score)::float8)`,
        "avg_score",
      )
      .addSelect(
        `COALESCE(SUM(
           COALESCE(
             quality.manual_billable_duration_ms,
             quality.billable_duration_ms,
             0
           )
         ), 0)`,
        "effective_ms",
      )
      .addSelect(
        `COALESCE(SUM(cycle.points::float8), 0)`,
        "locked_points",
      )
      .groupBy("submission.taskId")
      .addGroupBy("task.title")
      .addGroupBy("task.scene_name")
      .addGroupBy("task.task_type");
    this.applyListScope(query, actor);
    const rows = await query
      .orderBy("total", "DESC")
      .addOrderBy("task_title", "ASC")
      .getRawMany<{
        task_id: string | null;
        task_title: string | null;
        scene_name: string | null;
        task_type: string | null;
        total: string;
        reviewed: string;
        passed: string;
        failed: string;
        avg_score: string | null;
        effective_ms: string;
        locked_points: string;
      }>();
    const stats: SubmissionTaskStat[] = rows.map((row) => {
      const total = Number(row.total) || 0;
      const reviewed = Number(row.reviewed) || 0;
      const passed = Number(row.passed) || 0;
      const failed = Number(row.failed) || 0;
      const avgScoreRaw = Number(row.avg_score);
      return {
        taskId: row.task_id ?? null,
        title: row.task_id
          ? row.task_title?.trim() || "未命名任务"
          : "未关联任务",
        sceneName: row.task_id ? (row.scene_name?.trim() ?? "") : "",
        taskType: row.task_type as SubmissionTaskStat["taskType"],
        total,
        reviewed,
        passed,
        failed,
        pending: Math.max(0, total - reviewed),
        passRate:
          reviewed > 0 ? Math.round((passed / reviewed) * 1_000) / 10 : null,
        avgScore: Number.isFinite(avgScoreRaw)
          ? Math.round(avgScoreRaw * 10) / 10
          : null,
        effectiveMinutes:
          Math.round((Number(row.effective_ms) || 0) / 60_000 * 10) / 10,
        lockedPoints:
          Math.round((Number(row.locked_points) || 0) * 100) / 100,
      };
    });
    return { stats };
  }

  private async findDetailedByIds(
    ids: string[],
  ): Promise<SubmissionEntity[]> {
    if (ids.length === 0) return [];
    return await this.submissions
      .createQueryBuilder("submission")
      .leftJoinAndSelect("submission.owner", "owner")
      .leftJoinAndSelect("submission.team", "team")
      .leftJoinAndMapOne(
        "submission.collectionTask",
        CollectionTaskEntity,
        "collectionTask",
        "collectionTask.id = submission.taskId",
      )
      .leftJoinAndMapOne(
        "submission.metadata",
        MediaMetadataEntity,
        "metadata",
        "metadata.submissionId = submission.id",
      )
      .leftJoinAndMapMany(
        "submission.segments",
        MediaSegmentEntity,
        "segment",
        "segment.submissionId = submission.id",
      )
      .leftJoinAndMapOne(
        "submission.quality",
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .leftJoinAndMapMany(
        "submission.duplicateCandidates",
        SubmissionDuplicateCandidateEntity,
        "duplicateCandidate",
        "duplicateCandidate.submissionId = submission.id",
      )
      .leftJoinAndSelect(
        "duplicateCandidate.candidateSubmission",
        "duplicateCandidateSubmission",
      )
      .leftJoinAndMapMany(
        "submission.pointCycleItems",
        PointCycleItemEntity,
        "pointCycleItem",
        "pointCycleItem.submissionId = submission.id",
      )
      .leftJoinAndMapMany(
        "submission.reviewAuditLogs",
        AuditLogEntity,
        "reviewAudit",
        "reviewAudit.targetAccountId = submission.id AND reviewAudit.action IN (:...reviewActions)",
        { reviewActions: REVIEW_AUDIT_ACTIONS },
      )
      .where("submission.id IN (:...ids)", { ids })
      .orderBy("submission.createdAt", "DESC")
      .addOrderBy("segment.startSeconds", "ASC")
      .addOrderBy("duplicateCandidate.similarity", "DESC")
      .addOrderBy("reviewAudit.createdAt", "ASC")
      .getMany();
  }

  private async qualityRuleForResult(
    manager: EntityManager,
    quality: VideoQualityResultEntity,
  ): Promise<QualityRuleSnapshot> {
    if (quality.qualityRuleSnapshot) return quality.qualityRuleSnapshot;
    if (quality.qualityRuleVersionId) {
      const rule = await manager
        .getRepository(QualityRuleVersionEntity)
        .findOneBy({ id: quality.qualityRuleVersionId });
      if (rule) return qualityRuleSnapshot(rule);
    }
    return {
      id: "legacy-default",
      revision: 0,
      version: "legacy-default",
      passThreshold: 60,
      description: "历史任务默认质量规则",
    };
  }

  private async pointRuleForCycle(
    manager: EntityManager,
    cycleId: string,
  ): Promise<PointRuleSnapshot> {
    const cycle = await manager
      .getRepository(PointCycleEntity)
      .findOneBy({ id: cycleId });
    if (!cycle) throw new Error("积分周期不存在");
    if (cycle.pointRuleSnapshot) return cycle.pointRuleSnapshot;
    if (cycle.pointRuleVersionId) {
      const rule = await manager
        .getRepository(PointRuleVersionEntity)
        .findOneBy({ id: cycle.pointRuleVersionId });
      if (rule) {
        return {
          id: rule.id,
          revision: rule.revision,
          version: rule.version,
          defaultPointsPerMinute: Number(rule.defaultPointsPerMinute),
          coefficientBands: rule.coefficientBands,
          description: rule.description,
        };
      }
    }
    return {
      id: "legacy-default",
      revision: 0,
      version: "legacy-default",
      defaultPointsPerMinute: 0,
      coefficientBands: DEFAULT_COEFFICIENT_BANDS,
      description: "历史周期默认积分规则",
    };
  }

  private async processPendingStorageDelete(id: string): Promise<void> {
    const pending = await this.submissions.findOneBy({ id });
    if (!pending || pending.storageStatus !== "delete_pending") return;

    if (
      ["uploading", "completing"].includes(pending.uploadStatus) &&
      pending.multipartUploadId
    ) {
      try {
        await this.storage.abortMultipartUpload({
          objectKey: pending.objectKey,
          uploadId: pending.multipartUploadId,
        });
      } catch (abortError) {
        try {
          await this.storage.deleteObject({ objectKey: pending.objectKey });
        } catch {
          throw abortError;
        }
      }
    }
    for (const objectKey of pending.storageDeleteObjectKeys) {
      await this.storage.deleteObject({ objectKey });
    }

    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SubmissionEntity);
      const submission = await repository.findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!submission || submission.storageStatus !== "delete_pending") return;
      if (
        !submission.storageDeleteMode ||
        !submission.storageDeletedByAccountId ||
        !submission.storageDeletedByName ||
        !submission.storageDeleteReason
      ) {
        throw new Error("对象删除恢复信息不完整");
      }
      const now = new Date();
      const actor: PublicUser = {
        id: submission.storageDeletedByAccountId,
        displayName: submission.storageDeletedByName,
        username: "storage-reconciliation-worker",
        role: "admin",
        status: "active",
        updatedAt: 0,
      };
      const objectKeys = [...submission.storageDeleteObjectKeys];
      const force = submission.storageDeleteForce;
      const reason = submission.storageDeleteReason;
      if (submission.storageDeleteMode === "submission") {
        const abortedUploadId =
          submission.uploadStatus === "uploading"
            ? submission.multipartUploadId
            : null;
        await manager.getRepository(JobOutboxEntity).delete({
          aggregateId: submission.id,
        });
        await this.cancelAnnotationRuns(manager, submission.id);
        await this.audit.record(
          manager,
          actor,
          "submission_delete",
          { id: submission.id, name: submission.originalFileName },
          reason,
          {
            fileName: submission.originalFileName,
            uploadStatus: submission.uploadStatus,
            processingStatus: submission.processingStatus,
            storageStatus: "available",
            storageRetainUntil:
              submission.storageRetainUntil?.getTime() ?? null,
          },
          {
            deletedAt: now.getTime(),
            force,
            deletedObjectKeys: objectKeys,
            abortedUploadId,
          },
        );
        await repository.delete({ id });
        return;
      }

      const uploadWasActive = ["uploading", "completing"].includes(
        submission.uploadStatus,
      );
      submission.storageStatus = "deleted";
      submission.storageDeletedAt = now;
      submission.uploadStatus = "aborted";
      submission.multipartUploadId = null;
      submission.multipartCompletionParts = null;
      submission.assetStatus = "quarantined";
      submission.quarantineReason = "对象已删除";
      submission.quarantinedAt = now;
      submission.quarantinedByAccountId = actor.id;
      submission.quarantinedByName = actor.displayName;
      submission.failureCode = uploadWasActive
        ? "UPLOAD_ABORTED"
        : "OBJECT_DELETED";
      submission.failureMessage = uploadWasActive
        ? "上传已取消"
        : "视频对象已删除";
      submission.storageDeleteMode = null;
      submission.storageDeleteObjectKeys = [];
      submission.storageDeleteForce = false;
      await repository.save(submission);
      await manager.getRepository(JobOutboxEntity).delete({
        aggregateId: submission.id,
      });
      await this.cancelAnnotationRuns(manager, submission.id);
      await this.audit.record(
        manager,
        actor,
        "storage_object_delete",
        { id: submission.id, name: submission.originalFileName },
        reason,
        {
          storageStatus: "available",
          storageRetainUntil:
            submission.storageRetainUntil?.getTime() ?? null,
        },
        {
          storageStatus: "deleted",
          force,
          objectKeys,
          deletedAt: now.getTime(),
        },
      );
    });
  }

  async reconcileStorageOperations(limit = 25): Promise<{
    completedUploads: number;
    completedDeletes: number;
    failures: number;
  }> {
    const completing = await this.submissions.find({
      where: { uploadStatus: "completing" },
      order: { updatedAt: "ASC" },
      take: limit,
    });
    let completedUploads = 0;
    let failures = 0;
    for (const submission of completing) {
      try {
        const object = await this.ensureMultipartObject(submission);
        if (object.sizeBytes !== submission.expectedSizeBytes) {
          await this.markUploadSizeMismatch(submission.id);
        } else {
          await this.finalizeCompletedUpload(submission.id);
          completedUploads += 1;
        }
      } catch {
        failures += 1;
      }
    }

    const pendingDeletes = await this.submissions.find({
      where: { storageStatus: "delete_pending" },
      order: { updatedAt: "ASC" },
      take: Math.max(0, limit - completing.length),
    });
    let completedDeletes = 0;
    for (const submission of pendingDeletes) {
      try {
        await this.processPendingStorageDelete(submission.id);
        completedDeletes += 1;
      } catch {
        failures += 1;
      }
    }
    return { completedUploads, completedDeletes, failures };
  }

  private async cancelAnnotationRuns(
    manager: EntityManager,
    submissionId: string,
  ): Promise<void> {
    const repository = manager.getRepository(AnnotationRunEntity);
    const runs = await repository.find({ where: { submissionId } });
    if (runs.length === 0) return;
    await manager.getRepository(JobOutboxEntity).delete({
      aggregateId: In(runs.map((run) => run.id)),
    });
    await repository.update(
      {
        submissionId,
        executionStatus: In(["queued", "running", "retry_scheduled", "stuck"]),
      },
      {
        executionStatus: "cancelled",
        nextRetryAt: null,
        completedAt: new Date(),
        lastErrorCode: "SOURCE_DELETED",
        lastErrorMessage: "视频源对象已删除",
      },
    );
  }

  private async ensureMultipartObject(
    submission: SubmissionEntity,
  ): Promise<Awaited<ReturnType<ObjectStoragePort["headObject"]>>> {
    if (!submission.multipartUploadId || !submission.multipartCompletionParts) {
      throw new Error("上传完成恢复信息不完整");
    }
    try {
      await this.storage.completeMultipartUpload({
        objectKey: submission.objectKey,
        uploadId: submission.multipartUploadId,
        parts: submission.multipartCompletionParts,
      });
    } catch (completionError) {
      try {
        return await this.storage.headObject({ objectKey: submission.objectKey });
      } catch {
        throw completionError;
      }
    }
    return await this.storage.headObject({ objectKey: submission.objectKey });
  }

  private async finalizeCompletedUpload(id: string): Promise<SubmissionEntity> {
    return await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SubmissionEntity);
      const submission = await repository.findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!submission) {
        throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
      }
      if (submission.uploadStatus === "uploaded") return submission;
      if (submission.uploadStatus !== "completing") {
        throw new SubmissionFailure(
          "UPLOAD_NOT_ACTIVE",
          "当前上传任务不可完成",
          409,
        );
      }
      submission.uploadStatus = "uploaded";
      submission.processingStatus = "queued";
      submission.failureCode = null;
      submission.failureMessage = null;
      submission.uploadedAt = new Date();
      submission.multipartUploadId = null;
      submission.multipartCompletionParts = null;
      await repository.save(submission);
      await manager.getRepository(JobOutboxEntity).save({
        id: `JOB-${randomUUID()}`,
        aggregateType: "submission",
        aggregateId: submission.id,
        eventType: "media.probe.v1",
        payload: {
          submissionId: submission.id,
          objectKey: submission.objectKey,
          expectedSizeBytes: submission.expectedSizeBytes,
          checksumSha256: submission.checksumSha256,
        },
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
      });
      return submission;
    });
  }

  private async markUploadSizeMismatch(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SubmissionEntity);
      const submission = await repository.findOne({
        where: { id },
        lock: { mode: "pessimistic_write" },
      });
      if (!submission || submission.uploadStatus !== "completing") return;
      submission.uploadStatus = "uploaded";
      submission.processingStatus = "system_failed";
      submission.failureCode = "OBJECT_SIZE_MISMATCH";
      submission.failureMessage = "上传对象大小与创建上传时声明的不一致";
      submission.uploadedAt = new Date();
      submission.multipartUploadId = null;
      submission.multipartCompletionParts = null;
      await repository.save(submission);
    });
  }

  private requireUploading(submission: SubmissionEntity): void {
    if (
      submission.uploadStatus !== "uploading" ||
      submission.storageStatus !== "available" ||
      !submission.multipartUploadId
    ) {
      throw new SubmissionFailure(
        "UPLOAD_NOT_ACTIVE",
        "该视频当前没有可操作的上传任务",
        409,
      );
    }
  }
}
