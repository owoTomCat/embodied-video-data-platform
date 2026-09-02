import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 指导任务卡改挂「数采个人场景库」：
 * guide_tasks 加 scene_library_id（归属场景库）、title（短标题）、task_index（同批子任务序号）；
 * scene_type_task_id 改为可空（新流程以场景库为准，场景型任务仍可用于补量口径）。
 */
export class GuideTaskSceneLibrary2026091000002 implements MigrationInterface {
  name = "GuideTaskSceneLibrary2026091000002";
  timestamp = 2_026_091_000_002;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "guide_tasks"
        ADD COLUMN "scene_library_id" varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks"
        ADD COLUMN "title" varchar(160)
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks"
        ADD COLUMN "task_index" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks" ALTER COLUMN "scene_type_task_id" DROP NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_guide_tasks_library"
        ON "guide_tasks" ("scene_library_id", "owner_account_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks"
        ADD CONSTRAINT "fk_guide_tasks_scene_library"
        FOREIGN KEY ("scene_library_id") REFERENCES "scene_library"("id") ON DELETE CASCADE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "guide_tasks" DROP CONSTRAINT IF EXISTS "fk_guide_tasks_scene_library"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_guide_tasks_library"`);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks" DROP COLUMN IF EXISTS "scene_library_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks" DROP COLUMN IF EXISTS "title"
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks" DROP COLUMN IF EXISTS "task_index"
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks" ALTER COLUMN "scene_type_task_id" SET NOT NULL
    `);
  }
}
