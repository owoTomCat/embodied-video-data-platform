import type { DataSource } from "typeorm";

import { createDataSource } from "../src/database/data-source.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TaskSegmentAssetEntity } from "../src/database/entities/task-segment-asset.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

describe("task segment adaptive-cut migration", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("migrates historical ready assets down/up without claiming new validation", async () => {
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-SEG-MIG",
      name: "切片迁移测试团队",
    });
    await dataSource.getRepository(UserEntity).save({
      id: "U-SEG-MIG",
      displayName: "切片迁移测试用户",
      username: "segment-migration-user",
      usernameNormalized: "segment-migration-user",
      passwordHash: "not-used",
      role: "collector",
      teamId: "TEAM-SEG-MIG",
      status: "active",
    });
    await dataSource.getRepository(SubmissionEntity).save({
      id: "SUB-SEG-MIG",
      ownerId: "U-SEG-MIG",
      teamId: "TEAM-SEG-MIG",
      originalFileName: "segment-migration.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "1000",
      checksumSha256: "a".repeat(64),
      objectKey: "uploads/segment-migration.mp4",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      storageStatus: "available",
      assetStatus: "active",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(AnnotationRunEntity).save({
      id: "RUN-SEG-MIG",
      submissionId: "SUB-SEG-MIG",
      trigger: "manual",
      pipelineVersion: "ego_video_annotation_pipeline_v2",
      schemaVersion: "ego_video_annotation_v2",
      evidencePolicyVersion: "ego_annotation_evidence_policy_v3",
      promptVersion: "ego_video_annotation_prompt_v2",
      promptContentSha256: "b".repeat(64),
      systemPromptSnapshot: "migration test",
      outputExampleSnapshot: {},
      model: "qwen-test",
      executionStatus: "succeeded",
      reviewStatus: "not_required",
      publicationStatus: "auto_accepted",
      normalizedResult: { status: "candidate" },
      autoEligibility: "eligible",
      autoGateVersion: "annotation_auto_gate_v2",
      autoGateIssues: [],
      wouldAutoAccept: true,
      autoAcceptEnabledSnapshot: true,
      autoGateEvaluatedAt: new Date(),
      queuedAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
    });
    await dataSource.getRepository(TaskSegmentAssetEntity).save({
      id: "TSA-SEG-MIG",
      submissionId: "SUB-SEG-MIG",
      annotationRunId: "RUN-SEG-MIG",
      taskIndex: 0,
      pipelineVersion: "ego_video_annotation_pipeline_v2",
      promptVersion: "ego_video_annotation_prompt_v2",
      schemaVersion: "ego_video_annotation_v2",
      evidencePolicyVersion: "ego_annotation_evidence_policy_v3",
      taskLabel: "迁移前任务",
      taskVerb: "place",
      completion: "complete",
      resultStatus: "success",
      sourceStartMs: 1_500,
      sourceEndMs: 3_500,
      clipStartMs: 1_000,
      clipEndMs: 4_000,
      requestedStartMs: 1_000,
      requestedEndMs: 4_000,
      actualStartMs: 1_000,
      actualEndMs: 4_000,
      materializationPolicyVersion: "task_segment_adaptive_cut_policy_v1",
      materializationMode: "stream_copy",
      sourceCodec: "h264",
      sourceNominalFps: 30,
      sourceHasAudio: true,
      sourceDurationMs: 10_000,
      requestedDurationMs: 3_000,
      predictedCopyStartMs: 1_000,
      keyframeDistanceStartMs: 0,
      boundaryToleranceMs: 66.6667,
      startDriftMs: 0,
      endDriftMs: 0,
      validationStatus: "passed",
      streamCopyAttempted: true,
      materializationStartedAt: new Date(),
      materializationCompletedAt: new Date(),
      materializationDurationMs: 10,
      coverageSnapshot: [],
      evidenceSnapshot: {},
      validationWarnings: [],
      sourceObjectKey: "uploads/segment-migration.mp4",
      sourceSha256: "a".repeat(64),
      clipObjectKey: "task-segments/SUB-SEG-MIG/RUN-SEG-MIG/task-0.mp4",
      clipSha256: "c".repeat(64),
      clipSizeBytes: "500",
      clipDurationMs: 3_000,
      codec: "h264",
      width: 1280,
      height: 720,
      frameRate: 30,
      hasAudio: true,
      generationStatus: "ready",
      attemptCount: 1,
      usageStatus: "internal_only",
      generationPolicyVersion: "task_segment_v1_policy_v1",
      startedAt: new Date(),
      completedAt: new Date(),
    });

    // Down to the adaptive-cut migration: any migrations added after it
    // (segment JSON publication, asset projection, scene binding, price field
    // rename, FK cascade, ... variants) must be undone first so that
    // adaptive-cut becomes the latest applied migration.
    const ADAPTIVE_CUT_MIGRATION = "TaskSegmentAdaptiveCut2026090600001";
    for (;;) {
      const latest = (await dataSource.query(
        "SELECT name FROM migrations ORDER BY id DESC LIMIT 1",
      )) as Array<{ name: string }>;
      if (latest[0]?.name === ADAPTIVE_CUT_MIGRATION) break;
      await dataSource.undoLastMigration();
    }
    await dataSource.undoLastMigration();
    const afterDown = (await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'task_segment_assets'
        AND column_name = 'requested_start_ms'
    `)) as Array<{ column_name: string }>;
    expect(afterDown).toEqual([]);

    await dataSource.runMigrations();
    const rows = (await dataSource.query(`
      SELECT requested_start_ms, requested_end_ms, actual_start_ms,
             actual_end_ms, materialization_policy_version,
             materialization_mode, validation_status
      FROM task_segment_assets
      WHERE id = 'TSA-SEG-MIG'
    `)) as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      requested_start_ms: 1_000,
      requested_end_ms: 4_000,
      actual_start_ms: null,
      actual_end_ms: null,
      materialization_policy_version: "legacy_stream_copy_unvalidated_v0",
      materialization_mode: "stream_copy",
      validation_status: "pending",
    });
    await expect(dataSource.query(`
      UPDATE task_segment_assets
      SET requested_start_ms = 5_000, requested_end_ms = 4_000
      WHERE id = 'TSA-SEG-MIG'
    `)).rejects.toThrow(/chk_task_segment_assets_requested_range/u);

    await dataSource.undoLastMigration();
    await dataSource.runMigrations();
  });
});
