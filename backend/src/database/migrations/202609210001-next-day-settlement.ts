import type { MigrationInterface, QueryRunner } from "typeorm";

/** No identities, balances, paid history or original accounting snapshots are rewritten. */
export class NextDaySettlement2026092100001 implements MigrationInterface {
  name = "NextDaySettlement2026092100001";
  timestamp = 2_026_092_100_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ["point_cycles", "point_cycle_adjustments", "point_rule_versions"]) {
      await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "created_by_account_id" DROP NOT NULL`);
    }
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS point_cycle_adjustment_sequence`);
    await queryRunner.query(`ALTER TABLE point_cycle_adjustments ADD COLUMN IF NOT EXISTS sequence bigint`);
    await queryRunner.query(`
      WITH ordered AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) +
          COALESCE((SELECT MAX(sequence) FROM point_cycle_adjustments), 0) AS sequence
        FROM point_cycle_adjustments WHERE sequence IS NULL
      )
      UPDATE point_cycle_adjustments a SET sequence = ordered.sequence FROM ordered WHERE a.id = ordered.id
    `);
    await queryRunner.query(`SELECT setval('point_cycle_adjustment_sequence', COALESCE(MAX(sequence), 1), MAX(sequence) IS NOT NULL) FROM point_cycle_adjustments`);
    await queryRunner.query(`ALTER TABLE point_cycle_adjustments ALTER COLUMN sequence SET DEFAULT nextval('point_cycle_adjustment_sequence'), ALTER COLUMN sequence SET NOT NULL`);
    await queryRunner.query(`ALTER SEQUENCE point_cycle_adjustment_sequence OWNED BY point_cycle_adjustments.sequence`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_point_cycle_adjustments_latest ON point_cycle_adjustments(point_cycle_item_id, sequence DESC)`);
    // Historical grouped cycles remain grouped. Never make a later-approved item
    // available early: use the latest original approval's next calendar day.
    await queryRunner.query(`
      UPDATE point_cycles c
      SET settle_due_at = (
        SELECT ((date_trunc('day', MAX(COALESCE(i.quality_reviewed_at,
          q.manual_reviewed_at, q.completed_at, q.updated_at, q.created_at, c.created_at))
          AT TIME ZONE 'Asia/Shanghai') + interval '1 day 2 hours') AT TIME ZONE 'Asia/Shanghai')
        FROM point_cycle_items i
        LEFT JOIN video_quality_results q ON q.submission_id = i.submission_id
        WHERE i.cycle_id = c.id
      )
      WHERE c.status = 'locked'
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_point_cycles_pending_due ON point_cycles(settle_due_at, id) WHERE status = 'locked'`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_wallet_transactions_cycle_owner ON wallet_transactions(cycle_id, owner_id)`);
  }

  async down(): Promise<void> {
    // A financial policy rollback must not restore earlier due dates or discard
    // system-authored accounting records. Restore a verified backup explicitly.
    throw new Error("Next-day settlement is forward-only; restore a verified backup to roll back financial policy");
  }
}
