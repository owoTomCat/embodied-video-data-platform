import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 场景大类定价表 + 种子数据。
 *
 * 定价单位：元/小时。当前场景大类：
 * - family（家庭）：20 元/小时，家庭-厨房/客厅/卧室共用
 * - office（办公室）：25 元/小时
 * - factory（工厂）：30 元/小时
 * - generic（通用任务，不限场景）：20 元/小时
 *
 * 同时把占位阶段（1 积分 = 1 元）的全局默认单价从「12 分/分钟」
 * 更新为「20 元/小时」，统一金额体系单位。
 */
export class SceneCategoryPricing2026090100001
  implements MigrationInterface
{
  name = "SceneCategoryPricing2026090100001";
  timestamp = 2_026_090_100_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "scene_category_pricing" (
        "category_key" varchar(64) PRIMARY KEY,
        "name" varchar(120) NOT NULL,
        "price_per_hour" numeric(10,2) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_scene_category_price_range"
          CHECK ("price_per_hour" >= 20 AND "price_per_hour" <= 40)
      )
    `);
    await queryRunner.query(`
      INSERT INTO "scene_category_pricing"
        ("category_key", "name", "price_per_hour", "description")
      VALUES
        ('family',  '家庭',   20.00, '家庭场景（厨房/客厅/卧室等细分场景共用此价）'),
        ('office',  '办公室', 25.00, '办公室场景（工位整理/文件归档/办公设备操作等）'),
        ('factory', '工厂',   30.00, '工厂场景（车间装配/检测/打包/搬运等）'),
        ('generic', '通用',   20.00, '通用任务（不限场景，按最低价）')
    `);
    // 单位统一为元/小时：仅当占位默认值 12 分/分钟时更新为 20 元/小时
    await queryRunner.query(`
      UPDATE "point_rule_versions"
      SET "default_points_per_minute" = 20
      WHERE "active" = true AND "default_points_per_minute" = 12
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "scene_category_pricing"',
    );
  }
}
