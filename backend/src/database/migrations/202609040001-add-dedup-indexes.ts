import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 为查重/近似重复查询补数据库索引。
 *
 * 背景：数据量增长后，上传查重（submissions.checksum_sha256 等值查询）与
 * 近似重复候选（media_metadata.size_bytes 范围查询）均无索引，走全表扫描。
 * 本迁移新增 2 个 B-tree 索引，把查重从 O(n) 全表扫描降为 O(log n) 索引查找。
 */
export class AddDedupIndexes2026090400001 implements MigrationInterface {
  name = "AddDedupIndexes2026090400001";
  timestamp = 2_026_090_400_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    // 1) 上传查重：submissions.checksum_sha256 等值查询（当前全表扫描）
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_submissions_checksum_sha256"
      ON "submissions" ("checksum_sha256")
    `);
    // 2) 近似重复候选：media_metadata.size_bytes 范围查询（±12%）
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_media_metadata_size_bytes"
      ON "media_metadata" ("size_bytes")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_submissions_checksum_sha256"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_media_metadata_size_bytes"`,
    );
  }
}
