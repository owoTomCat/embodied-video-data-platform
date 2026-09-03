import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 统一场景管理（P4）：
 * - submissions 加 guide_task_id / scene_library_id：提交挂场景大类(计费) + 连到 AI 任务卡，追溯场景库→任务卡→提交链路。
 * - scene_library 加 photo_refs / cover_object_key：数采建库时拍摄照片，首张作为场景库卡片封面，供 AI 识别生成任务卡。
 */
export class UnifiedSceneManagement2026091100001 implements MigrationInterface {
  name = "UnifiedSceneManagement2026091100001";
  timestamp = 2_026_091_100_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "submissions"
        ADD COLUMN "guide_task_id" varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions"
        ADD COLUMN "scene_library_id" varchar(64)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_submissions_guide_task"
        ON "submissions" ("guide_task_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_submissions_scene_library"
        ON "submissions" ("scene_library_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions"
        ADD CONSTRAINT "fk_submissions_guide_task"
        FOREIGN KEY ("guide_task_id") REFERENCES "guide_tasks"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions"
        ADD CONSTRAINT "fk_submissions_scene_library"
        FOREIGN KEY ("scene_library_id") REFERENCES "scene_library"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "scene_library"
        ADD COLUMN "photo_refs" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "scene_library"
        ADD COLUMN "cover_object_key" varchar(512)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "submissions" DROP CONSTRAINT IF EXISTS "fk_submissions_scene_library"
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions" DROP CONSTRAINT IF EXISTS "fk_submissions_guide_task"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_submissions_scene_library"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_submissions_guide_task"`);
    await queryRunner.query(`ALTER TABLE "submissions" DROP COLUMN IF EXISTS "scene_library_id"`);
    await queryRunner.query(`ALTER TABLE "submissions" DROP COLUMN IF EXISTS "guide_task_id"`);

    await queryRunner.query(`ALTER TABLE "scene_library" DROP COLUMN IF EXISTS "cover_object_key"`);
    await queryRunner.query(`ALTER TABLE "scene_library" DROP COLUMN IF EXISTS "photo_refs"`);
  }
}
