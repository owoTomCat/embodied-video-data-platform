import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 结算体系重构：钱包 + 周期两阶段（锁定中 → 已结算）。
 *
 * - wallet_balances：每个数采人员的钱包余额
 *   （总余额 = 结算中 + 可提现 + 已提现；累计提现单独记录）
 * - wallet_transactions：钱包流水（lock 锁定入结算中 / settle 结算转可提现 /
 *   withdraw 提现），amount 带符号，balance_after 为操作后总余额
 * - point_cycles 增加 settle_due_at（锁定 + 3 天自动结算时间）与 settled_at
 * - 单位语义：现有积分字段按 1 积分 = 1 元占位，金额计算方式后续再定
 */
export class WalletAndSettlement2026083100001 implements MigrationInterface {
  name = "WalletAndSettlement2026083100001";
  timestamp = 2_026_083_100_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "wallet_balances" (
        "owner_id" varchar(64) NOT NULL,
        "total_balance" numeric(14, 2) NOT NULL DEFAULT 0,
        "settling_balance" numeric(14, 2) NOT NULL DEFAULT 0,
        "available_balance" numeric(14, 2) NOT NULL DEFAULT 0,
        "withdrawn_balance" numeric(14, 2) NOT NULL DEFAULT 0,
        "cumulative_withdrawn" numeric(14, 2) NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_wallet_balances" PRIMARY KEY ("owner_id"),
        CONSTRAINT "fk_wallet_balances_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "wallet_transactions" (
        "id" varchar(64) NOT NULL,
        "owner_id" varchar(64) NOT NULL,
        "type" varchar(24) NOT NULL,
        "amount" numeric(14, 2) NOT NULL,
        "balance_after" numeric(14, 2) NOT NULL,
        "cycle_id" varchar(64),
        "submission_id" varchar(64),
        "remark" text,
        "created_by_account_id" varchar(64),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_wallet_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_wallet_transactions_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_wallet_transactions_owner_created"
        ON "wallet_transactions" ("owner_id", "created_at")
    `);
    await queryRunner.query(`
      ALTER TABLE "point_cycles"
        ADD COLUMN "settle_due_at" timestamptz,
        ADD COLUMN "settled_at" timestamptz
    `);
    // 周期状态从「仅锁定」扩展为「锁定中/已结算」
    await queryRunner.query(`
      ALTER TABLE "point_cycles"
        DROP CONSTRAINT IF EXISTS "chk_point_cycles_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "point_cycles"
        ADD CONSTRAINT "chk_point_cycles_status"
          CHECK ("status" IN ('locked', 'settled'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "point_cycles"
        DROP COLUMN IF EXISTS "settle_due_at",
        DROP COLUMN IF EXISTS "settled_at"
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_wallet_transactions_owner_created"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "wallet_transactions"');
    await queryRunner.query('DROP TABLE IF EXISTS "wallet_balances"');
  }
}
