import type { MigrationInterface, QueryRunner } from "typeorm";

export class DeliveryAnnotationSnapshots2026082600001
  implements MigrationInterface
{
  name = "DeliveryAnnotationSnapshots2026082600001";
  timestamp = 2_026_082_600_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_package_items"
        ADD COLUMN "accepted_annotation_snapshot" jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_package_items"
        DROP COLUMN IF EXISTS "accepted_annotation_snapshot"
    `);
  }
}
