import type { MigrationInterface, QueryRunner } from "typeorm";

export class SimplePayouts2026092400001 implements MigrationInterface {
  name = "SimplePayouts2026092400001";
  async up(runner: QueryRunner): Promise<void> {
    // Retain every historical row, snapshot, batch and terminal-state protection.
    await runner.query(`ALTER TABLE withdrawal_requests DROP CONSTRAINT withdrawal_supervision_batch`);
    await runner.query(`DO $$ DECLARE c record; BEGIN
      FOR c IN SELECT conname FROM pg_constraint
        WHERE conrelid='withdrawal_requests'::regclass AND contype='c'
          AND (pg_get_constraintdef(oid) LIKE '%review_mode%' OR
            (pg_get_constraintdef(oid) LIKE '%transfer_reference%' AND pg_get_constraintdef(oid) LIKE '%paid_at%'))
      LOOP EXECUTE format('ALTER TABLE withdrawal_requests DROP CONSTRAINT %I', c.conname); END LOOP;
    END $$`);
    await runner.query(`ALTER TABLE withdrawal_requests
      ADD CONSTRAINT withdrawal_review_mode CHECK (review_mode IN ('independent','single','legacy','manual')),
      ADD CONSTRAINT withdrawal_payment_confirmation CHECK (status <> 'paid' OR
        (COALESCE(review_mode = 'manual', false) AND reviewed_by_id IS NOT NULL AND reviewed_at IS NOT NULL) OR
        (transfer_reference IS NOT NULL AND paid_at IS NOT NULL)),
      ADD CONSTRAINT withdrawal_batch_history CHECK (
        (status IN ('pending','rejected') AND batch_id IS NULL) OR
        (status IN ('processing','review_pending','investigating','failed') AND batch_id IS NOT NULL) OR
        (status = 'paid' AND (batch_id IS NOT NULL OR COALESCE(review_mode = 'manual', false))))`);
  }
  async down(): Promise<void> { throw new Error("Simple payouts is forward-only; restore a verified backup instead"); }
}
