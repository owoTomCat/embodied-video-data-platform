import type { MigrationInterface, QueryRunner } from "typeorm";

export class PayoutEvidence2026092300001 implements MigrationInterface {
  name = "PayoutEvidence2026092300001";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE withdrawal_evidence (
      id varchar(64) PRIMARY KEY,
      request_id varchar(64) NOT NULL REFERENCES withdrawal_requests(id) ON DELETE RESTRICT,
      original_file_name varchar(180) NOT NULL,
      content_type varchar(32) NOT NULL CHECK (content_type IN ('image/jpeg','image/png','application/pdf')),
      size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
      sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
      uploaded_by_id varchar(64) NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(),
      object_key varchar(256) NOT NULL UNIQUE
    )`);
    await queryRunner.query(`CREATE INDEX idx_withdrawal_evidence_request ON withdrawal_evidence(request_id,created_at)`);
    await queryRunner.query(`CREATE OR REPLACE FUNCTION protect_withdrawal_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      RAISE EXCEPTION 'Withdrawal evidence is immutable';
    END $$`);
    await queryRunner.query(`CREATE TRIGGER withdrawal_evidence_immutable BEFORE UPDATE OR DELETE ON withdrawal_evidence FOR EACH ROW EXECUTE FUNCTION protect_withdrawal_evidence()`);
  }
  async down(): Promise<void> {
    throw new Error("Payout evidence is forward-only; restore a verified backup instead");
  }
}
