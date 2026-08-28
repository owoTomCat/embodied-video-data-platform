import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from "typeorm";

import { PointCycleEntity } from "./point-cycle.entity.js";
import { SubmissionEntity } from "./submission.entity.js";
import { TeamEntity } from "./team.entity.js";
import { UserEntity } from "./user.entity.js";

@Entity({ name: "point_cycle_items" })
@Index("idx_point_cycle_items_cycle", ["cycleId"])
@Index("idx_point_cycle_items_owner", ["ownerId"])
@Index("idx_point_cycle_items_team", ["teamId"])
export class PointCycleItemEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "cycle_id", type: "varchar", length: 64 })
  cycleId!: string;

  @ManyToOne(() => PointCycleEntity, (cycle) => cycle.items, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "cycle_id" })
  cycle?: Relation<PointCycleEntity>;

  @Column({ name: "submission_id", type: "varchar", length: 64 })
  submissionId!: string;

  @ManyToOne(() => SubmissionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "submission_id" })
  submission?: Relation<SubmissionEntity>;

  @Column({ name: "owner_id", type: "varchar", length: 64 })
  ownerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "owner_id" })
  owner?: Relation<UserEntity>;

  @Column({ name: "owner_name", type: "varchar", length: 120 })
  ownerName!: string;

  @Column({ name: "team_id", type: "varchar", length: 64 })
  teamId!: string;

  @ManyToOne(() => TeamEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "team_id" })
  team?: Relation<TeamEntity>;

  @Column({ name: "team_name", type: "varchar", length: 120 })
  teamName!: string;

  @Column({ name: "file_name", type: "varchar", length: 255 })
  fileName!: string;

  /** 快照：所属任务 id（无任务历史提交为 null） */
  @Column({ name: "task_id", type: "varchar", length: 64, nullable: true })
  taskId: string | null = null;

  /** 快照：任务标题 */
  @Column({ name: "task_name", type: "varchar", length: 120, nullable: true })
  taskName: string | null = null;

  /** 快照：任务场景名 */
  @Column({ name: "task_scene_name", type: "varchar", length: 120, nullable: true })
  taskSceneName: string | null = null;

  /** 快照：任务单价（元/小时）；空表示按全局默认单价规则 */
  @Column({
    name: "price_points_per_minute",
    type: "numeric",
    precision: 10,
    scale: 2,
    nullable: true,
  })
  taskPricePointsPerMinute: string | null = null;

  @Column({ name: "final_score", type: "numeric", precision: 6, scale: 1 })
  finalScore!: string;

  @Column({
    name: "settlement_ratio",
    type: "numeric",
    precision: 6,
    scale: 4,
  })
  settlementRatio!: string;

  @Column({ name: "effective_duration_ms", type: "bigint" })
  effectiveDurationMs!: string;

  @Column({
    name: "points_per_minute",
    type: "numeric",
    precision: 12,
    scale: 4,
  })
  pointsPerMinute!: string;

  @Column({ type: "numeric", precision: 18, scale: 2 })
  points!: string;

  @Column({ name: "quality_revision", type: "integer" })
  qualityRevision!: number;

  @Column({ name: "quality_reviewed_at", type: "timestamptz", nullable: true })
  qualityReviewedAt: Date | null = null;
}
