import type { DataSource } from "typeorm";

import { createDataSource } from "../src/database/data-source.js";
import { AnnotationCorrectionEntity } from "../src/database/entities/annotation-correction.entity.js";
import { AnnotationModelCallEntity } from "../src/database/entities/annotation-model-call.entity.js";
import { AnnotationReviewEntity } from "../src/database/entities/annotation-review.entity.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

describe("annotation lifecycle migration", () => {
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

  async function indexNames(): Promise<string[]> {
    const rows = (await dataSource.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'annotation_runs'
    `)) as Array<{ indexname: string }>;
    return rows.map((row) => row.indexname);
  }

  async function undoMigrationsAfter(name: string): Promise<void> {
    for (;;) {
      const rows = (await dataSource.query(
        'SELECT name FROM migrations ORDER BY id DESC LIMIT 1',
      )) as Array<{ name: string }>;
      const latest = rows[0]?.name;
      if (latest === name) return;
      if (!latest) throw new Error(`Migration ${name} was not applied`);
      await dataSource.undoLastMigration();
    }
  }

  it("migrates down/up and refuses historical publication conflicts", async () => {
    expect(await indexNames()).toEqual(expect.arrayContaining([
      "uq_annotation_runs_current_published",
      "uq_annotation_runs_pending_candidate",
      "idx_annotation_runs_execution_updated",
      "idx_annotation_runs_review_publication_updated",
    ]));

    await dataSource.getRepository(TeamEntity).save({ id: "TEAM-MIG-AN", name: "迁移测试团队" });
    await dataSource.getRepository(UserEntity).save({
      id: "U-MIG-AN",
      displayName: "迁移测试用户",
      username: "migration-annotation-user",
      usernameNormalized: "migration-annotation-user",
      passwordHash: "not-used",
      role: "collector",
      teamId: "TEAM-MIG-AN",
      status: "active",
    });
    await dataSource.getRepository(SubmissionEntity).save({
      id: "SUB-MIG-AN",
      ownerId: "U-MIG-AN",
      teamId: "TEAM-MIG-AN",
      originalFileName: "migration.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "100",
      checksumSha256: "a".repeat(64),
      objectKey: "migration/annotation.mp4",
      uploadStatus: "uploaded",
      processingStatus: "completed",
    });
    const baseRun = {
      submissionId: "SUB-MIG-AN",
      pipelineVersion: "pipeline-v1",
      schemaVersion: "schema-v1",
      evidencePolicyVersion: "evidence-v1",
      executionStatus: "succeeded" as const,
      reviewStatus: "accepted_unchanged" as const,
      publicationStatus: "human_verified" as const,
      attemptCount: 1,
      reviewRevision: 1,
      queuedAt: new Date(),
    };
    await dataSource.getRepository(AnnotationRunEntity).save({
      ...baseRun,
      id: "ANR-MIG-1",
      trigger: "initial",
    });
    await dataSource.getRepository(AnnotationReviewEntity).save({
      id: "ANV-MIG-1",
      annotationRunId: "ANR-MIG-1",
      revision: 1,
      disposition: "accepted_unchanged",
      reviewedFields: ["video_summary"],
      reasonCodes: ["HUMAN_VERIFIED"],
      reviewDurationMs: 10,
      reason: "验证迁移外键",
      reviewerAccountId: "U-MIG-AN",
      reviewerName: "迁移测试用户",
    });
    await dataSource.getRepository(AnnotationCorrectionEntity).save({
      id: "ANC-MIG-1",
      annotationRunId: "ANR-MIG-1",
      reviewId: "ANV-MIG-1",
      targetType: "annotation",
      targetId: "video",
      fieldPath: "video_summary",
      previousValue: "before",
      nextValue: "after",
      reasonCode: "HUMAN_VERIFIED",
      reviewerAccountId: "U-MIG-AN",
    });

    await undoMigrationsAfter("AnnotationAutoGate2026083000004");
    await dataSource.undoLastMigration();
    expect(await indexNames()).toEqual(expect.arrayContaining([
      "uq_annotation_runs_current_human_verified",
      "uq_annotation_runs_pending_candidate",
    ]));
    await dataSource.undoLastMigration();
    expect(await indexNames()).not.toEqual(expect.arrayContaining([
      "uq_annotation_runs_current_human_verified",
      "uq_annotation_runs_pending_candidate",
    ]));
    await dataSource.query(`
      INSERT INTO annotation_runs (
        id, submission_id, trigger, pipeline_version, schema_version,
        evidence_policy_version, execution_status, review_status,
        publication_status, attempt_count, review_revision, queued_at
      ) VALUES (
        'ANR-MIG-CONFLICT', 'SUB-MIG-AN', 'manual', 'pipeline-v1', 'schema-v1',
        'evidence-v1', 'succeeded', 'accepted_unchanged',
        'human_verified', 1, 1, now()
      )
    `);

    await expect(dataSource.runMigrations()).rejects.toThrow(
      /duplicate human_verified runs/u,
    );
    expect(await dataSource.getRepository(AnnotationRunEntity).countBy({
      publicationStatus: "human_verified",
    })).toBe(2);
    await dataSource.getRepository(AnnotationRunEntity).delete({ id: "ANR-MIG-CONFLICT" });
    await dataSource.runMigrations();
    expect(await indexNames()).toEqual(expect.arrayContaining([
      "uq_annotation_runs_current_published",
      "uq_annotation_runs_pending_candidate",
    ]));
    expect(await dataSource.getRepository(AnnotationCorrectionEntity).count()).toBe(1);
    await dataSource.getRepository(AnnotationModelCallEntity).save({
      id: "AMC-MIG-1",
      annotationRunId: "ANR-MIG-1",
      logicalFullAttempt: 1,
      callKind: "full",
      callStatus: "succeeded",
      latencyMs: 10,
    });
    await undoMigrationsAfter("AnnotationAutoGate2026083000004");
    await expect(dataSource.undoLastMigration()).rejects.toThrow(
      /migration down blocked/u,
    );
  });
});
