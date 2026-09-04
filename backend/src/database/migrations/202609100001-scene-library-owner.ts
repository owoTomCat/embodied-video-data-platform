import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 场景库归属数采人员：scene_library 加 owner_account_id。
 * 数采可自建「我的场景库」，管理员可看到并统一管理所有数采的场景库；
 * 管理员统一管理的场景库 owner 为 null。
 */
export class SceneLibraryOwner2026091000001 implements MigrationInterface {
  name = "SceneLibraryOwner2026091000001";
  timestamp = 2_026_091_000_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "scene_library"
        ADD COLUMN "owner_account_id" varchar(64)
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_scene_library_owner"
        ON "scene_library" ("owner_account_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "scene_library"
        ADD CONSTRAINT "fk_scene_library_owner"
        FOREIGN KEY ("owner_account_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "scene_library" DROP CONSTRAINT IF EXISTS "fk_scene_library_owner"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_scene_library_owner"`);
    await queryRunner.query(`
      ALTER TABLE "scene_library" DROP COLUMN IF EXISTS "owner_account_id"
    `);
  }
}
