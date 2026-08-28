import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 一级场景落库 + 计费大类动态化。
 *
 * - 新增 scene_level1：一级场景可管理（编码/名称/描述/启停/排序）。
 *   一级场景与计费大类 1:1 关联（category_key 指向 scene_category_pricing）；
 *   新增一级场景时自动创建对应计费行（默认 20 元/小时，可在结算页调整）。
 * - scene_classification.level1_code：由硬编码 CHECK 改为外键引用 scene_level1。
 * - scene_library.category_key：去掉 4 类硬编码 CHECK，支持动态计费大类。
 */
export class SceneLevel1Table2026090300001 implements MigrationInterface {
  name = "SceneLevel1Table2026090300001";
  timestamp = 2_026_090_300_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "scene_level1" (
        "id" varchar(64) PRIMARY KEY,
        "code" varchar(16) NOT NULL,
        "name" varchar(40) NOT NULL,
        "category_key" varchar(64) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "sort_order" integer NOT NULL DEFAULT 0,
        "enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_scene_level1_code" UNIQUE ("code"),
        CONSTRAINT "uq_scene_level1_name" UNIQUE ("name"),
        CONSTRAINT "uq_scene_level1_category" UNIQUE ("category_key")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "scene_level1"
        ("id", "code", "name", "category_key", "description", "sort_order") VALUES
        ('L1-F01', 'F01', '家庭',   'family',  '家庭场景（厨房/客厅/卧室等细分场景共用此价）', 10),
        ('L1-O01', 'O01', '办公室', 'office',  '办公室场景（工位整理/文件归档/办公设备操作等）', 20),
        ('L1-W01', 'W01', '工厂',   'factory', '工厂场景（车间装配/检测/打包/搬运等）',          30),
        ('L1-G01', 'G01', '通用',   'generic', '通用任务（不限场景，按最低价）',                  40)
    `);

    // 分类表一级编码：硬编码 CHECK → 外键引用 scene_level1
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        DROP CONSTRAINT "chk_scene_classification_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        ADD CONSTRAINT "fk_scene_classification_level1"
        FOREIGN KEY ("level1_code") REFERENCES "scene_level1"("code") ON DELETE RESTRICT
    `);

    // 场景库计费大类：去掉 4 类硬编码，支持动态大类
    await queryRunner.query(`
      ALTER TABLE "scene_library"
        DROP CONSTRAINT IF EXISTS "chk_scene_library_category"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "scene_library"
        ADD CONSTRAINT "chk_scene_library_category"
        CHECK ("category_key" IN ('family', 'office', 'factory', 'generic'))
    `);
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        DROP CONSTRAINT IF EXISTS "fk_scene_classification_level1"
    `);
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        ADD CONSTRAINT "chk_scene_classification_code"
        CHECK ("level1_code" IN ('F01', 'O01', 'W01', 'G01'))
    `);
    await queryRunner.query('DROP TABLE IF EXISTS "scene_level1"');
  }
}
