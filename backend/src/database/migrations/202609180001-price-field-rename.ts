import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 字段命名修正：price_points_per_minute → price_per_hour。
 * 该字段存储的是「元/小时」单价（历史命名误导），仅重命名列，不改变值。
 */
export class PriceFieldRename2026091800001 implements MigrationInterface {
  name = "PriceFieldRename2026091800001";
  timestamp = 2_026_091_800_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "collection_tasks"
        RENAME COLUMN "price_points_per_minute" TO "price_per_hour"
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions"
        RENAME COLUMN "task_price_points_per_minute" TO "task_price_per_hour"
    `);
    await queryRunner.query(`
      ALTER TABLE "point_cycle_items"
        RENAME COLUMN "price_points_per_minute" TO "price_per_hour"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "point_cycle_items"
        RENAME COLUMN "price_per_hour" TO "price_points_per_minute"
    `);
    await queryRunner.query(`
      ALTER TABLE "submissions"
        RENAME COLUMN "task_price_per_hour" TO "task_price_points_per_minute"
    `);
    await queryRunner.query(`
      ALTER TABLE "collection_tasks"
        RENAME COLUMN "price_per_hour" TO "price_points_per_minute"
    `);
  }
}
