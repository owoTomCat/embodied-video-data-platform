import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, In, Not, Repository, type EntityManager, type SelectQueryBuilder } from "typeorm";
import { randomUUID } from "node:crypto";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { AuditLogEntity } from "../database/entities/audit-log.entity.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { PointCycleItemEntity } from "../database/entities/point-cycle-item.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import { OperationsFailure } from "./operations-failure.js";
import { WorkerHeartbeatService } from "./worker-heartbeat.service.js";
import { enqueueAnnotationRun } from "../video-annotation/annotation-run.queue.js";
import type {
  AnnotationOperationsQueryDto,
  AnnotationOperationsView,
} from "./dto/annotation-operations-query.dto.js";

const MAX_AUTO_RETRY_ATTEMPTS = 3;

function redactAnnotationError(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
    .replace(/sk-(?:ws-)?[A-Za-z0-9._-]+/gu, "<redacted>")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gu, "<data-url-redacted>")
    .slice(0, 1_500);
}

const QUALITY_PASSED_SQL = `
  (
    quality.passed = true
    OR (
      quality.passed IS NULL
      AND quality.status = 'scored'
      AND COALESCE(quality.manualFinalScore, quality.finalScore) >= COALESCE(
        (quality.qualityRuleSnapshot ->> 'passThreshold')::numeric,
        60
      )
    )
  )
`;
const QUALITY_FAILED_SQL = `
  (
    quality.passed = false
    OR (
      quality.passed IS NULL
      AND quality.status = 'scored'
      AND COALESCE(quality.manualFinalScore, quality.finalScore) < COALESCE(
        (quality.qualityRuleSnapshot ->> 'passThreshold')::numeric,
        60
      )
    )
  )
`;
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

function assertAdmin(actor: PublicUser): void {
  if (actor.status !== "active" || actor.role !== "admin") {
    throw new OperationsFailure(
      "FORBIDDEN",
      "仅管理员可查看队列状态",
      403,
    );
  }
}

function assertActive(actor: PublicUser): void {
  if (actor.status !== "active") {
    throw new OperationsFailure("FORBIDDEN", "账号已停用", 403);
  }
}

function publicJob(job: JobOutboxEntity) {
  const now = Date.now();
  const createdAt = job.createdAt.getTime();
  const availableAt = job.availableAt.getTime();
  const publishedAt = job.publishedAt?.getTime();
  return {
    id: job.id,
    aggregateType: job.aggregateType,
    aggregateId: job.aggregateId,
    eventType: job.eventType,
    status: job.status,
    attempts: job.attempts,
    availableAt,
    publishedAt,
    lastError: job.lastError ?? undefined,
    createdAt,
    updatedAt: job.updatedAt.getTime(),
    ageMs: Math.max(0, now - createdAt),
    waitMs: Math.max(0, availableAt - now),
    queuedForMs: Math.max(0, Math.min(now, availableAt) - createdAt),
    publishLatencyMs:
      publishedAt === undefined ? undefined : Math.max(0, publishedAt - createdAt),
  };
}

type OperationsNotification = {
  id: string;
  title: string;
  detail: string;
  tone: "info" | "success" | "warning" | "danger";
  path: string;
  count: number;
  createdAt: number;
};

type NavigationBadge = {
  path: string;
  label: string;
  count: number;
};

