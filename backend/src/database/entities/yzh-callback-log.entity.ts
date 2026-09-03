import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

export type YzhCallbackKind = "payment" | "sign";

/** 云账户异步回调流水（原始解密后的通知 + 处理结果）。 */
@Entity({ name: "yzh_callback_logs" })
@Index("idx_yzh_callback_logs_created", ["createdAt"])
export class YzhCallbackLogEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  /** payment=单笔支付结果回调 / sign=签约结果回调 */
  @Column({ type: "varchar", length: 16 })
  kind!: YzhCallbackKind;

  @Column({ name: "notify_id", type: "varchar", length: 64, nullable: true })
  notifyId: string | null = null;

  /** 解密后的回调 JSON（明文） */
  @Column({ type: "text", nullable: true })
  payload: string | null = null;

  /** 通知中的订单状态码（payment 回调） */
  @Column({ name: "status_code", type: "varchar", length: 32, nullable: true })
  statusCode: string | null = null;

  /** 是否成功验签/解密并返回 success */
  @Column({ type: "boolean" })
  ok!: boolean;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
