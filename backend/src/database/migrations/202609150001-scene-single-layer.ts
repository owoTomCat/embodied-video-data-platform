import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 场景单层化：
 * - scene_classification 重命名为 scene，二级场景升级为唯一场景实体。
 * - 新增 category_key（由 level1_code → scene_level1.category_key 回填）。
 * - 删除 level1_code / level1_name。
 * - 删除 scene_level1 表（一级场景降级为计费大类属性）。
 */
export class SceneSingleLayer2026091500001 implements MigrationInterface {
  name = "SceneSingleLayer2026091500001";
  timestamp = 2_026_091_500_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 去掉 scene_classification.level1_code → scene_level1.code 的外键（列将被删除）
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        DROP CONSTRAINT IF EXISTS "fk_scene_classification_level1"
    `);

    // 2. 新增 category_key 列
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        ADD COLUMN "category_key" varchar(64)
    `);

    // 3. 回填 category_key（level1_code → scene_level1.category_key）
    await queryRunner.query(`
      UPDATE "scene_classification" AS sc
         SET "category_key" = sl."category_key"
        FROM "scene_level1" AS sl
       WHERE sc."level1_code" = sl."code"
    `);

    // 兜底：未匹配到 level1 的行回填为 generic
    await queryRunner.query(`
      UPDATE "scene_classification"
         SET "category_key" = 'generic'
       WHERE "category_key" IS NULL
    `);

    // 4. category_key 设为非空
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        ALTER COLUMN "category_key" SET NOT NULL
    `);

    // 5. 删除 level1_code / level1_name
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        DROP COLUMN "level1_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        DROP COLUMN "level1_name"
    `);

    // 6. 重命名表 scene_classification → scene
    await queryRunner.query(`
      ALTER TABLE "scene_classification" RENAME TO "scene"
    `);

    // 7. 重建唯一索引（(level1_code, level2_name) → (category_key, name)）
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_scene_classification_level2"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_scene_category_name"
        ON "scene" ("category_key", "name")
    `);

    // 8. 删除 scene_level1 表
    await queryRunner.query('DROP TABLE IF EXISTS "scene_level1"');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // 1. 重建 scene_level1（种子行，best-effort）
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
        ('L1-F01', 'F01', '家庭',   'family',  '', 10),
        ('L1-O01', 'O01', '办公室', 'office',  '', 20),
        ('L1-W01', 'W01', '工厂',   'factory', '', 30),
        ('L1-G01', 'G01', '通用',   'generic', '', 40)
    `);

    // 2. 表名改回
    await queryRunner.query(`
      ALTER TABLE "scene" RENAME TO "scene_classification"
    `);

    // 3. 恢复 level1_code / level1_name（由 category_key 反查）
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        ADD COLUMN "level1_code" varchar(16),
        ADD COLUMN "level1_name" varchar(40)
    `);
    await queryRunner.query(`
      UPDATE "scene_classification" AS sc
         SET "level1_code" = sl."code",
             "level1_name" = sl."name"
        FROM "scene_level1" AS sl
       WHERE sc."category_key" = sl."category_key"
    `);

    // 4. 删除 category_key
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        DROP COLUMN "category_key"
    `);

    // 5. 恢复外键与唯一索引
    await queryRunner.query(`
      ALTER TABLE "scene_classification"
        ADD CONSTRAINT "fk_scene_classification_level1"
        FOREIGN KEY ("level1_code") REFERENCES "scene_level1"("code") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "uq_scene_category_name"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_scene_classification_level2"
        ON "scene_classification" ("level1_code", "level2_name")
    `);
  }
}
