import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAccountPhone2026082600001 implements MigrationInterface {
  name = "AddAccountPhone2026082600001";
  timestamp = 2_026_082_600_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "phone" varchar(30)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "phone"`);
  }
}
