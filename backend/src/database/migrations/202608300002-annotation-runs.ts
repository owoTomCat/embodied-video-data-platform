import type { MigrationInterface, QueryRunner } from "typeorm";

export class AnnotationRuns2026083000002 implements MigrationInterface {
  name = "AnnotationRuns2026083000002";
  timestamp = 2_026_083_000_002;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "annotation_runs" (
        "id" varchar(64) PRIMARY KEY,
        "submission_id" varchar(64) NOT NULL,
        "trigger" varchar(24) NOT NULL DEFAULT 'initial',
        "pipeline_version" varchar(80) NOT NULL,
        "schema_version" varchar(80) NOT NULL,
        "evidence_policy_version" varchar(80) NOT NULL,
        "prompt_version" varchar(120),
        "prompt_content_sha256" char(64),
        "system_prompt_snapshot" text,
        "output_example_snapshot" jsonb,
        "model" varchar(120),
        "label_set_version_id" varchar(64),
        "label_set_revision" integer,
        "label_set_snapshot" jsonb,
        "execution_status" varchar(24) NOT NULL,
        "review_status" varchar(32) NOT NULL,
        "publication_status" varchar(24) NOT NULL,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "review_revision" integer NOT NULL DEFAULT 0,
        "last_error_code" varchar(80),
        "last_error_message" text,
        "next_retry_at" timestamptz,
        "provider_request_id" varchar(200),
        "response_model" varchar(120),
        "raw_result" jsonb,
        "normalized_result" jsonb,
        "human_result" jsonb,
        "input_tokens" integer,
        "output_tokens" integer,
        "total_tokens" integer,
        "latency_ms" integer,
        "frame_count" integer,
        "source_timestamps_ms" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "queued_at" timestamptz NOT NULL,
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_annotation_runs_submission"
          FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_annotation_runs_trigger"
          CHECK ("trigger" IN ('initial', 'manual')),
        CONSTRAINT "chk_annotation_runs_execution_status"
          CHECK ("execution_status" IN ('queued', 'running', 'retry_scheduled', 'succeeded', 'system_failed', 'stuck', 'cancelled')),
        CONSTRAINT "chk_annotation_runs_review_status"
          CHECK ("review_status" IN ('pending', 'accepted_unchanged', 'accepted_corrected', 'rejected', 'unable_to_judge')),
        CONSTRAINT "chk_annotation_runs_publication_status"
          CHECK ("publication_status" IN ('candidate_only', 'human_verified', 'auto_accepted', 'rejected', 'superseded')),
        CONSTRAINT "chk_annotation_runs_attempt_count" CHECK ("attempt_count" >= 0),
        CONSTRAINT "chk_annotation_runs_review_revision" CHECK ("review_revision" >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_annotation_runs_submission_created" ON "annotation_runs" ("submission_id", "created_at" DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX "idx_annotation_runs_execution_retry" ON "annotation_runs" ("execution_status", "next_retry_at")',
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_annotation_runs_initial_submission"
       ON "annotation_runs" ("submission_id") WHERE "trigger" = 'initial'`,
    );

    await queryRunner.query(`
      CREATE TABLE "annotation_reviews" (
        "id" varchar(64) PRIMARY KEY,
        "annotation_run_id" varchar(64) NOT NULL,
        "revision" integer NOT NULL,
        "disposition" varchar(32) NOT NULL,
        "reviewed_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "reason_codes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "review_duration_ms" integer NOT NULL,
        "reason" text NOT NULL,
        "reviewer_account_id" varchar(64) NOT NULL,
        "reviewer_name" varchar(120) NOT NULL,
        "corrected_result" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_annotation_reviews_run"
          FOREIGN KEY ("annotation_run_id") REFERENCES "annotation_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_annotation_reviews_disposition"
          CHECK ("disposition" IN ('accepted_unchanged', 'accepted_corrected', 'rejected', 'unable_to_judge')),
        CONSTRAINT "chk_annotation_reviews_revision" CHECK ("revision" > 0),
        CONSTRAINT "chk_annotation_reviews_duration" CHECK ("review_duration_ms" >= 0)
      )
    `);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "uq_annotation_reviews_run_revision" ON "annotation_reviews" ("annotation_run_id", "revision")',
    );

    await queryRunner.query(`
      CREATE TABLE "annotation_corrections" (
        "id" varchar(64) PRIMARY KEY,
        "annotation_run_id" varchar(64) NOT NULL,
        "review_id" varchar(64) NOT NULL,
        "target_type" varchar(40) NOT NULL,
        "target_id" varchar(120) NOT NULL,
        "field_path" varchar(300) NOT NULL,
        "previous_value" jsonb,
        "next_value" jsonb,
        "reason_code" varchar(80) NOT NULL,
        "comment" text,
        "reviewer_account_id" varchar(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_annotation_corrections_run"
          FOREIGN KEY ("annotation_run_id") REFERENCES "annotation_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_annotation_corrections_review"
          FOREIGN KEY ("review_id") REFERENCES "annotation_reviews"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "idx_annotation_corrections_run_created" ON "annotation_corrections" ("annotation_run_id", "created_at" DESC)',
    );

    await queryRunner.query(`
      ALTER TABLE "worker_heartbeats"
      DROP CONSTRAINT "chk_worker_heartbeats_kind",
      ADD CONSTRAINT "chk_worker_heartbeats_kind"
        CHECK ("kind" IN ('media', 'ai_quality', 'ai_annotation'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "worker_heartbeats" WHERE "kind" = 'ai_annotation'`,
    );
    await queryRunner.query(`
      ALTER TABLE "worker_heartbeats"
      DROP CONSTRAINT "chk_worker_heartbeats_kind",
      ADD CONSTRAINT "chk_worker_heartbeats_kind"
        CHECK ("kind" IN ('media', 'ai_quality'))
    `);
    await queryRunner.query('DROP TABLE IF EXISTS "annotation_corrections"');
    await queryRunner.query('DROP TABLE IF EXISTS "annotation_reviews"');
    await queryRunner.query('DROP TABLE IF EXISTS "annotation_runs"');
  }
}
