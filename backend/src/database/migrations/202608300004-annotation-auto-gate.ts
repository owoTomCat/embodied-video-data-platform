import type { MigrationInterface, QueryRunner } from "typeorm";

type ConflictRow = { submission_id: string; run_ids: string[] };

function conflictMessage(rows: ConflictRow[]): string {
  const details = rows
    .slice(0, 20)
    .map((row) => `${row.submission_id}=[${row.run_ids.join(",")}]`)
    .join("; ");
  return `Annotation auto gate migration blocked: duplicate current published runs: ${details}`;
}

export class AnnotationAutoGate2026083000004 implements MigrationInterface {
  name = "AnnotationAutoGate2026083000004";
  timestamp = 2_026_083_000_004;

  async up(queryRunner: QueryRunner): Promise<void> {
    const published = (await queryRunner.query(`
      SELECT submission_id, array_agg(id ORDER BY created_at, id) AS run_ids
      FROM annotation_runs
      WHERE publication_status IN ('human_verified', 'auto_accepted')
      GROUP BY submission_id
      HAVING count(*) > 1
    `)) as ConflictRow[];
    if (published.length > 0) throw new Error(conflictMessage(published));

    await queryRunner.query(`
      ALTER TABLE "annotation_runs"
        ADD COLUMN "full_model_attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN "schema_repair_calls" integer NOT NULL DEFAULT 0,
        ADD COLUMN "targeted_repair_calls" integer NOT NULL DEFAULT 0,
        ADD COLUMN "infrastructure_retry_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "provider_call_count" integer NOT NULL DEFAULT 0,
        ADD COLUMN "auto_eligibility" varchar(24) NOT NULL DEFAULT 'not_evaluated',
        ADD COLUMN "auto_gate_version" varchar(80),
        ADD COLUMN "auto_gate_issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN "would_auto_accept" boolean NOT NULL DEFAULT false,
        ADD COLUMN "auto_accept_enabled_snapshot" boolean NOT NULL DEFAULT false,
        ADD COLUMN "auto_gate_evaluated_at" timestamptz,
        ADD COLUMN "audit_status" varchar(24) NOT NULL DEFAULT 'not_selected',
        ADD COLUMN "audit_selected_at" timestamptz,
        ADD CONSTRAINT "chk_annotation_runs_full_model_attempts" CHECK ("full_model_attempts" BETWEEN 0 AND 2),
        ADD CONSTRAINT "chk_annotation_runs_call_counts" CHECK (
          "schema_repair_calls" >= 0 AND "targeted_repair_calls" >= 0
          AND "infrastructure_retry_count" >= 0 AND "provider_call_count" >= 0
        ),
        ADD CONSTRAINT "chk_annotation_runs_auto_eligibility" CHECK (
          "auto_eligibility" IN ('not_evaluated', 'eligible', 'manual_required')
        ),
        ADD CONSTRAINT "chk_annotation_runs_audit_status" CHECK (
          "audit_status" IN ('not_selected', 'pending', 'completed')
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "annotation_runs"
        DROP CONSTRAINT "chk_annotation_runs_review_status",
        ADD CONSTRAINT "chk_annotation_runs_review_status"
          CHECK ("review_status" IN ('pending', 'not_required', 'accepted_unchanged', 'accepted_corrected', 'rejected', 'unable_to_judge'))
    `);
    await queryRunner.query(`
      ALTER TABLE "annotation_reviews"
        ADD COLUMN "review_kind" varchar(16) NOT NULL DEFAULT 'blocking',
        ADD CONSTRAINT "chk_annotation_reviews_kind" CHECK ("review_kind" IN ('blocking', 'audit'))
    `);
    await queryRunner.query(`
      CREATE TABLE "annotation_model_calls" (
        "id" varchar(64) PRIMARY KEY,
        "annotation_run_id" varchar(64) NOT NULL,
        "logical_full_attempt" integer NOT NULL,
        "call_kind" varchar(24) NOT NULL,
        "call_status" varchar(16) NOT NULL,
        "http_status" integer,
        "provider_request_id" varchar(200),
        "response_model" varchar(120),
        "input_tokens" integer,
        "output_tokens" integer,
        "total_tokens" integer,
        "latency_ms" integer NOT NULL,
        "error_code" varchar(80),
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_annotation_model_calls_run"
          FOREIGN KEY ("annotation_run_id") REFERENCES "annotation_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "chk_annotation_model_calls_attempt" CHECK ("logical_full_attempt" BETWEEN 1 AND 2),
        CONSTRAINT "chk_annotation_model_calls_kind" CHECK ("call_kind" IN ('full', 'schema_repair', 'targeted_repair')),
        CONSTRAINT "chk_annotation_model_calls_status" CHECK ("call_status" IN ('succeeded', 'failed')),
        CONSTRAINT "chk_annotation_model_calls_latency" CHECK ("latency_ms" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_annotation_model_calls_run_created"
      ON "annotation_model_calls" ("annotation_run_id", "created_at" DESC, "id" DESC)
    `);
    await queryRunner.query('DROP INDEX "uq_annotation_runs_current_human_verified"');
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_annotation_runs_current_published"
      ON "annotation_runs" ("submission_id")
      WHERE "publication_status" IN ('human_verified', 'auto_accepted')
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_annotation_runs_audit_updated"
      ON "annotation_runs" ("audit_status", "updated_at" DESC, "id" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(`
      SELECT
        EXISTS (SELECT 1 FROM annotation_model_calls) AS has_model_calls,
        EXISTS (
          SELECT 1 FROM annotation_reviews WHERE review_kind = 'audit'
        ) AS has_audit_reviews,
        EXISTS (
          SELECT 1 FROM annotation_runs
          WHERE review_status = 'not_required'
             OR publication_status = 'auto_accepted'
             OR auto_eligibility <> 'not_evaluated'
             OR auto_gate_version IS NOT NULL
             OR auto_gate_issues <> '[]'::jsonb
             OR would_auto_accept
             OR auto_accept_enabled_snapshot
             OR auto_gate_evaluated_at IS NOT NULL
             OR audit_status <> 'not_selected'
             OR audit_selected_at IS NOT NULL
             OR full_model_attempts <> 0
             OR schema_repair_calls <> 0
             OR targeted_repair_calls <> 0
             OR infrastructure_retry_count <> 0
             OR provider_call_count <> 0
        ) AS has_auto_gate_data
    `)) as Array<{
      has_model_calls: boolean;
      has_audit_reviews: boolean;
      has_auto_gate_data: boolean;
    }>;
    if (
      rows[0]?.has_model_calls ||
      rows[0]?.has_audit_reviews ||
      rows[0]?.has_auto_gate_data
    ) {
      throw new Error(
        "Annotation auto gate migration down blocked: new auto-gate, audit, or model-call data exists",
      );
    }

    await queryRunner.query('DROP INDEX IF EXISTS "idx_annotation_runs_audit_updated"');
    await queryRunner.query('DROP INDEX IF EXISTS "uq_annotation_runs_current_published"');
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_annotation_runs_current_human_verified"
      ON "annotation_runs" ("submission_id")
      WHERE "publication_status" = 'human_verified'
    `);
    await queryRunner.query('DROP TABLE "annotation_model_calls"');
    await queryRunner.query(`
      ALTER TABLE "annotation_reviews"
        DROP CONSTRAINT "chk_annotation_reviews_kind",
        DROP COLUMN "review_kind"
    `);
    await queryRunner.query(`
      ALTER TABLE "annotation_runs"
        DROP CONSTRAINT "chk_annotation_runs_review_status",
        ADD CONSTRAINT "chk_annotation_runs_review_status"
          CHECK ("review_status" IN ('pending', 'accepted_unchanged', 'accepted_corrected', 'rejected', 'unable_to_judge')),
        DROP CONSTRAINT "chk_annotation_runs_audit_status",
        DROP CONSTRAINT "chk_annotation_runs_auto_eligibility",
        DROP CONSTRAINT "chk_annotation_runs_call_counts",
        DROP CONSTRAINT "chk_annotation_runs_full_model_attempts",
        DROP COLUMN "audit_selected_at",
        DROP COLUMN "audit_status",
        DROP COLUMN "auto_gate_evaluated_at",
        DROP COLUMN "auto_accept_enabled_snapshot",
        DROP COLUMN "would_auto_accept",
        DROP COLUMN "auto_gate_issues",
        DROP COLUMN "auto_gate_version",
        DROP COLUMN "auto_eligibility",
        DROP COLUMN "provider_call_count",
        DROP COLUMN "infrastructure_retry_count",
        DROP COLUMN "targeted_repair_calls",
        DROP COLUMN "schema_repair_calls",
        DROP COLUMN "full_model_attempts"
    `);
  }
}
