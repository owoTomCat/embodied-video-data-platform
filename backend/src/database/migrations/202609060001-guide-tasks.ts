import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 指导任务卡（guide_tasks）：两层任务体系第三层——数采选场景型任务 → 拍照识别环境物体 →
 * LLM 生成结构化任务卡 → (编辑→人工审核) → 按卡采集上传。
 */
export class GuideTasks2026090600001 implements MigrationInterface {
  name = "GuideTasks2026090600001";
  timestamp = 2_026_090_600_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "guide_tasks" (
        "id" varchar(64) PRIMARY KEY,
        "scene_type_task_id" varchar(64) NOT NULL,
        "owner_account_id" varchar(64) NOT NULL,
        "photo_refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "env_objects" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "task_card" jsonb,
        "vision_model" varchar(120),
        "card_prompt_version" varchar(120),
        "status" varchar(24) NOT NULL,
        "edited_at" timestamptz,
        "submission_id" varchar(64),
        "last_error_code" varchar(80),
        "last_error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_guide_tasks_task_owner"
        ON "guide_tasks" ("scene_type_task_id", "owner_account_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_guide_tasks_status_updated"
        ON "guide_tasks" ("status", "updated_at", "id")
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks"
        ADD CONSTRAINT "fk_guide_tasks_scene_type_task"
        FOREIGN KEY ("scene_type_task_id") REFERENCES "collection_tasks"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks"
        ADD CONSTRAINT "fk_guide_tasks_owner"
        FOREIGN KEY ("owner_account_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks"
        ADD CONSTRAINT "fk_guide_tasks_submission"
        FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE SET NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "guide_tasks" DROP CONSTRAINT IF EXISTS "fk_guide_tasks_submission"
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks" DROP CONSTRAINT IF EXISTS "fk_guide_tasks_owner"
    `);
    await queryRunner.query(`
      ALTER TABLE "guide_tasks" DROP CONSTRAINT IF EXISTS "fk_guide_tasks_scene_type_task"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "guide_tasks"`);
  }
}
