import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 大场景任务 + 小场景库单场景 + 双向统计（PR-4）：
 * - collection_tasks 加 category_key（scene_type 绑定计费大类）。
 * - 新增 scene_task_targets（补量目标按场景细分）。
 * - scene_library.sub_scene_ids（多选）→ scene_id（单选）+ collection_task_id。
 * - submissions 加 scene_id / category_key / collection_task_id。
 */
export class TaskSceneBinding2026091600001 implements MigrationInterface {
  name = "TaskSceneBinding2026091600001";
  timestamp = 2_026_091_600_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. collection_tasks 加计费大类
    await queryRunner.query(`
      ALTER TABLE "collection_tasks"
        ADD COLUMN "category_key" varchar(64)
    `);

    // 2. 补量目标按场景细分
    await queryRunner.query(`
      CREATE TABLE "scene_task_targets" (
        "id" varchar(64) PRIMARY KEY,
        "task_id" varchar(64) NOT NULL,
        "scene_id" varchar(64) NOT NULL,
        "target_duration_seconds" bigint NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_scene_task_targets" UNIQUE ("task_id", "scene_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_scene_task_targets_task" ON "scene_task_targets" ("task_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_scene_task_targets_scene" ON "scene_task_targets" ("scene_id")
    `);

    // 历史 scene_type 任务：按 scene_name 匹配 scene.name，生成场景目标
    await queryRunner.query(`
      INSERT INTO "scene_task_targets" ("id", "task_id", "scene_id", "target_duration_seconds")
      SELECT
        'STT-' || substr(md5(random()::text), 1, 8),
        ct."id",
        sc."id",
        ct."target_duration_seconds"
      FROM "collection_tasks" ct
      JOIN "scene" sc ON sc."name" = ct."scene_name"
      WHERE ct."task_type" = 'scene_type'
        AND ct."target_duration_seconds" IS NOT NULL
    `);

    // 3. scene_library：sub_scene_ids → scene_id + collection_task_id
    await queryRunner.query(`
      ALTER TABLE "scene_library"
        ADD COLUMN "scene_id" varchar(64)
    `);
    await queryRunner.query(`
      UPDATE "scene_library"
         SET "scene_id" = ("sub_scene_ids" ->> 0)
       WHERE jsonb_array_length("sub_scene_ids") > 0
    `);
    await queryRunner.query(`
      ALTER TABLE "scene_library"
        ADD COLUMN "collection_task_id" varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "scene_library"
        DROP COLUMN "sub_scene_ids"
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_scene_library_scene" ON "scene_library" ("scene_id")
    `);

    // 4. submissions：加 scene_id / category_key / collection_task_id 并回填
    await queryRunner.query(`
      ALTER TABLE "submissions"
        ADD COLUMN "scene_id" varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions"
        ADD COLUMN "category_key" varchar(64)
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions"
        ADD COLUMN "collection_task_id" varchar(64)
    `);
    await queryRunner.query(`
      UPDATE "submissions" s
         SET "scene_id" = sl."scene_id",
             "category_key" = sl."category_key",
             "collection_task_id" = sl."collection_task_id"
        FROM "scene_library" sl
       WHERE s."scene_library_id" = sl."id"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "submissions" DROP COLUMN IF EXISTS "collection_task_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions" DROP COLUMN IF EXISTS "category_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions" DROP COLUMN IF EXISTS "scene_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "scene_library"
        ADD COLUMN "sub_scene_ids" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      UPDATE "scene_library"
         SET "sub_scene_ids" = jsonb_build_array("scene_id")
       WHERE "scene_id" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "scene_library" DROP COLUMN IF EXISTS "collection_task_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "scene_library" DROP COLUMN IF EXISTS "scene_id"
    `);

    await queryRunner.query('DROP TABLE IF EXISTS "scene_task_targets"');
    await queryRunner.query(`
      ALTER TABLE "collection_tasks" DROP COLUMN IF EXISTS "category_key"
    `);
  }
}
