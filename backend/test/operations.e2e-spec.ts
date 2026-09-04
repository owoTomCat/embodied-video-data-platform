import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import request from "supertest";
import type { DataSource } from "typeorm";

import { AuthModule } from "../src/auth/auth.module.js";
import {
  createDataSource,
  identityEntities,
} from "../src/database/data-source.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { AnnotationModelCallEntity } from "../src/database/entities/annotation-model-call.entity.js";
import { JobOutboxEntity } from "../src/database/entities/job-outbox.entity.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { PointCycleItemEntity } from "../src/database/entities/point-cycle-item.entity.js";
import { PointRuleVersionEntity } from "../src/database/entities/point-rule-version.entity.js";
import { PointCycleEntity } from "../src/database/entities/point-cycle.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { VideoQualityPromptVersionEntity } from "../src/database/entities/video-quality-prompt-version.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";
import { WorkerHeartbeatEntity } from "../src/database/entities/worker-heartbeat.entity.js";
import { configureApplication } from "../src/http/configure-application.js";
import { OperationsModule } from "../src/operations/operations.module.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Operations-password-2026";

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("operations API", () => {
  let app: INestApplication;
  let dataSource: DataSource;

  async function login(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ username, password: TEST_PASSWORD })
      .expect(200);
    return cookieFrom(response);
  }

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    const passwordHash = await argon2.hash(TEST_PASSWORD, {
      type: argon2.argon2id,
    });
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-OPS-01",
      name: "队列测试团队",
    });
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-OPS-ADMIN",
        displayName: "队列管理员",
        username: "ops-admin",
        usernameNormalized: "ops-admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-OPS-COLLECTOR",
        displayName: "队列数采",
        username: "ops-collector",
        usernameNormalized: "ops-collector",
        passwordHash,
        role: "collector",
        teamId: "TEAM-OPS-01",
        status: "active",
      },
    ]);
    await dataSource.getRepository(PointRuleVersionEntity).save({
      id: "PRV-OPS-ZERO",
      revision: 1,
      version: "POINTS-OPS-ZERO",
      defaultPointsPerMinute: "12.0000",
      coefficientBands: [
        { minScore: 0, maxScore: 100, ratio: 0, label: "暂不计分" },
      ],
      description: "验证零系数通过项不会形成待锁定提醒",
      active: true,
      createdByAccountId: "U-OPS-ADMIN",
      createdByName: "队列管理员",
    });
    await dataSource.getRepository(SubmissionEntity).save([
      {
        id: "SUB-OPS-PROCESSING",
        ownerId: "U-OPS-COLLECTOR",
        teamId: "TEAM-OPS-01",
        originalFileName: "processing.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "a".repeat(64),
        objectKey: "uploads/ops/processing.mp4",
        uploadStatus: "uploaded",
        processingStatus: "ai_processing",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-OPS-REVIEW",
        ownerId: "U-OPS-COLLECTOR",
        teamId: "TEAM-OPS-01",
        originalFileName: "review.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "b".repeat(64),
        objectKey: "uploads/ops/review.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-OPS-FAILED",
        ownerId: "U-OPS-COLLECTOR",
        teamId: "TEAM-OPS-01",
        originalFileName: "failed.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "c".repeat(64),
        objectKey: "uploads/ops/failed.mp4",
        uploadStatus: "uploaded",
        processingStatus: "system_failed",
        failureCode: "AI_FAILED",
        failureMessage: "模型异常",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-OPS-STRICT-RULE",
        ownerId: "U-OPS-COLLECTOR",
        teamId: "TEAM-OPS-01",
        originalFileName: "strict-rule-failed.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "6".repeat(64),
        objectKey: "uploads/ops/strict-rule-failed.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-OPS-ZERO-COEFFICIENT",
        ownerId: "U-OPS-COLLECTOR",
        teamId: "TEAM-OPS-01",
        originalFileName: "zero-coefficient.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "7".repeat(64),
        objectKey: "uploads/ops/zero-coefficient.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-OPS-REVIEWED-PENDING",
        ownerId: "U-OPS-COLLECTOR",
        teamId: "TEAM-OPS-01",
        originalFileName: "reviewed-pending.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "8".repeat(64),
        objectKey: "uploads/ops/reviewed-pending.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
    ]);
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: "SUB-OPS-REVIEW",
      durationSeconds: "60.000",
      width: 1920,
      height: 1080,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000",
      sizeBytes: "1000",
      rawProbe: {},
    });
    const annotationBase = {
      pipelineVersion: "annotation-pipeline-v1",
      schemaVersion: "annotation-schema-v1",
      evidencePolicyVersion: "annotation-evidence-v1",
      promptVersion: "annotation-prompt-v1",
      promptContentSha256: "9".repeat(64),
      systemPromptSnapshot: "locked annotation prompt",
      outputExampleSnapshot: { video_id: "example" },
      model: "qwen-vl-max",
      attemptCount: 1,
      reviewRevision: 0,
      queuedAt: new Date("2026-08-28T08:00:00Z"),
    } as const;
    await dataSource.getRepository(AnnotationRunEntity).save([
      {
        ...annotationBase,
        id: "ANR-OPS-PENDING",
        submissionId: "SUB-OPS-REVIEW",
        trigger: "initial",
        executionStatus: "succeeded",
        reviewStatus: "pending",
        publicationStatus: "candidate_only",
        autoEligibility: "manual_required",
        autoGateVersion: "annotation_auto_gate_v1",
        autoGateEvaluatedAt: new Date("2026-08-28T08:01:00Z"),
        autoGateIssues: [{
          code: "NO_TASK_DETECTED",
          level: "manual_review",
          fieldPath: null,
          taskIndex: null,
          message: "视频未识别到任何可见任务",
          evidenceTimestampsMs: [],
          resolution: "not_applicable",
        }],
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        latencyMs: 2_000,
        completedAt: new Date("2026-08-28T08:01:00Z"),
      },
      {
        ...annotationBase,
        id: "ANR-OPS-VERIFIED",
        submissionId: "SUB-OPS-REVIEW",
        trigger: "manual",
        executionStatus: "succeeded",
        reviewStatus: "accepted_corrected",
        publicationStatus: "human_verified",
        reviewRevision: 1,
        completedAt: new Date("2026-08-27T08:01:00Z"),
      },
      {
        ...annotationBase,
        id: "ANR-OPS-FAILED",
        submissionId: "SUB-OPS-FAILED",
        trigger: "initial",
        executionStatus: "system_failed",
        reviewStatus: "pending",
        publicationStatus: "candidate_only",
        lastErrorCode: "MODEL_HTTP_500",
        lastErrorMessage: `Bearer secret-token sk-secret data:image/jpeg;base64,${"A".repeat(80)}`,
        completedAt: new Date("2026-08-28T08:02:00Z"),
      },
      {
        ...annotationBase,
        id: "ANR-OPS-STUCK",
        submissionId: "SUB-OPS-STRICT-RULE",
        trigger: "initial",
        executionStatus: "stuck",
        reviewStatus: "pending",
        publicationStatus: "candidate_only",
      },
      {
        ...annotationBase,
        id: "ANR-OPS-AUDIT",
        submissionId: "SUB-OPS-FAILED",
        trigger: "manual",
        executionStatus: "succeeded",
        reviewStatus: "not_required",
        publicationStatus: "auto_accepted",
        autoEligibility: "eligible",
        autoGateVersion: "annotation_auto_gate_v1",
        autoGateIssues: [],
        wouldAutoAccept: true,
        autoAcceptEnabledSnapshot: true,
        autoGateEvaluatedAt: new Date("2026-08-28T08:04:00Z"),
        auditStatus: "pending",
        auditSelectedAt: new Date("2026-08-28T08:04:00Z"),
        completedAt: new Date("2026-08-28T08:04:00Z"),
      },
    ]);
    await dataSource.getRepository(AnnotationModelCallEntity).save({
      id: "AMC-OPS-PENDING",
      annotationRunId: "ANR-OPS-PENDING",
      logicalFullAttempt: 1,
      callKind: "full",
      callStatus: "succeeded",
      httpStatus: 200,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      latencyMs: 2_000,
    });
    await dataSource.query(
      `UPDATE annotation_runs SET updated_at = $1 WHERE id IN ($2, $3)`,
      [new Date("2026-08-28T08:03:00Z"), "ANR-OPS-FAILED", "ANR-OPS-STUCK"],
    );
    const prompt = await dataSource
      .getRepository(VideoQualityPromptVersionEntity)
      .save({
        id: "VQP-OPS-01",
        revision: 1,
        systemPrompt: "ops prompt",
        contentSha256: "f".repeat(64),
        promptVersion: "qwen_video_qc_prompt_v1",
        ruleVersion: "video_qc_v2",
        outputSchema: "video_qc_result_v1",
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        active: true,
        createdByAccountId: "U-OPS-ADMIN",
        createdByName: "队列管理员",
      });
    await dataSource.getRepository(VideoQualityResultEntity).save([
      {
        submissionId: "SUB-OPS-REVIEW",
        status: "review_pending",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "82.0",
        settlementRatio: "1.0000",
        invalidDurationMs: "0",
        billableDurationMs: "60000",
        summary: "等待复核",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: true,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-OPS-STRICT-RULE",
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        qualityRuleSnapshot: {
          id: "QRV-OPS-STRICT",
          revision: 2,
          version: "RULE-OPS-STRICT",
          passThreshold: 70,
          description: "七十分通过",
        },
        finalScore: "65.0",
        settlementRatio: "0.0000",
        passed: false,
        invalidDurationMs: "0",
        billableDurationMs: "60000",
        summary: "未达到当前规则阈值",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-OPS-ZERO-COEFFICIENT",
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "82.0",
        settlementRatio: "1.0000",
        passed: true,
        invalidDurationMs: "0",
        billableDurationMs: "60000",
        summary: "质量通过但当前积分规则系数为零",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-OPS-REVIEWED-PENDING",
        status: "review_pending",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "68.0",
        settlementRatio: "0.7000",
        manualFinalScore: "75.0",
        manualSettlementRatio: "0.8500",
        passed: true,
        invalidDurationMs: "0",
        billableDurationMs: "60000",
        manualInvalidDurationMs: "0",
        manualBillableDurationMs: "60000",
        manualReviewReason: "人工确认通过",
        manualReviewedByAccountId: "U-OPS-ADMIN",
        manualReviewedByName: "队列管理员",
        manualReviewedAt: new Date(),
        reviewRevision: 1,
        summary: "已经人工复核",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: true,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date(),
      },
    ]);
    await dataSource.getRepository(JobOutboxEntity).save([
      {
        id: "JOB-OPS-01",
        aggregateType: "submission",
        aggregateId: "SUB-OPS-01",
        eventType: "media.probe.v1",
        payload: { submissionId: "SUB-OPS-01" },
        status: "pending",
        attempts: 1,
        availableAt: new Date("2026-08-13T08:00:00Z"),
        createdAt: new Date("2026-08-13T07:59:30Z"),
      },
      {
        id: "JOB-OPS-02",
        aggregateType: "submission",
        aggregateId: "SUB-OPS-02",
        eventType: "ai.quality.v1",
        payload: { submissionId: "SUB-OPS-02" },
        status: "published",
        attempts: 2,
        availableAt: new Date("2026-08-13T08:00:00Z"),
        publishedAt: new Date("2026-08-13T08:01:00Z"),
        createdAt: new Date("2026-08-13T08:00:00Z"),
      },
    ]);
    await dataSource.getRepository(WorkerHeartbeatEntity).save({
      id: "ai_quality-test-host-42",
      kind: "ai_quality",
      hostName: "test-host",
      processId: 42,
      status: "running",
      currentSubmissionId: "SUB-OPS-02",
      lastError: null,
      currentTaskStartedAt: new Date(Date.now() - 15_000),
      completedTaskCount: 3,
      failedTaskCount: 1,
      totalTaskDurationMs: "90000",
      lastTaskDurationMs: 25_000,
      maxTaskDurationMs: 40_000,
      startedAt: new Date(),
      lastSeenAt: new Date(),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          url: TEST_DATABASE_URL,
          entities: identityEntities,
          synchronize: false,
        }),
        AuthModule,
        OperationsModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app, WEB_ORIGIN);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("returns queue observability data to administrators", async () => {
    const adminCookie = await login("ops-admin");
    const response = await request(app.getHttpServer())
      .get("/api/v1/operations/queue")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body.summary).toMatchObject({
      total: 2,
      pending: 1,
      published: 1,
      media: 1,
      ai: 1,
      averagePublishLatencyMs: 60000,
    });
    expect(response.body.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "JOB-OPS-01",
          aggregateId: "SUB-OPS-01",
          eventType: "media.probe.v1",
          status: "pending",
          attempts: 1,
          ageMs: expect.any(Number),
          waitMs: expect.any(Number),
          queuedForMs: expect.any(Number),
        }),
        expect.objectContaining({
          id: "JOB-OPS-02",
          publishLatencyMs: 60000,
        }),
      ]),
    );
    expect(response.body.workers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ai_quality-test-host-42",
          kind: "ai_quality",
          hostName: "test-host",
          processId: 42,
          status: "running",
          currentSubmissionId: "SUB-OPS-02",
          currentTaskStartedAt: expect.any(Number),
          currentTaskAgeMs: expect.any(Number),
          runningTooLong: false,
          taskTimeoutMs: expect.any(Number),
          completedTaskCount: 3,
          failedTaskCount: 1,
          averageTaskDurationMs: 30000,
          lastTaskDurationMs: 25000,
          maxTaskDurationMs: 40000,
          stale: false,
        }),
      ]),
    );
  });

  it("rejects non-admin queue visibility", async () => {
    const collectorCookie = await login("ops-collector");
    await request(app.getHttpServer())
      .get("/api/v1/operations/queue")
      .set("Cookie", collectorCookie)
      .expect(403);
  });

  it("returns independent annotation operations with explicit metric scopes", async () => {
    const adminCookie = await login("ops-admin");
    const response = await request(app.getHttpServer())
      .get("/api/v1/operations/annotation-runs?view=pending_review&page=1&pageSize=50&includeSummary=true")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body.runs).toEqual([
      expect.objectContaining({
        id: "ANR-OPS-PENDING",
        submissionId: "SUB-OPS-REVIEW",
        fileName: "review.mp4",
      }),
    ]);
    expect(response.body.summary).toMatchObject({
      runs: { historicalTotal: 5, succeeded: 3, systemFailed: 1, stuck: 1 },
      reviews: { pending: 1, acceptedCorrected: 1 },
      gate: { gateEvaluated: 2, eligible: 1, manualRequired: 1, autoAccepted: 1, auditPending: 1 },
      usage: {
        scope: "all_reported_model_calls",
        providerCalls: 1,
        succeededCalls: 1,
        failedCalls: 0,
        callsWithReportedUsage: 1,
        totalReportedInputTokens: 100,
        totalReportedOutputTokens: 20,
        totalReportedTokens: 120,
        averageReportedModelLatencyMs: 2000,
      },
    });
    expect(response.body.coverage).toMatchObject({
      eligibleSubmissions: 1,
      submissionsWithAnyRun: 1,
      submissionsWithSucceededRun: 1,
      submissionsHumanVerified: 1,
      anyRunRate: 1,
      succeededRate: 1,
      verifiedRate: 1,
    });
  });

  it("returns only currently published pending audits in the audit view", async () => {
    const adminCookie = await login("ops-admin");
    const response = await request(app.getHttpServer())
      .get("/api/v1/operations/annotation-runs?view=audit_pending&page=1&pageSize=50&includeSummary=false")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body.runs).toEqual([
      expect.objectContaining({
        id: "ANR-OPS-AUDIT",
        publicationStatus: "auto_accepted",
        auditStatus: "pending",
        autoEligibility: "eligible",
      }),
    ]);
  });

  it("maps failure views, omits expensive summary, and redacts stored errors", async () => {
    const adminCookie = await login("ops-admin");
    const response = await request(app.getHttpServer())
      .get("/api/v1/operations/annotation-runs?view=execution_failed&page=1&pageSize=50&includeSummary=false")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(response.body.summary).toBeUndefined();
    expect(response.body.coverage).toBeUndefined();
    expect(response.body.runs.map((run: { id: string }) => run.id)).toEqual([
      "ANR-OPS-STUCK",
      "ANR-OPS-FAILED",
    ]);
    const failed = response.body.runs.find((run: { id: string }) => run.id === "ANR-OPS-FAILED");
    expect(failed.lastErrorMessage).toContain("<redacted>");
    expect(failed.lastErrorMessage).toContain("<data-url-redacted>");
    expect(failed.lastErrorMessage).not.toContain("secret-token");
    expect(failed.lastErrorMessage).not.toContain("sk-secret");
  });

  it("does not change annotation metrics when legacy candidateAnnotation changes", async () => {
    const adminCookie = await login("ops-admin");
    const before = await request(app.getHttpServer())
      .get("/api/v1/operations/annotation-runs?view=all&includeSummary=true")
      .set("Cookie", adminCookie)
      .expect(200);
    const quality = await dataSource.getRepository(VideoQualityResultEntity).findOneByOrFail({
      submissionId: "SUB-OPS-REVIEW",
    });
    quality.normalizedResult = {
      candidateAnnotation: {
        status: "candidate",
        model: "legacy-shadow-must-not-count",
        usage: { totalTokens: 999_999 },
      },
    };
    await dataSource.getRepository(VideoQualityResultEntity).save(quality);
    const after = await request(app.getHttpServer())
      .get("/api/v1/operations/annotation-runs?view=all&includeSummary=true")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(after.body.summary).toEqual(before.body.summary);
    expect(after.body.coverage).toEqual(before.body.coverage);
    expect(after.body.runs).toEqual(before.body.runs);
  });

  it("rejects invalid annotation pagination and non-admin access", async () => {
    const [adminCookie, collectorCookie] = await Promise.all([
      login("ops-admin"),
      login("ops-collector"),
    ]);
    await request(app.getHttpServer())
      .get("/api/v1/operations/annotation-runs?page=0")
      .set("Cookie", adminCookie)
      .expect(400);
    await request(app.getHttpServer())
      .get("/api/v1/operations/annotation-runs?pageSize=101")
      .set("Cookie", adminCookie)
      .expect(400);
    await request(app.getHttpServer())
      .get("/api/v1/operations/annotation-runs")
      .set("Cookie", collectorCookie)
      .expect(403);
  });

  it("aggregates the full queue while limiting job details to 100", async () => {
    const adminCookie = await login("ops-admin");
    const jobs = dataSource.getRepository(JobOutboxEntity);
    const bulkIds = Array.from(
      { length: 101 },
      (_, index) => `JOB-OPS-BULK-${String(index).padStart(3, "0")}`,
    );
    await jobs.insert(
      bulkIds.map((id, index) => ({
        id,
        aggregateType: "submission",
        aggregateId: `SUB-OPS-BULK-${String(index).padStart(3, "0")}`,
        eventType: "media.probe.v1",
        payload: { submissionId: `SUB-OPS-BULK-${index}` },
        status: "pending" as const,
        attempts: 0,
        availableAt: new Date(),
        createdAt: new Date(Date.now() + index),
      })),
    );

    try {
      const response = await request(app.getHttpServer())
        .get("/api/v1/operations/queue")
        .set("Cookie", adminCookie)
        .expect(200);

      expect(response.body.summary).toMatchObject({
        total: 103,
        pending: 102,
        published: 1,
        failed: 0,
        media: 102,
        ai: 1,
        averagePublishLatencyMs: 60000,
      });
      expect(response.body.jobs).toHaveLength(100);
    } finally {
      await jobs
        .createQueryBuilder()
        .delete()
        .where("id LIKE :prefix", { prefix: "JOB-OPS-BULK-%" })
        .execute();
    }
  });

  it("reclaims worker tasks that exceed their timeout", async () => {
    const adminCookie = await login("ops-admin");
    await dataSource.getRepository(SubmissionEntity).save([
      {
        id: "SUB-OPS-TIMEOUT-MEDIA",
        ownerId: "U-OPS-COLLECTOR",
        teamId: "TEAM-OPS-01",
        originalFileName: "timeout-media.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "d".repeat(64),
        objectKey: "uploads/ops/timeout-media.mp4",
        uploadStatus: "uploaded",
        processingStatus: "probing",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-OPS-TIMEOUT-AI",
        ownerId: "U-OPS-COLLECTOR",
        teamId: "TEAM-OPS-01",
        originalFileName: "timeout-ai.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "e".repeat(64),
        objectKey: "uploads/ops/timeout-ai.mp4",
        uploadStatus: "uploaded",
        processingStatus: "ai_processing",
        uploadedAt: new Date(),
      },
    ]);
    await dataSource.getRepository(WorkerHeartbeatEntity).save([
      {
        id: "media-timeout-host-1",
        kind: "media",
        hostName: "timeout-host",
        processId: 100,
        status: "running",
        currentSubmissionId: "SUB-OPS-TIMEOUT-MEDIA",
        currentTaskStartedAt: new Date(Date.now() - 30 * 60_000),
        startedAt: new Date(),
        lastSeenAt: new Date(),
      },
      {
        id: "ai-timeout-host-1",
        kind: "ai_quality",
        hostName: "timeout-host",
        processId: 101,
        status: "running",
        currentSubmissionId: "SUB-OPS-TIMEOUT-AI",
        currentTaskStartedAt: new Date(Date.now() - 30 * 60_000),
        startedAt: new Date(),
        lastSeenAt: new Date(),
      },
    ]);

    const response = await request(app.getHttpServer())
      .post("/api/v1/operations/workers/reclaim-timeouts")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .expect(201);

    expect(response.body.reclaimed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          submissionId: "SUB-OPS-TIMEOUT-MEDIA",
          previousStatus: "probing",
          nextStatus: "queued",
          eventType: "media.probe.v1",
        }),
        expect.objectContaining({
          submissionId: "SUB-OPS-TIMEOUT-AI",
          previousStatus: "ai_processing",
          nextStatus: "awaiting_ai",
          eventType: "ai.quality.v1",
        }),
      ]),
    );
    await expect(
      dataSource
        .getRepository(JobOutboxEntity)
        .findOneByOrFail({ aggregateId: "SUB-OPS-TIMEOUT-MEDIA" }),
    ).resolves.toMatchObject({
      eventType: "media.probe.v1",
      status: "pending",
      attempts: 0,
    });
    await expect(
      dataSource
        .getRepository(JobOutboxEntity)
        .findOneByOrFail({ aggregateId: "SUB-OPS-TIMEOUT-AI" }),
    ).resolves.toMatchObject({
      eventType: "ai.quality.v1",
      status: "pending",
      attempts: 0,
    });
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "worker_task_reclaim",
      }),
    ).toBe(2);
    await dataSource
      .getRepository(JobOutboxEntity)
      .delete({ aggregateId: "SUB-OPS-TIMEOUT-MEDIA" });
    await dataSource
      .getRepository(JobOutboxEntity)
      .delete({ aggregateId: "SUB-OPS-TIMEOUT-AI" });
    await dataSource
      .getRepository(WorkerHeartbeatEntity)
      .delete({ id: "media-timeout-host-1" });
    await dataSource
      .getRepository(WorkerHeartbeatEntity)
      .delete({ id: "ai-timeout-host-1" });
    await dataSource
      .getRepository(SubmissionEntity)
      .delete({ id: "SUB-OPS-TIMEOUT-MEDIA" });
    await dataSource
      .getRepository(SubmissionEntity)
      .delete({ id: "SUB-OPS-TIMEOUT-AI" });
  });

  it("returns role-scoped live notifications and navigation badges", async () => {
    await dataSource.getRepository(WorkerHeartbeatEntity).save({
      id: "ai_quality-historical-idle",
      kind: "ai_quality",
      hostName: "old-test-host",
      processId: 41,
      status: "idle",
      startedAt: new Date(Date.now() - 10 * 60_000),
      lastSeenAt: new Date(Date.now() - 5 * 60_000),
    });
    const adminCookie = await login("ops-admin");
    const admin = await request(app.getHttpServer())
      .get("/api/v1/operations/status")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(admin.body.summary).toMatchObject({
      processingSubmissions: 1,
      failedSubmissions: 2,
      reviewPending: 1,
      unsettledEligible: 0,
      pendingJobs: 1,
    });
    expect(admin.body.summary.workerAlerts).toBe(0);
    expect(admin.body.navigationBadges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/admin/ai", count: 1, label: "1" }),
        expect.objectContaining({
          path: "/admin/review",
          count: 1,
          label: "1",
        }),
      ]),
    );
    expect(
      admin.body.navigationBadges.find(
        (badge: { path: string }) => badge.path === "/admin/settlements",
      ),
    ).toBeUndefined();
    expect(
      admin.body.navigationBadges.find(
        (badge: { path: string }) => badge.path === "/admin/audit",
      ),
    ).toBeUndefined();
    expect(admin.body.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "AI 队列需要关注",
          path: "/admin/ai",
        }),
        expect.objectContaining({
          title: "有视频等待人工复核",
          path: "/admin/review",
        }),
      ]),
    );

    const collectorCookie = await login("ops-collector");
    const collector = await request(app.getHttpServer())
      .get("/api/v1/operations/status")
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(collector.body.summary).toMatchObject({
      processingSubmissions: 1,
      failedSubmissions: 2,
      reviewPending: 1,
      unsettledEligible: 0,
      pendingJobs: 0,
    });
    expect(collector.body.navigationBadges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/collector/submissions",
          count: 3,
          label: "3",
        }),
        expect.objectContaining({
          path: "/collector/quality",
          count: 3,
          label: "3",
        }),
      ]),
    );
  });

  it("prunes only stopped or stale worker heartbeat history", async () => {
    const adminCookie = await login("ops-admin");
    await dataSource.getRepository(WorkerHeartbeatEntity).save([
      {
        id: "prune-stopped-1",
        kind: "ai_quality",
        hostName: "prune-host",
        processId: 201,
        status: "stopped",
        startedAt: new Date(Date.now() - 10 * 60_000),
        lastSeenAt: new Date(Date.now() - 10 * 60_000),
      },
      {
        id: "prune-stale-1",
        kind: "ai_quality",
        hostName: "prune-host",
        processId: 202,
        status: "running",
        startedAt: new Date(Date.now() - 10 * 60_000),
        lastSeenAt: new Date(Date.now() - 5 * 60_000),
      },
      {
        id: "prune-active-1",
        kind: "ai_quality",
        hostName: "prune-host",
        processId: 203,
        status: "idle",
        startedAt: new Date(),
        lastSeenAt: new Date(),
      },
    ]);

    const response = await request(app.getHttpServer())
      .post("/api/v1/operations/workers/prune-inactive")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .expect(201);

    expect(response.body.removed).toBeGreaterThanOrEqual(2);
    await expect(
      dataSource
        .getRepository(WorkerHeartbeatEntity)
        .findOneBy({ id: "prune-stopped-1" }),
    ).resolves.toBeNull();
    await expect(
      dataSource
        .getRepository(WorkerHeartbeatEntity)
        .findOneBy({ id: "prune-stale-1" }),
    ).resolves.toBeNull();
    await expect(
      dataSource
        .getRepository(WorkerHeartbeatEntity)
        .findOneBy({ id: "prune-active-1" }),
    ).resolves.toMatchObject({ id: "prune-active-1" });

    await dataSource
      .getRepository(WorkerHeartbeatEntity)
      .delete({ id: "prune-active-1" });
  });

  it("rejects non-admin worker history pruning", async () => {
    const collectorCookie = await login("ops-collector");
    await request(app.getHttpServer())
      .post("/api/v1/operations/workers/prune-inactive")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .expect(403);
  });
});
