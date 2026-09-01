import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 场景型任务：taskType 新增 scene_type + 目标时长字段。
 * 用于两层任务体系第一层——平台按二级场景设置补量任务（目标时长 = 期望的合格有效时长存量）。
 */
export class SceneTypeTask2026090500001 implements MigrationInterface {
  name = "SceneTypeTask2026090500001";
  timestamp = 2_026_090_500_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "collection_tasks"
        ADD COLUMN "target_duration_seconds" bigint
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "collection_tasks"
        DROP COLUMN IF EXISTS "target_duration_seconds"
    `);
  }
}