function badgeLabel(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

@Injectable()
export class OperationsService {
  constructor(
    @InjectRepository(JobOutboxEntity)
    private readonly jobs: Repository<JobOutboxEntity>,
    @InjectRepository(SubmissionEntity)
    private readonly submissions: Repository<SubmissionEntity>,
    @InjectRepository(AnnotationRunEntity)
    private readonly annotationRunsRepository: Repository<AnnotationRunEntity>,
    @InjectRepository(VideoQualityResultEntity)
    private readonly qualityResults: Repository<VideoQualityResultEntity>,
    @InjectRepository(AuditLogEntity)
    private readonly auditLogs: Repository<AuditLogEntity>,
    private readonly workerHeartbeats: WorkerHeartbeatService,
    private readonly audit: AuditService,
  ) {}

  async annotationRuns(actor: PublicUser, input: AnnotationOperationsQueryDto) {
    assertAdmin(actor);
    const view = input.view ?? "pending_review";
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;
    const includeSummary = input.includeSummary ?? true;
    const query = this.annotationRunsRepository
      .createQueryBuilder("run")
      .leftJoinAndSelect("run.submission", "submission");
    this.applyAnnotationView(query, view);
    query
      .orderBy("run.updatedAt", "DESC")
      .addOrderBy("run.id", "DESC")
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [runs, total] = await query.getManyAndCount();
    const calculatedAt = Date.now();
    const response: Record<string, unknown> = {
      calculatedAt,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      },
      runs: runs.map((run) => ({
        id: run.id,
        submissionId: run.submissionId,
        fileName: run.submission?.originalFileName ?? run.submissionId,
        executionStatus: run.executionStatus,
        reviewStatus: run.reviewStatus,
        publicationStatus: run.publicationStatus,
        trigger: run.trigger,
        pipelineVersion: run.pipelineVersion,
        schemaVersion: run.schemaVersion,
        evidencePolicyVersion: run.evidencePolicyVersion,
        model: run.model,
        promptVersion: run.promptVersion,
        attemptCount: run.attemptCount,
        fullModelAttempts: run.fullModelAttempts,
        schemaRepairCalls: run.schemaRepairCalls,
        targetedRepairCalls: run.targetedRepairCalls,
        infrastructureRetryCount: run.infrastructureRetryCount,
        providerCallCount: run.providerCallCount,
        reviewRevision: run.reviewRevision,
        autoEligibility: run.autoEligibility,
        autoGateVersion: run.autoGateVersion,
        wouldAutoAccept: run.wouldAutoAccept,
        autoAcceptEnabledSnapshot: run.autoAcceptEnabledSnapshot,
        autoGateEvaluatedAt: run.autoGateEvaluatedAt?.getTime() ?? null,
        auditStatus: run.auditStatus,
        auditSelectedAt: run.auditSelectedAt?.getTime() ?? null,
        blockingReasons: run.autoGateIssues.filter(
          (issue) =>
            issue.level === "manual_review" ||
            (issue.level === "retryable" && issue.resolution === "unresolved"),
        ),
        advisories: run.autoGateIssues.filter((issue) => issue.level === "advisory"),
        repairs: run.autoGateIssues.filter(
          (issue) =>
            issue.level === "repairable" || issue.resolution === "retried",
        ),
        lastErrorCode: run.lastErrorCode,
        lastErrorMessage: redactAnnotationError(run.lastErrorMessage),
        queuedAt: run.queuedAt.getTime(),
        startedAt: run.startedAt?.getTime() ?? null,
        completedAt: run.completedAt?.getTime() ?? null,
        createdAt: run.createdAt.getTime(),
        updatedAt: run.updatedAt.getTime(),
      })),
    };
    if (includeSummary) {
      const [summary, coverage] = await Promise.all([
        this.annotationSummary(),
        this.annotationCoverage(),
      ]);
      response.summary = summary;
      response.coverage = coverage;
    }
    return response;
  }

  private applyAnnotationView(
    query: SelectQueryBuilder<AnnotationRunEntity>,
    view: AnnotationOperationsView,
  ): void {
    if (view === "pending_review") {
      query
        .andWhere("run.executionStatus = :succeeded", { succeeded: "succeeded" })
        .andWhere("run.reviewStatus = :pending", { pending: "pending" })
        .andWhere("run.publicationStatus = :candidate", { candidate: "candidate_only" });
      query.andWhere("run.autoEligibility = :manualRequired", {
        manualRequired: "manual_required",
      });
      return;
    }
    if (view === "audit_pending") {
      query
        .andWhere("run.publicationStatus = :published", {
          published: "auto_accepted",
        })
        .andWhere("run.auditStatus = :pending", { pending: "pending" });
      return;
    }
    if (view === "auto_published") {
      query.andWhere("run.publicationStatus = :published", {
        published: "auto_accepted",
      });
      return;
    }
    if (view === "execution_failed") {
      query.andWhere("run.executionStatus IN (:...failed)", {
        failed: ["system_failed", "stuck"],
      });
      return;
    }
    if (view === "in_progress") {
      query.andWhere("run.executionStatus IN (:...running)", {
        running: ["queued", "running", "retry_scheduled"],
      });
      return;
    }
    if (view === "resolved") {
      query.andWhere("run.reviewStatus IN (:...resolved)", {
        resolved: [
          "accepted_unchanged",
          "accepted_corrected",
          "rejected",
          "unable_to_judge",
        ],
      });
    }
  }

  private async annotationSummary() {
    const row = await this.annotationRunsRepository
      .createQueryBuilder("run")
      .select("COUNT(*)", "historicalTotal")
      .addSelect("COUNT(*) FILTER (WHERE run.executionStatus = 'queued')", "queued")
      .addSelect("COUNT(*) FILTER (WHERE run.executionStatus = 'running')", "running")
      .addSelect("COUNT(*) FILTER (WHERE run.executionStatus = 'retry_scheduled')", "retryScheduled")
      .addSelect("COUNT(*) FILTER (WHERE run.executionStatus = 'succeeded')", "succeeded")
      .addSelect("COUNT(*) FILTER (WHERE run.executionStatus = 'system_failed')", "systemFailed")
      .addSelect("COUNT(*) FILTER (WHERE run.executionStatus = 'stuck')", "stuck")
      .addSelect("COUNT(*) FILTER (WHERE run.executionStatus = 'cancelled')", "cancelled")
      .addSelect(`COUNT(*) FILTER (
        WHERE run.executionStatus = 'succeeded'
          AND run.reviewStatus = 'pending'
          AND run.publicationStatus = 'candidate_only'
          AND run.autoEligibility = 'manual_required'
      )`, "pending")
      .addSelect("COUNT(*) FILTER (WHERE run.reviewStatus = 'accepted_unchanged')", "acceptedUnchanged")
      .addSelect("COUNT(*) FILTER (WHERE run.reviewStatus = 'accepted_corrected')", "acceptedCorrected")
      .addSelect("COUNT(*) FILTER (WHERE run.reviewStatus = 'rejected')", "rejected")
      .addSelect("COUNT(*) FILTER (WHERE run.reviewStatus = 'unable_to_judge')", "unableToJudge")
      .addSelect("COUNT(*) FILTER (WHERE run.autoGateEvaluatedAt IS NOT NULL)", "gateEvaluated")
      .addSelect("COUNT(*) FILTER (WHERE run.autoEligibility = 'eligible')", "eligible")
      .addSelect("COUNT(*) FILTER (WHERE run.autoEligibility = 'manual_required')", "manualRequired")
      .addSelect(`COUNT(*) FILTER (
        WHERE run.executionStatus = 'succeeded'
          AND run.autoEligibility = 'eligible'
          AND run.autoAcceptEnabledSnapshot = true
      )`, "autoAccepted")
      .addSelect("COUNT(*) FILTER (WHERE run.auditStatus = 'pending')", "auditPending")
      .addSelect("COUNT(*) FILTER (WHERE run.auditStatus = 'completed')", "auditCompleted")
      .addSelect("COUNT(*) FILTER (WHERE run.publicationStatus = 'auto_accepted')", "publishedByAuto")
      .addSelect("COUNT(*) FILTER (WHERE run.publicationStatus = 'human_verified')", "publishedByHuman")
      .addSelect("COALESCE(SUM(run.providerCallCount), 0)", "providerCalls")
      .addSelect("COALESCE(SUM(run.schemaRepairCalls), 0)", "schemaRepairCalls")
      .addSelect("COALESCE(SUM(run.targetedRepairCalls), 0)", "targetedRepairCalls")
      .addSelect("COALESCE(SUM(run.infrastructureRetryCount), 0)", "infrastructureRetries")
      .getRawOne<Record<string, string | null>>();
    const callRows = (await this.annotationRunsRepository.manager.query(`
      SELECT
        COUNT(*) AS "providerCalls",
        COUNT(*) FILTER (WHERE call_status = 'succeeded') AS "succeededCalls",
        COUNT(*) FILTER (WHERE call_status = 'failed') AS "failedCalls",
        COUNT(*) FILTER (
          WHERE input_tokens IS NOT NULL OR output_tokens IS NOT NULL OR total_tokens IS NOT NULL
        ) AS "callsWithReportedUsage",
        COALESCE(SUM(input_tokens), 0) AS "totalReportedInputTokens",
        COALESCE(SUM(output_tokens), 0) AS "totalReportedOutputTokens",
        COALESCE(SUM(total_tokens), 0) AS "totalReportedTokens",
        AVG(latency_ms) AS "averageReportedModelLatencyMs"
      FROM annotation_model_calls
    `)) as Array<Record<string, string | null>>;
    const calls = callRows[0] ?? {};
    const number = (key: string) => Number(row?.[key] ?? 0);
    return {
      runs: {
        historicalTotal: number("historicalTotal"),
        queued: number("queued"),
        running: number("running"),
        retryScheduled: number("retryScheduled"),
        succeeded: number("succeeded"),
        systemFailed: number("systemFailed"),
        stuck: number("stuck"),
        cancelled: number("cancelled"),
      },
      reviews: {
        pending: number("pending"),
        acceptedUnchanged: number("acceptedUnchanged"),
        acceptedCorrected: number("acceptedCorrected"),
        rejected: number("rejected"),
        unableToJudge: number("unableToJudge"),
      },
      gate: {
        gateEvaluated: number("gateEvaluated"),
        eligible: number("eligible"),
        manualRequired: number("manualRequired"),
        autoAccepted: number("autoAccepted"),
        auditPending: number("auditPending"),
        auditCompleted: number("auditCompleted"),
        publishedByAuto: number("publishedByAuto"),
        publishedByHuman: number("publishedByHuman"),
      },
      usage: {
        scope: "all_reported_model_calls" as const,
        providerCalls: Number(calls.providerCalls ?? 0),
        succeededCalls: Number(calls.succeededCalls ?? 0),
        failedCalls: Number(calls.failedCalls ?? 0),
        callsWithReportedUsage: Number(calls.callsWithReportedUsage ?? 0),
        totalReportedInputTokens: Number(calls.totalReportedInputTokens ?? 0),
        totalReportedOutputTokens: Number(calls.totalReportedOutputTokens ?? 0),
        totalReportedTokens: Number(calls.totalReportedTokens ?? 0),
        averageReportedModelLatencyMs:
          calls.averageReportedModelLatencyMs === null ||
          calls.averageReportedModelLatencyMs === undefined
            ? null
            : Math.round(Number(calls.averageReportedModelLatencyMs)),
        schemaRepairCalls: number("schemaRepairCalls"),
        targetedRepairCalls: number("targetedRepairCalls"),
        infrastructureRetries: number("infrastructureRetries"),
      },
    };
  }

  private async annotationCoverage() {
    const rows = (await this.annotationRunsRepository.manager.query(`
      SELECT
        COUNT(DISTINCT submission.id) AS "eligibleSubmissions",
        COUNT(DISTINCT submission.id) FILTER (WHERE run.id IS NOT NULL) AS "submissionsWithAnyRun",
        COUNT(DISTINCT submission.id) FILTER (WHERE run.execution_status = 'succeeded') AS "submissionsWithSucceededRun",
        COUNT(DISTINCT submission.id) FILTER (WHERE run.publication_status = 'human_verified') AS "submissionsHumanVerified"
      FROM submissions AS submission
      INNER JOIN media_metadata AS media ON media.submission_id = submission.id
      LEFT JOIN annotation_runs AS run ON run.submission_id = submission.id
      WHERE submission.upload_status = 'uploaded'
        AND submission.storage_status = 'available'
        AND submission.asset_status = 'active'
        AND submission.is_test_data = false
    `)) as Array<Record<string, string>>;
    const row = rows[0] ?? {};
    const eligibleSubmissions = Number(row.eligibleSubmissions ?? 0);
    const submissionsWithAnyRun = Number(row.submissionsWithAnyRun ?? 0);
    const submissionsWithSucceededRun = Number(row.submissionsWithSucceededRun ?? 0);
    const submissionsHumanVerified = Number(row.submissionsHumanVerified ?? 0);
    const rate = (value: number) => eligibleSubmissions === 0 ? null : value / eligibleSubmissions;
    return {
      eligibleSubmissions,
      submissionsWithAnyRun,
      submissionsWithSucceededRun,
      submissionsHumanVerified,
      anyRunRate: rate(submissionsWithAnyRun),
      succeededRate: rate(submissionsWithSucceededRun),
      verifiedRate: rate(submissionsHumanVerified),
    };
  }

  async queue(actor: PublicUser) {
    assertAdmin(actor);
    const [jobs, rawSummary, workerList] = await Promise.all([
      this.jobs.find({
        order: { createdAt: "DESC" },
        take: 100,
      }),
      this.jobs
        .createQueryBuilder("job")
        .select("COUNT(*)", "total")
        .addSelect(
          "COUNT(*) FILTER (WHERE job.status = :pendingStatus)",
          "pending",
        )
        .addSelect(
          "COUNT(*) FILTER (WHERE job.status = :publishedStatus)",
          "published",
        )
        .addSelect(
          "COUNT(*) FILTER (WHERE job.lastError IS NOT NULL)",
          "failed",
        )
        .addSelect(
          "COUNT(*) FILTER (WHERE job.eventType = :mediaEventType)",
          "media",
        )
        .addSelect(
          "COUNT(*) FILTER (WHERE job.eventType = :aiEventType)",
          "ai",
        )
        .addSelect(
          "COUNT(*) FILTER (WHERE job.eventType = :annotationEventType)",
          "annotation",
        )
        .addSelect(
          `COALESCE(
            AVG(
              GREATEST(
                EXTRACT(EPOCH FROM (job.publishedAt - job.createdAt)) * 1000,
                0
              )
            ) FILTER (WHERE job.publishedAt IS NOT NULL),
            0
          )`,
          "averagePublishLatencyMs",
        )
        .setParameters({
          pendingStatus: "pending",
          publishedStatus: "published",
          mediaEventType: "media.probe.v1",
          aiEventType: "ai.quality.v1",
          annotationEventType: "ai.annotation.v1",
        })
        .getRawOne<{
          total: string;
          pending: string;
          published: string;
          failed: string;
          media: string;
          ai: string;
          annotation: string;
          averagePublishLatencyMs: string;
        }>(),
      this.workerHeartbeats.list(),
    ]);
    return {
      summary: {
        total: Number(rawSummary?.total ?? 0),
        pending: Number(rawSummary?.pending ?? 0),
        published: Number(rawSummary?.published ?? 0),
        failed: Number(rawSummary?.failed ?? 0),
        media: Number(rawSummary?.media ?? 0),
        ai: Number(rawSummary?.ai ?? 0),
        annotation: Number(rawSummary?.annotation ?? 0),
        averagePublishLatencyMs: Math.round(
          Number(rawSummary?.averagePublishLatencyMs ?? 0),
        ),
      },
      jobs: jobs.map(publicJob),
      workers: workerList.active,
      inactive: workerList.inactive,
      inactiveCount: workerList.inactiveCount,
    };
  }

  async status(actor: PublicUser) {
    assertActive(actor);
    const [
      processingSubmissions,
      failedSubmissions,
      reviewPending,
      unsettledEligible,
      pendingJobs,
      failedJobs,
      recentAudits,
    ] = await Promise.all([
      this.countSubmissions(actor, (query) =>
        query.andWhere("submission.processingStatus IN (:...processing)", {
          processing: ["queued", "probing", "awaiting_ai", "ai_processing"],
        }),
      ),
      this.countSubmissions(actor, (query) =>
        query
          .leftJoin(
            VideoQualityResultEntity,
            "quality",
            "quality.submissionId = submission.id",
          )
          .andWhere(
            new Brackets((builder) => {
              builder
                .where("submission.processingStatus = :systemFailed", {
                  systemFailed: "system_failed",
                })
                .orWhere("quality.status = :hardReject", {
                  hardReject: "hard_reject",
                })
                .orWhere(QUALITY_FAILED_SQL);
            }),
          ),
      ),
      this.countSubmissions(actor, (query) =>
        query
          .innerJoin(
            VideoQualityResultEntity,
            "quality",
            "quality.submissionId = submission.id",
          )
          .andWhere("quality.status = :reviewPending", {
            reviewPending: "review_pending",
          })
          .andWhere("quality.manualFinalScore IS NULL"),
      ),
      this.countSubmissions(actor, (query) =>
        query
          .innerJoin(
            VideoQualityResultEntity,
            "quality",
            "quality.submissionId = submission.id",
          )
          .leftJoin(
            PointCycleItemEntity,
            "pointItem",
            "pointItem.submissionId = submission.id",
          )
          .andWhere("submission.processingStatus = :completed", {
            completed: "completed",
          })
          .andWhere("submission.assetStatus = :activeAsset", {
            activeAsset: "active",
          })
          .andWhere("submission.storageStatus = :availableStorage", {
            availableStorage: "available",
          })
          .andWhere("pointItem.id IS NULL")
          .andWhere("quality.status IN (:...statuses)", {
            statuses: ["scored", "review_pending"],
          })
          .andWhere(QUALITY_PASSED_SQL)
          .andWhere(POINT_RULE_ELIGIBLE_SQL)
          .andWhere(
            "COALESCE(quality.manualSettlementRatio, quality.settlementRatio) IS NOT NULL",
          ),
      ),
      actor.role === "admin" ? this.jobs.countBy({ status: "pending" }) : 0,
      actor.role === "admin"
        ? this.jobs
            .createQueryBuilder("job")
            .where("job.lastError IS NOT NULL")
            .getCount()
        : 0,
      actor.role === "admin"
        ? this.auditLogs
            .createQueryBuilder("audit")
            .where("audit.createdAt >= :since", {
              since: new Date(Date.now() - 24 * 60 * 60 * 1_000),
            })
            .getCount()
        : 0,
    ]);

    const workers =
      actor.role === "admin" ? await this.workerHeartbeats.listAll() : [];
    const workerAlerts = workers.filter(
      (worker) => worker.stale || worker.runningTooLong,
    ).length;
    const navigationBadges: NavigationBadge[] = [];
    const notifications: OperationsNotification[] = [];
    const now = Date.now();
    const addBadge = (path: string, count: number) => {
      if (count <= 0) return;
      navigationBadges.push({ path, count, label: badgeLabel(count) });
    };
    const addNotification = (
      id: string,
      title: string,
      detail: string,
      tone: OperationsNotification["tone"],
      path: string,
      count: number,
    ) => {
      if (count <= 0) return;
      notifications.push({ id, title, detail, tone, path, count, createdAt: now });
    };

    if (actor.role === "admin") {
      const aiEvents = pendingJobs + failedJobs + workerAlerts;
      addBadge("/admin/submissions", processingSubmissions + failedSubmissions);
      addBadge("/admin/ai", aiEvents);
      addBadge("/admin/review", reviewPending);
      addBadge("/admin/settlements", unsettledEligible);
      addNotification(
        `admin-ai-${aiEvents}`,
        "AI 队列需要关注",
        `${pendingJobs} 条事件等待发布，${failedJobs} 条发布异常，${workerAlerts} 个 Worker 告警。`,
        failedJobs + workerAlerts > 0 ? "danger" : "warning",
        "/admin/ai",
        aiEvents,
      );
      addNotification(
        `admin-review-${reviewPending}`,
        "有视频等待人工复核",
        `${reviewPending} 条终态质检结果需要平台确认。`,
        "warning",
        "/admin/review",
        reviewPending,
      );
      addNotification(
        `admin-points-${unsettledEligible}`,
        "有合格数据待锁定金额",
        `${unsettledEligible} 条通过质检的视频还没有进入结算周期。`,
        "info",
        "/admin/settlements",
        unsettledEligible,
      );
      addNotification(
        `admin-submissions-${failedSubmissions}`,
        "有提交处理失败",
        `${failedSubmissions} 条视频处于系统失败或质检不通过状态。`,
        "danger",
        "/admin/submissions",
        failedSubmissions,
      );
    } else if (actor.role === "leader") {
      addBadge("/team/submissions", processingSubmissions + failedSubmissions);
      addBadge("/team/review", reviewPending);
      addBadge("/team/income", unsettledEligible);
      addNotification(
        `leader-review-${reviewPending}`,
        "团队有视频等待复核",
        `${reviewPending} 条本团队质检结果需要确认。`,
        "warning",
        "/team/review",
        reviewPending,
      );
      addNotification(
        `leader-submissions-${failedSubmissions}`,
        "团队有提交异常",
        `${failedSubmissions} 条本团队视频处理失败或质检未通过。`,
        "danger",
        "/team/submissions",
        failedSubmissions,
      );
      addNotification(
        `leader-points-${unsettledEligible}`,
        "团队有待锁定金额数据",
        `${unsettledEligible} 条通过质检的视频尚未进入结算周期。`,
        "info",
        "/team/income",
        unsettledEligible,
      );
    } else {
      addBadge("/collector/submissions", processingSubmissions + failedSubmissions);
      addBadge("/collector/quality", failedSubmissions + reviewPending);
      addBadge("/collector/earnings", unsettledEligible);
      addNotification(
        `collector-processing-${processingSubmissions}`,
        "视频正在处理",
        `${processingSubmissions} 条视频仍在上传、媒体解析或 AI 质检中。`,
        "info",
        "/collector/submissions",
        processingSubmissions,
      );
      addNotification(
        `collector-quality-${failedSubmissions}`,
        "有视频未通过",
        `${failedSubmissions} 条视频处理失败或质检未通过，请查看原因。`,
        "danger",
        "/collector/quality",
        failedSubmissions,
      );
      addNotification(
        `collector-points-${unsettledEligible}`,
        "有金额等待锁定",
        `${unsettledEligible} 条通过质检的视频尚未进入结算周期。`,
        "info",
        "/collector/earnings",
        unsettledEligible,
      );
    }

    return {
      generatedAt: now,
      unreadCount: notifications.length,
      summary: {
        processingSubmissions,
        failedSubmissions,
        reviewPending,
        unsettledEligible,
        pendingJobs,
        failedJobs,
        workerAlerts,
        recentAudits,
      },
      navigationBadges,
      notifications,
    };
  }

  async reclaimTimedOutTasks(actor: PublicUser) {
    assertAdmin(actor);
    const workers = await this.workerHeartbeats.listAll();
    // 正在被活跃 Worker 正常处理的任务（心跳正常且未超时）不作为回收候选，
    // 避免僵尸心跳/旧 Worker 记录导致正在处理的任务被误标为卡住。
    const activeProcessorIds = new Set(
      workers
        .filter(
          (worker) =>
            worker.kind !== "ai_annotation" &&
            worker.currentSubmissionId &&
            worker.status === "running" &&
            !worker.stale &&
            !worker.runningTooLong,
        )
        .map((worker) => worker.currentSubmissionId as string),
    );
    const stuckCandidateIds = new Set(
      workers
        .filter(
          (worker) =>
            worker.kind !== "ai_annotation" &&
            worker.currentSubmissionId &&
            (worker.runningTooLong ||
              (worker.stale && worker.status !== "stopped")),
        )
        .map((worker) => worker.currentSubmissionId as string)
        .filter((submissionId) => !activeProcessorIds.has(submissionId)),
    );
    const activeAnnotationRunIds = new Set(
      workers
        .filter(
          (worker) =>
            worker.kind === "ai_annotation" &&
            worker.currentSubmissionId &&
            worker.status === "running" &&
            !worker.stale &&
            !worker.runningTooLong,
        )
        .map((worker) => worker.currentSubmissionId as string),
    );
    const stuckAnnotationRunIds = new Set(
      workers
        .filter(
          (worker) =>
            worker.kind === "ai_annotation" &&
            worker.currentSubmissionId &&
            (worker.runningTooLong ||
              (worker.stale && worker.status !== "stopped")),
        )
        .map((worker) => worker.currentSubmissionId as string)
        .filter((runId) => !activeAnnotationRunIds.has(runId)),
    );
    if (stuckCandidateIds.size === 0 && stuckAnnotationRunIds.size === 0) {
      return { reclaimed: [], stuck: [], annotationReclaimed: [], annotationStuck: [] };
    }

    return await this.submissions.manager.transaction(async (manager) => {
      const submissions = await manager
        .getRepository(SubmissionEntity)
        .createQueryBuilder("submission")
        .setLock("pessimistic_write")
        .where("submission.id IN (:...ids)", { ids: [...stuckCandidateIds] })
        .andWhere("submission.processingStatus IN (:...statuses)", {
          statuses: ["probing", "ai_processing", "stuck"],
        })
        .getMany();
      const reclaimed: Array<{
        submissionId: string;
        previousStatus: string;
        nextStatus: string;
        eventType: string;
      }> = [];
      const stuck: Array<{
        submissionId: string;
        previousStatus: string;
        reason: string;
      }> = [];
      const annotationReclaimed: Array<{
        runId: string;
        submissionId: string;
        previousStatus: string;
        nextStatus: string;
        eventType: string;
      }> = [];
      const annotationStuck: Array<{
        runId: string;
        submissionId: string;
        previousStatus: string;
        reason: string;
      }> = [];
      for (const submission of submissions) {
        const previousStatus = submission.processingStatus;
        const isMedia = previousStatus === "probing";
        const eventType = isMedia ? "media.probe.v1" : "ai.quality.v1";
        const stuckReason = "后台任务运行超时或 Worker 心跳过期，已标记为卡住";

        const alreadyStuck = previousStatus === "stuck";
        if (!alreadyStuck) {
          await manager.getRepository(VideoQualityResultEntity).update(
            { submissionId: submission.id },
            {
              status: "stuck",
              progressStage: "stuck",
              progressUpdatedAt: new Date(),
              stuckReason,
              lastError: stuckReason,
            },
          );
          submission.processingStatus = "stuck";
          submission.failureCode = "WORKER_STUCK";
          submission.failureMessage = stuckReason;
          await manager.getRepository(SubmissionEntity).save(submission);
          await this.audit.record(
            manager,
            actor,
            "worker_task_stuck",
            { id: submission.id, name: submission.originalFileName },
            stuckReason,
            { processingStatus: previousStatus },
            { processingStatus: "stuck" },
          );
          stuck.push({
            submissionId: submission.id,
            previousStatus,
            reason: stuckReason,
          });
        }

        // AI 任务重试超过上限后停在 stuck，等管理员手动重新排队；
        // 媒体任务没有 attempts 计数，按现有重试语义自动重投。
        if (!isMedia && !alreadyStuck) {
          const quality = await manager
            .getRepository(VideoQualityResultEntity)
            .findOneBy({ submissionId: submission.id });
          if ((quality?.attempts ?? 0) >= MAX_AUTO_RETRY_ATTEMPTS) continue;
        }

        const nextStatus = isMedia ? "queued" : "awaiting_ai";
        submission.processingStatus = nextStatus;
        submission.failureCode = "WORKER_STUCK_REQUEUED";
        submission.failureMessage = "卡住任务已自动重新排队";
        await manager.getRepository(SubmissionEntity).save(submission);
        await this.upsertOutbox(manager, submission.id, eventType);
        await this.audit.record(
          manager,
          actor,
          "worker_task_reclaim",
          { id: submission.id, name: submission.originalFileName },
          "卡住任务自动重新排队处理",
          { processingStatus: "stuck" },
          { processingStatus: nextStatus, eventType },
        );
        reclaimed.push({
          submissionId: submission.id,
          previousStatus,
          nextStatus,
          eventType,
        });
      }
      if (stuckAnnotationRunIds.size > 0) {
        const runs = await manager
          .getRepository(AnnotationRunEntity)
          .createQueryBuilder("run")
          .setLock("pessimistic_write")
          .where("run.id IN (:...ids)", { ids: [...stuckAnnotationRunIds] })
          .andWhere("run.executionStatus IN (:...statuses)", {
            statuses: ["running", "stuck"],
          })
          .getMany();
        for (const run of runs) {
          const previousStatus = run.executionStatus;
          const reason = "候选标注 Worker 运行超时或心跳过期，已标记为卡住";
          if (run.executionStatus !== "stuck") {
            run.executionStatus = "stuck";
            run.lastErrorCode = "WORKER_STUCK";
            run.lastErrorMessage = reason;
            run.nextRetryAt = null;
            await manager.getRepository(AnnotationRunEntity).save(run);
            annotationStuck.push({
              runId: run.id,
              submissionId: run.submissionId,
              previousStatus,
              reason,
            });
          }
          if (run.attemptCount >= MAX_AUTO_RETRY_ATTEMPTS) continue;
          const otherActive = await manager.getRepository(AnnotationRunEntity).exists({
            where: {
              id: Not(run.id),
              submissionId: run.submissionId,
              executionStatus: In(["queued", "running", "retry_scheduled"]),
            },
          });
          if (otherActive) continue;
          run.executionStatus = "queued";
          run.queuedAt = new Date();
          run.startedAt = null;
          run.lastErrorCode = "WORKER_STUCK_REQUEUED";
          run.lastErrorMessage = "卡住的候选标注运行已自动重新排队";
          await manager.getRepository(AnnotationRunEntity).save(run);
          await enqueueAnnotationRun(manager, run);
          const submission = await manager.getRepository(SubmissionEntity).findOneBy({
            id: run.submissionId,
          });
          await this.audit.record(
            manager,
            actor,
            "annotation.run.reclaim",
            {
              id: submission?.id ?? run.submissionId,
              name: submission?.originalFileName ?? run.submissionId,
            },
            "卡住的候选标注运行自动重新排队",
            { runId: run.id, executionStatus: "stuck", attemptCount: run.attemptCount },
            { runId: run.id, executionStatus: "queued", eventType: "ai.annotation.v1" },
          );
          annotationReclaimed.push({
            runId: run.id,
            submissionId: run.submissionId,
            previousStatus,
            nextStatus: "queued",
            eventType: "ai.annotation.v1",
          });
        }
      }
      return { reclaimed, stuck, annotationReclaimed, annotationStuck };
    });
  }

  async pruneInactiveWorkers(actor: PublicUser) {
    assertAdmin(actor);
    const removed = await this.workerHeartbeats.pruneInactive();
    if (removed > 0) {
      await this.audit.record(
        this.submissions.manager,
        actor,
        "worker_heartbeat_prune",
        { id: "worker-heartbeats", name: "Worker 心跳" },
        `清理 ${removed} 条已停止或心跳过期的历史记录`,
        { removed },
        null,
      );
    }
    return { removed };
  }

  private countSubmissions(
    actor: PublicUser,
    configure: (query: SelectQueryBuilder<SubmissionEntity>) => void,
  ): Promise<number> {
    const query = this.submissions.createQueryBuilder("submission");
    this.applySubmissionScope(query, actor);
    configure(query);
    return query.getCount();
  }

  private applySubmissionScope(
    query: SelectQueryBuilder<SubmissionEntity>,
    actor: PublicUser,
  ): void {
    if (actor.role === "admin") return;
    if (actor.role === "leader" && actor.teamId) {
      query.andWhere("submission.teamId = :teamId", { teamId: actor.teamId });
      return;
    }
    query.andWhere("submission.ownerId = :ownerId", { ownerId: actor.id });
  }

  private async upsertOutbox(
    manager: EntityManager,
    submissionId: string,
    eventType: string,
  ): Promise<void> {
    const jobs = manager.getRepository(JobOutboxEntity);
    const existing = await jobs.findOne({
      where: { aggregateId: submissionId, eventType },
      lock: { mode: "pessimistic_write" },
    });
    if (existing) {
      existing.payload = { submissionId };
      existing.status = "pending";
      existing.attempts = 0;
      existing.availableAt = new Date();
      existing.publishedAt = null;
      existing.lastError = null;
      await jobs.save(existing);
      return;
    }
    await jobs.save({
      id: `JOB-${randomUUID()}`,
      aggregateType: "submission",
      aggregateId: submissionId,
      eventType,
      payload: { submissionId },
      status: "pending",
      attempts: 0,
      availableAt: new Date(),
    });
  }
}
