import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

import { UserEntity } from "./user.entity.js";

/**
 * 数采人员钱包余额。
 * 总余额 = 结算中 + 可提现 + 已提现；
 * 结算中 = 已锁定尚未结算（3 天）的任务金额；可提现 = 已结算金额；
 * 已提现 + 累计提现 记录提现历史。
 */
@Entity({ name: "wallet_balances" })
export class WalletBalanceEntity {
  @PrimaryColumn({ name: "owner_id", type: "varchar", length: 64 })
  ownerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "owner_id" })
  owner?: UserEntity;

  @Column({ name: "total_balance", type: "numeric", precision: 14, scale: 2, default: 0 })
  totalBalance!: string;

  @Column({ name: "settling_balance", type: "numeric", precision: 14, scale: 2, default: 0 })
  settlingBalance!: string;

  @Column({ name: "available_balance", type: "numeric", precision: 14, scale: 2, default: 0 })
  availableBalance!: string;

  @Column({ name: "withdrawn_balance", type: "numeric", precision: 14, scale: 2, default: 0 })
  withdrawnBalance!: string;

  @Column({ name: "cumulative_withdrawn", type: "numeric", precision: 14, scale: 2, default: 0 })
  cumulativeWithdrawn!: string;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}

export type WalletTransactionType = "lock" | "settle" | "withdraw";

@Entity({ name: "wallet_transactions" })
@Index("idx_wallet_transactions_owner_created", ["ownerId", "createdAt"])
export class WalletTransactionEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "owner_id", type: "varchar", length: 64 })
  ownerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "owner_id" })
  owner?: UserEntity;

  /** lock=锁定入结算中（+） / settle=结算转可提现（+） / withdraw=提现（-） */
  @Column({ type: "varchar", length: 24 })
  type!: WalletTransactionType;

  /** 带符号金额：lock/settle 为正，withdraw 为负 */
  @Column({ type: "numeric", precision: 14, scale: 2 })
  amount!: string;

  /** 操作后的总余额快照 */
  @Column({ name: "balance_after", type: "numeric", precision: 14, scale: 2 })
  balanceAfter!: string;

  @Column({ name: "cycle_id", type: "varchar", length: 64, nullable: true })
  cycleId: string | null = null;

  @Column({ name: "submission_id", type: "varchar", length: 64, nullable: true })
  submissionId: string | null = null;

  @Column({ type: "text", nullable: true })
  remark: string | null = null;

  @Column({ name: "created_by_account_id", type: "varchar", length: 64, nullable: true })
  createdByAccountId: string | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
