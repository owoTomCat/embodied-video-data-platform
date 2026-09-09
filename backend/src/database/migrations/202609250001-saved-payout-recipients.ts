import type { MigrationInterface, QueryRunner } from "typeorm";

export class SavedPayoutRecipients2026092500001 implements MigrationInterface {
  name = "SavedPayoutRecipients2026092500001";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE saved_payout_recipients (
      owner_id varchar(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      method varchar(16) NOT NULL CHECK (method IN ('alipay','bank')),
      recipient_encrypted text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_id, method)
    )`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE saved_payout_recipients");
  }
}
