import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

import { UserEntity } from "./user.entity.js";

export type PayoutAccountChannel = "alipay" | "wxpay";
export type PayoutAccountBindStatus = "bound" | "unbound";

/**
 * 数采人员收款档案（绑定的支付宝/微信收钱账号）。
 *
 * 由微信/支付宝开放平台授权登录后写入对应标识符：
 * - 支付宝：user_id(2088…) 或 logon_id（邮箱/手机号）
 * - 微信：openid（平台企业某微信 AppID 下）
 */
@Entity({ name: "collector_payout_accounts" })
export class CollectorPayoutAccountEntity {
  @PrimaryColumn({ name: "owner_id", type: "varchar", length: 64 })
  ownerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "owner_id" })
  owner?: UserEntity;

  /** 收款渠道：alipay / wxpay */
  @Column({ type: "varchar", length: 16 })
  channel!: PayoutAccountChannel;

  @Column({ name: "alipay_user_id", type: "varchar", length: 64, nullable: true })
  alipayUserId: string | null = null;

  @Column({ name: "alipay_logon_id", type: "varchar", length: 128, nullable: true })
  alipayLogonId: string | null = null;

  @Column({ name: "wechat_openid", type: "varchar", length: 128, nullable: true })
  wechatOpenid: string | null = null;

  @Column({ name: "wechat_app_id", type: "varchar", length: 64, nullable: true })
  wechatAppId: string | null = null;

  @Column({ name: "bind_status", type: "varchar", length: 16, default: "unbound" })
  bindStatus!: PayoutAccountBindStatus;

  /** 是否已通过要素/授权校验 */
  @Column({ type: "boolean", default: false })
  verified!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
