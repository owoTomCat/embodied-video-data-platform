import type { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 云账户（yunzhanghu）接入基础表：数采人员收款档案、打款订单、回调流水。
 *
 * 骨架阶段仅建表；后续按需扩展字段或拆分。
 */
export class Yunzhanghu2026090900001 implements MigrationInterface {
  name = "Yunzhanghu2026090900001";
  timestamp = 2_026_090_900_001;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "collector_payout_accounts" (
        "owner_id" varchar(64) PRIMARY KEY,
        "channel" varchar(16) NOT NULL,
        "alipay_user_id" varchar(64),
        "alipay_logon_id" varchar(128),
        "wechat_openid" varchar(128),
        "wechat_app_id" varchar(64),
        "bind_status" varchar(16) NOT NULL DEFAULT 'unbound',
        "verified" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_collector_payout_accounts_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_collector_payout_accounts_channel"
          CHECK ("channel" IN ('alipay', 'wxpay')),
        CONSTRAINT "chk_collector_payout_accounts_bind_status"
          CHECK ("bind_status" IN ('bound', 'unbound'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "yzh_payout_orders" (
        "id" varchar(64) PRIMARY KEY,
        "owner_id" varchar(64) NOT NULL,
        "channel" varchar(16) NOT NULL,
        "pay" numeric(14,2) NOT NULL,
        "yzh_order_id" varchar(64) NOT NULL,
        "yzh_ref" varchar(64),
        "status" varchar(32),
        "status_message" varchar(255),
        "withdraw_platform" varchar(16),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "fk_yzh_payout_orders_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "chk_yzh_payout_orders_channel"
          CHECK ("channel" IN ('alipay', 'wxpay'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_yzh_payout_orders_owner_created"
        ON "yzh_payout_orders" ("owner_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE "yzh_callback_logs" (
        "id" varchar(64) PRIMARY KEY,
        "kind" varchar(16) NOT NULL,
        "notify_id" varchar(64),
        "payload" text,
        "status_code" varchar(32),
        "ok" boolean NOT NULL,
        "error_message" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_yzh_callback_logs_kind"
          CHECK ("kind" IN ('payment', 'sign'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_yzh_callback_logs_created"
        ON "yzh_callback_logs" ("created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "yzh_callback_logs"');
    await queryRunner.query('DROP TABLE IF EXISTS "yzh_payout_orders"');
    await queryRunner.query('DROP TABLE IF EXISTS "collector_payout_accounts"');
  }
}
