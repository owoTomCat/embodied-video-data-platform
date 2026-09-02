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

export type PayoutOrderChannel = "alipay" | "wxpay";

/** 向云账户发起实时打款后记录的订单本地快照。 */
@Entity({ name: "yzh_payout_orders" })
@Index("idx_yzh_payout_orders_owner_created", ["ownerId", "createdAt"])
export class YzhPayoutOrderEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "owner_id", type: "varchar", length: 64 })
  ownerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "owner_id" })
  owner?: UserEntity;

  /** 收款渠道：alipay / wxpay */
  @Column({ type: "varchar", length: 16 })
  channel!: PayoutOrderChannel;

  /** 打款金额（元） */
  @Column({ type: "numeric", precision: 14, scale: 2 })
  pay!: string;

  /** 传给云账户的平台企业订单号（唯一，用于幂等） */
  @Column({ name: "yzh_order_id", type: "varchar", length: 64 })
  yzhOrderId!: string;

  /** 云账户综合服务平台流水号 */
  @Column({ name: "yzh_ref", type: "varchar", length: 64, nullable: true })
  yzhRef: string | null = null;

  /** 订单状态码：1 已支付 / 2 失败 / 4 挂单 / 9 退汇 / 15 取消 / -1 已无效 */
  @Column({ type: "varchar", length: 32, nullable: true })
  status: string | null = null;

  @Column({ name: "status_message", type: "varchar", length: 255, nullable: true })
  statusMessage: string | null = null;

  @Column({ name: "withdraw_platform", type: "varchar", length: 16, nullable: true })
  withdrawPlatform: string | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
