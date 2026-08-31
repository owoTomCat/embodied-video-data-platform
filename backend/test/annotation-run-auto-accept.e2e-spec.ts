import type { DataSource } from "typeorm";

import { createDataSource } from "../src/database/data-source.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { AnnotationModelCallEntity } from "../src/database/entities/annotation-model-call.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";
import { AnnotationRunService } from "../src/video-annotation/annotation-run.service.js";
import type { VideoAnnotationCandidateSuccess } from "../src/video-annotation/video-annotation.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

describe("annotation auto-accept completion", () => {
  let dataSource: DataSource;
  let service: AnnotationRunService;
  const previousEnabled = process.env.ANNOTATION_AUTO_ACCEPT_ENABLED;
  const previousAuditRate = process.env.ANNOTATION_AUTO_ACCEPT_AUDIT_RATE;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    await dataSource.getRepository(TeamEntity).save({ id: "TEAM-AUTO", name: "自动准入测试" });
    await dataSource.getRepository(UserEntity).save({
      id: "U-AUTO",
      displayName: "自动准入数采",
      username: "annotation-auto-user",
      usernameNormalized: "annotation-auto-user",
      passwordHash: "not-used",
      role: "collector",
      teamId: "TEAM-AUTO",
      status: "active",
    });
    await dataSource.getRepository(SubmissionEntity).save({
      id: "SUB-AUTO",
      ownerId: "U-AUTO",
      teamId: "TEAM-AUTO",
      originalFileName: "auto.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "100",
      checksumSha256: "a".repeat(64),
      objectKey: "auto/auto.mp4",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      storageStatus: "available",
    });
    service = new AnnotationRunService(dataSource, {} as never, {} as never);
  });

  afterAll(async () => {
    if (previousEnabled === undefined) delete process.env.ANNOTATION_AUTO_ACCEPT_ENABLED;
    else process.env.ANNOTATION_AUTO_ACCEPT_ENABLED = previousEnabled;
    if (previousAuditRate === undefined) delete process.env.ANNOTATION_AUTO_ACCEPT_AUDIT_RATE;
    else process.env.ANNOTATION_AUTO_ACCEPT_AUDIT_RATE = previousAuditRate;
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  function run(id: string, publicationStatus: "candidate_only" | "human_verified") {
    return {
      id,
      submissionId: "SUB-AUTO",
      trigger: "manual" as const,
      pipelineVersion: "ego_video_annotation_pipeline_v2",
      schemaVersion: "ego_video_annotation_v2",
      evidencePolicyVersion: "ego_annotation_evidence_policy_v3",
      executionStatus: publicationStatus === "human_verified" ? "succeeded" as const : "running" as const,
      reviewStatus: publicationStatus === "human_verified" ? "accepted_unchanged" as const : "pending" as const,
      publicationStatus,
      reviewRevision: publicationStatus === "human_verified" ? 1 : 0,
      queuedAt: new Date(),
    };
  }

  function result(eligibility: "eligible" | "manual_required"): VideoAnnotationCandidateSuccess {
    return {
      status: eligibility === "eligible" ? "candidate" : "review_required",
      schemaVersion: "ego_video_annotation_v2",
      policyVersion: "ego_annotation_evidence_policy_v3",
      promptVersion: "ego_video_annotation_prompt_v2",
      promptContentSha256: "b".repeat(64),
      model: "qwen3.7-plus",
      requestId: "request-auto",
      durationMs: 100,
      frameCount: 4,
      sampling: { maxFrameGapMs: 5_000, sourceTimestampsMs: [0, 5_000, 10_000, 15_000] },
      labelMappings: [],
      raw: {} as VideoAnnotationCandidateSuccess["raw"],
      effective: {} as VideoAnnotationCandidateSuccess["effective"],
      validation: { errors: [], warnings: [] },
      reviewReasons: eligibility === "manual_required" ? ["NO_TASK_DETECTED"] : [],
      gate: {
        version: "annotation_auto_gate_v1",
        eligibility,
        issues: eligibility === "manual_required"
          ? [{
              code: "NO_TASK_DETECTED",
              level: "manual_review",
              fieldPath: null,
              taskIndex: null,
              message: "视频未识别到任务",
              evidenceTimestampsMs: [],
              resolution: "not_applicable",
            }]
          : [],
      },
    };
  }

  async function complete(runId: string, candidate: VideoAnnotationCandidateSuccess) {
    await (
      service as unknown as {
        complete(id: string, value: VideoAnnotationCandidateSuccess): Promise<void>;
      }
    ).complete(runId, candidate);
  }

  it("atomically publishes eligible runs only when enabled and never changes QC state", async () => {
    const repository = dataSource.getRepository(AnnotationRunEntity);
    await repository.save([
      run("ANR-AUTO-OLD", "human_verified"),
      run("ANR-AUTO-NEW", "candidate_only"),
    ]);
    process.env.ANNOTATION_AUTO_ACCEPT_ENABLED = "true";
    process.env.ANNOTATION_AUTO_ACCEPT_AUDIT_RATE = "1";

    await complete("ANR-AUTO-NEW", result("eligible"));

    expect(await repository.findOneByOrFail({ id: "ANR-AUTO-OLD" })).toMatchObject({
      publicationStatus: "superseded",
    });
    expect(await repository.findOneByOrFail({ id: "ANR-AUTO-NEW" })).toMatchObject({
      executionStatus: "succeeded",
      reviewStatus: "not_required",
      publicationStatus: "auto_accepted",
      autoEligibility: "eligible",
      autoGateVersion: "annotation_auto_gate_v1",
      wouldAutoAccept: true,
      autoAcceptEnabledSnapshot: true,
      auditStatus: "pending",
    });

    await repository.save(run("ANR-AUTO-OFF", "candidate_only"));
    process.env.ANNOTATION_AUTO_ACCEPT_ENABLED = "false";
    await complete("ANR-AUTO-OFF", result("eligible"));
    expect(await repository.findOneByOrFail({ id: "ANR-AUTO-OFF" })).toMatchObject({
      reviewStatus: "pending",
      publicationStatus: "candidate_only",
      autoEligibility: "eligible",
      wouldAutoAccept: true,
      autoAcceptEnabledSnapshot: false,
    });
    expect(await repository.findOneByOrFail({ id: "ANR-AUTO-NEW" })).toMatchObject({
      publicationStatus: "auto_accepted",
    });
    expect(await dataSource.getRepository(VideoQualityResultEntity).count()).toBe(0);
    expect(await dataSource.getRepository(SubmissionEntity).findOneByOrFail({ id: "SUB-AUTO" })).toMatchObject({
      processingStatus: "completed",
      assetStatus: "active",
    });
  });

  it("persists and accumulates successful, failed, and repair provider calls", async () => {
    const repository = dataSource.getRepository(AnnotationRunEntity);
    await repository.save(run("ANR-AUTO-LEDGER", "candidate_only"));
    const recordCall = (
      service as unknown as {
        recordModelCall(id: string, value: {
          logicalFullAttempt: number;
          callKind: "full" | "schema_repair" | "targeted_repair";
          callStatus: "succeeded" | "failed";
          httpStatus: number | null;
          providerRequestId: string | null;
          responseModel: string | null;
          inputTokens: number | null;
          outputTokens: number | null;
          totalTokens: number | null;
          latencyMs: number;
          errorCode: string | null;
          errorMessage: string | null;
        }): Promise<void>;
      }
    ).recordModelCall.bind(service);
    await recordCall("ANR-AUTO-LEDGER", {
      logicalFullAttempt: 1,
      callKind: "full",
      callStatus: "succeeded",
      httpStatus: 200,
      providerRequestId: "request-full",
      responseModel: "qwen3.7-plus",
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      latencyMs: 1_000,
      errorCode: null,
      errorMessage: null,
    });
    await recordCall("ANR-AUTO-LEDGER", {
      logicalFullAttempt: 1,
      callKind: "schema_repair",
      callStatus: "failed",
      httpStatus: 500,
      providerRequestId: "request-schema",
      responseModel: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      latencyMs: 200,
      errorCode: "MODEL_HTTP_500",
      errorMessage: "Bearer sk-secret failed",
    });
    await recordCall("ANR-AUTO-LEDGER", {
      logicalFullAttempt: 1,
      callKind: "targeted_repair",
      callStatus: "succeeded",
      httpStatus: 200,
      providerRequestId: "request-targeted",
      responseModel: "qwen3.7-plus",
      inputTokens: 30,
      outputTokens: 10,
      totalTokens: 40,
      latencyMs: 300,
      errorCode: null,
      errorMessage: null,
    });

    expect(await repository.findOneByOrFail({ id: "ANR-AUTO-LEDGER" })).toMatchObject({
      fullModelAttempts: 1,
      schemaRepairCalls: 1,
      targetedRepairCalls: 1,
      providerCallCount: 3,
      inputTokens: 130,
      outputTokens: 30,
      totalTokens: 160,
      latencyMs: 1_500,
    });
    const calls = await dataSource.getRepository(AnnotationModelCallEntity).find({
      where: { annotationRunId: "ANR-AUTO-LEDGER" },
      order: { createdAt: "ASC", id: "ASC" },
    });
    expect(calls).toHaveLength(3);
    expect(calls[1]).toMatchObject({
      callKind: "schema_repair",
      callStatus: "failed",
      inputTokens: null,
      errorMessage: "Bearer <redacted> failed",
    });

    const exhausted = run("ANR-AUTO-EXHAUSTED", "candidate_only");
    Object.assign(exhausted, {
      executionStatus: "retry_scheduled",
      fullModelAttempts: 2,
    });
    await repository.save(exhausted);
    expect(
      await (
        service as unknown as {
          markFullBudgetExhausted(id: string): Promise<boolean>;
        }
      ).markFullBudgetExhausted("ANR-AUTO-EXHAUSTED"),
    ).toBe(true);
    expect(await repository.findOneByOrFail({ id: "ANR-AUTO-EXHAUSTED" })).toMatchObject({
      executionStatus: "system_failed",
      fullModelAttempts: 2,
      lastErrorCode: "MODEL_RESPONSE_INVALID",
    });
  });
});
