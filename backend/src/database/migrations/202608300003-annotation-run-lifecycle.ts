import type { MigrationInterface, QueryRunner } from "typeorm";

type ConflictRow = { submission_id: string; run_ids: string[] };

function conflictMessage(kind: string, rows: ConflictRow[]): string {
  const details = rows
    .slice(0, 20)
    .map((row) => `${row.submission_id}=[${row.run_ids.join(",")}]`)
    .join("; ");
  return `Annotation lifecycle migration blocked: duplicate ${kind}: ${details}`;
}

export class AnnotationRunLifecycle2026083000003 implements MigrationInterface {
  name = "AnnotationRunLifecycle2026083000003";
  timestamp = 2_026_083_000_003;

  async up(queryRunner: QueryRunner): Promise<void> {
    const published = (await queryRunner.query(`
      SELECT submission_id, array_agg(id ORDER BY created_at, id) AS run_ids
      FROM annotation_runs
      WHERE publication_status = 'human_verified'
      GROUP BY submission_id
      HAVING count(*) > 1
    `)) as ConflictRow[];
    if (published.length > 0) {
      throw new Error(conflictMessage("human_verified runs", published));
    }

    const candidates = (await queryRunner.query(`
      SELECT submission_id, array_agg(id ORDER BY created_at, id) AS run_ids
      FROM annotation_runs
      WHERE execution_status = 'succeeded'
        AND review_status = 'pending'
        AND publication_status = 'candidate_only'
      GROUP BY submission_id
      HAVING count(*) > 1
    `)) as ConflictRow[];
    if (candidates.length > 0) {
      throw new Error(conflictMessage("pending candidate runs", candidates));
    }

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_annotation_runs_current_human_verified"
      ON "annotation_runs" ("submission_id")
      WHERE "publication_status" = 'human_verified'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_annotation_runs_pending_candidate"
      ON "annotation_runs" ("submission_id")
      WHERE "execution_status" = 'succeeded'
        AND "review_status" = 'pending'
        AND "publication_status" = 'candidate_only'
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_annotation_runs_execution_updated"
      ON "annotation_runs" ("execution_status", "updated_at" DESC, "id" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_annotation_runs_review_publication_updated"
      ON "annotation_runs" ("review_status", "publication_status", "updated_at" DESC, "id" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "idx_annotation_runs_review_publication_updated"');
    await queryRunner.query('DROP INDEX IF EXISTS "idx_annotation_runs_execution_updated"');
    await queryRunner.query('DROP INDEX IF EXISTS "uq_annotation_runs_pending_candidate"');
    await queryRunner.query('DROP INDEX IF EXISTS "uq_annotation_runs_current_human_verified"');
  }
}
