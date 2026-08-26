import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 任务类型体系：为 collection_tasks 增加 task_type（generic / preset / custom）。
 * - generic：通用任务（不绑定具体场景，创建页最显眼入口）
 * - preset：预设场景任务（按 preset-scenes.ts 模板创建）
 * - custom：自定义场景任务（管理员手工填写）
 * 存量任务回填：无场景的按 generic，有场景的按 custom（历史手工任务不误标为预设）。
 */
export class AddTaskTypeToCollectionTasks2026083000001
  implements MigrationInterface
{
  name = "AddTaskTypeToCollectionTasks2026083000001";
  timestamp = 2_026_083_000_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "collection_tasks"
        ADD COLUMN "task_type" varchar(24) NOT NULL DEFAULT 'custom'
    `);
    await queryRunner.query(`
      UPDATE "collection_tasks"
        SET "task_type" = CASE
          WHEN COALESCE("scene_name", '') = '' THEN 'generic'
          ELSE 'custom'
        END
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "collection_tasks" DROP COLUMN IF EXISTS "task_type"
    `);
  }
}
