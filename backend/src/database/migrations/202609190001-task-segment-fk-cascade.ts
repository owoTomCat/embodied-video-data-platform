import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 修复：删除提交时被 task-segment 派生数据的 RESTRICT 外键拦断（500）。
 * task_segment_assets / task_boundary_refinements / task_segment_annotation_revisions
 * 都是随提交派生的视频处理记录，应随提交删除级联（改 ON DELETE CASCADE）。
 * 财务表（point_cycle_items / delivery_package_items / point_cycle_adjustments）仍 RESTRICT，由服务端守卫拦截。
 */
export class TaskSegmentFkCascade2026091900001 implements MigrationInterface {
  name = "TaskSegmentFkCascade2026091900001";
  timestamp = 2_026_091_900_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        DROP CONSTRAINT IF EXISTS "fk_task_segment_assets_submission"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        ADD CONSTRAINT "fk_task_segment_assets_submission"
        FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "task_boundary_refinements"
        DROP CONSTRAINT IF EXISTS "fk_task_boundary_refinements_submission"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_boundary_refinements"
        ADD CONSTRAINT "fk_task_boundary_refinements_submission"
        FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        DROP CONSTRAINT IF EXISTS "fk_task_segment_assets_boundary_refinement"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        ADD CONSTRAINT "fk_task_segment_assets_boundary_refinement"
        FOREIGN KEY ("boundary_refinement_id") REFERENCES "task_boundary_refinements"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "task_segment_annotation_revisions"
        DROP CONSTRAINT IF EXISTS "fk_segment_annotation_asset"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_segment_annotation_revisions"
        ADD CONSTRAINT "fk_segment_annotation_asset"
        FOREIGN KEY ("task_segment_asset_id") REFERENCES "task_segment_assets"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        DROP CONSTRAINT IF EXISTS "fk_task_segment_assets_annotation_run"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_segment_assets"
        ADD CONSTRAINT "fk_task_segment_assets_annotation_run"
        FOREIGN KEY ("annotation_run_id") REFERENCES "annotation_runs"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "task_boundary_refinements"
        DROP CONSTRAINT IF EXISTS "fk_task_boundary_refinements_annotation_run"
    `);
    await queryRunner.query(`
      ALTER TABLE "task_boundary_refinements"
        ADD CONSTRAINT "fk_task_boundary_refinements_annotation_run"
        FOREIGN KEY ("annotation_run_id") REFERENCES "annotation_runs"("id") ON DELETE CASCADE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const restore = (table: string, constraint: string, col: string, ref: string) => `
      ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}";
      ALTER TABLE "${table}"
        ADD CONSTRAINT "${constraint}"
        FOREIGN KEY ("${col}") REFERENCES "${ref}"("id") ON DELETE RESTRICT
    `;
    await queryRunner.query(restore("task_boundary_refinements", "fk_task_boundary_refinements_annotation_run", "annotation_run_id", "annotation_runs"));
    await queryRunner.query(restore("task_segment_assets", "fk_task_segment_assets_annotation_run", "annotation_run_id", "annotation_runs"));
    await queryRunner.query(restore("task_segment_annotation_revisions", "fk_segment_annotation_asset", "task_segment_asset_id", "task_segment_assets"));
    await queryRunner.query(restore("task_segment_assets", "fk_task_segment_assets_boundary_refinement", "boundary_refinement_id", "task_boundary_refinements"));
    await queryRunner.query(restore("task_boundary_refinements", "fk_task_boundary_refinements_submission", "submission_id", "submissions"));
    await queryRunner.query(restore("task_segment_assets", "fk_task_segment_assets_submission", "submission_id", "submissions"));
  }
}
