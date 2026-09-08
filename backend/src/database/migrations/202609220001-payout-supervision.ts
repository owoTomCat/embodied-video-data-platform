import type { MigrationInterface, QueryRunner } from "typeorm";

export class PayoutSupervision2026092200001 implements MigrationInterface {
  name = "PayoutSupervision2026092200001";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE withdrawal_requests
      ADD COLUMN assignee_id varchar(64) REFERENCES users(id), ADD COLUMN assigned_at timestamptz,
      ADD COLUMN revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
      ADD COLUMN registered_by_id varchar(64) REFERENCES users(id), ADD COLUMN reviewed_by_id varchar(64) REFERENCES users(id),
      ADD COLUMN reviewed_at timestamptz, ADD COLUMN review_mode varchar(16) CHECK (review_mode IN ('independent','single','legacy')),
      ADD COLUMN latest_registration_id varchar(64)`);
    await runner.query(`UPDATE withdrawal_requests r SET assignee_id=b.created_by, assigned_at=b.created_at FROM withdrawal_batches b WHERE r.batch_id=b.id`);
    await runner.query(`UPDATE withdrawal_requests SET review_mode='legacy' WHERE status='paid'`);
    // Remove only the two historical state constraints; monetary/snapshot checks remain intact.
    await runner.query(`DO $$ DECLARE c record; BEGIN FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='withdrawal_requests'::regclass AND contype='c' AND (pg_get_constraintdef(oid) LIKE '%pending%' OR pg_get_constraintdef(oid) LIKE '%processing%') LOOP EXECUTE format('ALTER TABLE withdrawal_requests DROP CONSTRAINT %I',c.conname); END LOOP; END $$`);
    await runner.query(`ALTER TABLE withdrawal_requests ADD CONSTRAINT withdrawal_supervision_status CHECK(status IN ('pending','processing','review_pending','investigating','paid','rejected','failed')),
      ADD CONSTRAINT withdrawal_supervision_batch CHECK ((status IN ('pending','rejected') AND batch_id IS NULL) OR (status IN ('processing','review_pending','investigating','paid','failed') AND batch_id IS NOT NULL))`);
    await runner.query(`CREATE TABLE withdrawal_registrations (
      id varchar(64) PRIMARY KEY, request_id varchar(64) NOT NULL REFERENCES withdrawal_requests(id), request_revision integer NOT NULL,
      registered_by_id varchar(64) NOT NULL REFERENCES users(id), registered_by_name varchar(120) NOT NULL,
      transfer_reference varchar(120) NOT NULL, paid_at timestamptz NOT NULL, evidence_ids jsonb NOT NULL, note varchar(500), created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(request_id,request_revision), UNIQUE(request_id,id))`);
    await runner.query(`ALTER TABLE withdrawal_requests ADD CONSTRAINT withdrawal_latest_registration_fk FOREIGN KEY(id,latest_registration_id) REFERENCES withdrawal_registrations(request_id,id)`);
    await runner.query(`CREATE TABLE withdrawal_payment_references (method varchar(16) NOT NULL, transfer_reference varchar(120) NOT NULL, request_id varchar(64) NOT NULL REFERENCES withdrawal_requests(id), PRIMARY KEY(method,transfer_reference))`);
    // Existing references reserve their channel/reference without fabricating registrations or review.
    await runner.query(`INSERT INTO withdrawal_payment_references(method,transfer_reference,request_id) SELECT DISTINCT ON(method,transfer_reference) method,transfer_reference,id FROM withdrawal_requests WHERE transfer_reference IS NOT NULL ORDER BY method,transfer_reference,created_at,id`);
    await runner.query(`CREATE TABLE withdrawal_events (id varchar(64) PRIMARY KEY, request_id varchar(64) NOT NULL REFERENCES withdrawal_requests(id), sequence bigserial UNIQUE NOT NULL,
      action varchar(64) NOT NULL, actor_id varchar(64) REFERENCES users(id), actor_name varchar(120) NOT NULL, reason varchar(500), registration_id varchar(64), details jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(request_id,registration_id) REFERENCES withdrawal_registrations(request_id,id))`);
    await runner.query(`CREATE INDEX idx_withdrawal_events_request ON withdrawal_events(request_id,sequence)`);
    await runner.query(`INSERT INTO withdrawal_events(id,request_id,action,actor_id,actor_name,reason,registration_id,details,created_at)
      SELECT 'LE-' || md5(a.id || r.id),r.id,a.action,u.id,a.actor_name,NULL,NULL,
      jsonb_build_object('legacyAuditId',a.id,'legacy',true,'before',a.before_value,'after',a.after_value),a.created_at
      FROM audit_logs a JOIN withdrawal_requests r ON a.after_value->>'requestId'=r.id
        OR (a.action='withdrawal.exported' AND a.after_value->>'batchId'=r.batch_id)
      LEFT JOIN users u ON u.id=a.actor_account_id
      WHERE a.action LIKE 'withdrawal.%' ORDER BY a.created_at,a.id,r.id`);
    await runner.query(`CREATE OR REPLACE FUNCTION protect_payout_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Payout history is immutable'; END $$`);
    for (const table of ['withdrawal_registrations', 'withdrawal_events', 'withdrawal_payment_references']) {
      await runner.query(`CREATE TRIGGER payout_history_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION protect_payout_history()`);
    }
    await runner.query(`CREATE OR REPLACE FUNCTION protect_terminal_payout() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status IN ('paid','failed','rejected') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Terminal payout is immutable'; END IF; RETURN NEW; END $$`);
    await runner.query(`CREATE TRIGGER payout_terminal_immutable BEFORE UPDATE ON withdrawal_requests FOR EACH ROW EXECUTE FUNCTION protect_terminal_payout()`);
  }
  async down(): Promise<void> { throw new Error("Payout supervision is forward-only; restore a verified backup instead"); }
}
