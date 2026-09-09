import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { PointCycleItemEntity } from "./point-cycle-item.entity.js";
import { SubmissionEntity } from "./submission.entity.js";
import { UserEntity } from "./user.entity.js";

@Entity({ name: "point_cycle_adjustments" })
@Index("idx_point_cycle_adjustments_item", ["pointCycleItemId"])
@Index("idx_point_cycle_adjustments_submission", ["submissionId"])
@Index("idx_point_cycle_adjustments_created_at", ["createdAt"])
export class PointCycleAdjustmentEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  /** Insertion order, independent of transaction-start timestamps and random IDs. */
  @Column({ name: "sequence", type: "bigint", generated: "increment" })
  sequence!: string;

  @Column({ name: "point_cycle_item_id", type: "varchar", length: 64 })
  pointCycleItemId!: string;

  @ManyToOne(() => PointCycleItemEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "point_cycle_item_id" })
  pointCycleItem?: PointCycleItemEntity;

  @Column({ name: "submission_id", type: "varchar", length: 64 })
  submissionId!: string;

  @ManyToOne(() => SubmissionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "submission_id" })
  submission?: SubmissionEntity;

  @Column({ name: "previous_final_score", type: "numeric", precision: 6, scale: 1 })
  previousFinalScore!: string;

  @Column({ name: "next_final_score", type: "numeric", precision: 6, scale: 1 })
  nextFinalScore!: string;

  @Column({ name: "previous_settlement_ratio", type: "numeric", precision: 6, scale: 4 })
  previousSettlementRatio!: string;

  @Column({ name: "next_settlement_ratio", type: "numeric", precision: 6, scale: 4 })
  nextSettlementRatio!: string;

  @Column({ name: "previous_invalid_duration_ms", type: "bigint" })
  previousInvalidDurationMs!: string;

  @Column({ name: "next_invalid_duration_ms", type: "bigint" })
  nextInvalidDurationMs!: string;

  @Column({ name: "previous_effective_duration_ms", type: "bigint" })
  previousEffectiveDurationMs!: string;

  @Column({ name: "next_effective_duration_ms", type: "bigint" })
  nextEffectiveDurationMs!: string;

  @Column({ name: "previous_points", type: "numeric", precision: 18, scale: 2 })
  previousPoints!: string;

  @Column({ name: "next_points", type: "numeric", precision: 18, scale: 2 })
  nextPoints!: string;

  @Column({ name: "points_delta", type: "numeric", precision: 18, scale: 2 })
  pointsDelta!: string;

  @Column({ name: "reason", type: "text" })
  reason!: string;

  @Column({ name: "created_by_account_id", type: "varchar", length: 64, nullable: true })
  createdByAccountId: string | null = null;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_account_id" })
  createdBy?: UserEntity;

  @Column({ name: "created_by_name", type: "varchar", length: 120 })
  createdByName!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
