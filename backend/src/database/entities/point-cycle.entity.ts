import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  type Relation,
} from "typeorm";

import { UserEntity } from "./user.entity.js";
import { PointCycleItemEntity } from "./point-cycle-item.entity.js";
import { PointRuleVersionEntity } from "./point-rule-version.entity.js";
import type { PointRuleSnapshot } from "../../rules/rule-calculator.js";

/** 周期状态：locked = 锁定中/结算中（锁定后 3 天自动结算）；settled = 已结算入钱包 */
export type PointCycleStatus = "locked" | "settled";

@Entity({ name: "point_cycles" })
@Index("idx_point_cycles_business_date", ["businessDate"])
@Index("idx_point_cycles_created_at", ["createdAt"])
export class PointCycleEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "business_date", type: "date" })
  businessDate!: string;

  @Column({ type: "varchar", length: 16, default: "locked" })
  status: PointCycleStatus = "locked";

  @Column({ name: "submission_count", type: "integer" })
  submissionCount!: number;

  @Column({ name: "effective_duration_ms", type: "bigint" })
  effectiveDurationMs!: string;

  @Column({
    name: "total_points",
    type: "numeric",
    precision: 18,
    scale: 2,
  })
  totalPoints!: string;

  @Column({ name: "point_rule_version_id", type: "varchar", length: 64, nullable: true })
  pointRuleVersionId: string | null = null;

  @ManyToOne(() => PointRuleVersionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "point_rule_version_id" })
  pointRule?: Relation<PointRuleVersionEntity>;

  @Column({ name: "point_rule_revision", type: "integer", nullable: true })
  pointRuleRevision: number | null = null;

  @Column({ name: "point_rule_snapshot", type: "jsonb", nullable: true })
  pointRuleSnapshot: PointRuleSnapshot | null = null;

  @Column({ name: "created_by_account_id", type: "varchar", length: 64 })
  createdByAccountId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_account_id" })
  createdBy?: Relation<UserEntity>;

  @Column({ name: "created_by_name", type: "varchar", length: 120 })
  createdByName!: string;

  /** 自动结算时间（锁定时刻 + 3 天）；到达后由定时任务结算入钱包 */
  @Column({ name: "settle_due_at", type: "timestamptz", nullable: true })
  settleDueAt: Date | null = null;

  @Column({ name: "settled_at", type: "timestamptz", nullable: true })
  settledAt: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @OneToMany(() => PointCycleItemEntity, (item) => item.cycle)
  items?: Relation<PointCycleItemEntity[]>;
}
