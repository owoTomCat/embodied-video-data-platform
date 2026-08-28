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

export type CollectionTaskStatus = "draft" | "published" | "paused" | "closed";
export type TaskNormalizationStatus = "pending" | "ready" | "failed";
export type CollectionTaskType = "generic" | "preset" | "custom";

export type NormalizedRequirementItem = {
  type: "hard" | "soft";
  content: string;
  rationale?: string;
};

/** AI 规范化后的任务要求（管理员确认后保存，提交时复制为快照） */
export type NormalizedTaskRequirements = {
  scene_description: string;
  requirements: NormalizedRequirementItem[];
  quality_notes: string[];
};

@Entity({ name: "collection_tasks" })
@Index("idx_collection_tasks_status", ["status"])
@Index("idx_collection_tasks_scene_name", ["sceneName"])
@Index("idx_collection_tasks_created_by", ["createdByAccountId"])
export class CollectionTaskEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "varchar", length: 120 })
  title!: string;

  /** 任务说明 / 采集指引（数采端任务卡片与详情展示） */
  @Column({ type: "text" })
  description!: string;

  /** 场景名称（管理员填写，带标签字典补全引导；全新场景发布时自动入字典） */
  @Column({ name: "scene_name", type: "varchar", length: 120 })
  sceneName!: string;

  /** 关联标签字典中的场景标签 id；全新场景在发布时自动创建并回填 */
  @Column({ name: "scene_label_id", type: "varchar", length: 64, nullable: true })
  sceneLabelId: string | null = null;

  /**
   * 任务类型：generic = 通用任务（不绑定场景）；preset = 预设场景任务；
   * custom = 自定义场景任务。通用任务在任务大厅与创建页中作为最显眼的入口。
   */
  @Column({ name: "task_type", type: "varchar", length: 24, default: "custom" })
  taskType: CollectionTaskType = "custom";

  /** 管理员自由填写的要求原文 */
  @Column({ name: "raw_requirements", type: "text" })
  rawRequirements!: string;

  /** AI 规范化后的结构化要求（管理员确认后保存） */
  @Column({ name: "normalized_requirements", type: "jsonb", nullable: true })
  normalizedRequirements: NormalizedTaskRequirements | null = null;

  @Column({
    name: "normalization_status",
    type: "varchar",
    length: 24,
    default: "pending",
  })
  normalizationStatus: TaskNormalizationStatus = "pending";

  /** 任务单价（元/小时）；空则回退全局默认单价规则 */
  @Column({
    name: "price_points_per_minute",
    type: "numeric",
    precision: 10,
    scale: 2,
    nullable: true,
  })
  pricePointsPerMinute: string | null = null;

  @Column({ type: "varchar", length: 16, default: "draft" })
  status: CollectionTaskStatus = "draft";

  /** 任务版本号；每次「编辑并发布」递增 */
  @Column({ type: "integer", default: 1 })
  revision = 1;

  @Column({ name: "created_by_account_id", type: "varchar", length: 64 })
  createdByAccountId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_account_id" })
  createdBy?: UserEntity;

  @Column({ name: "created_by_name", type: "varchar", length: 120 })
  createdByName!: string;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt: Date | null = null;

  @Column({ name: "paused_at", type: "timestamptz", nullable: true })
  pausedAt: Date | null = null;

  @Column({ name: "closed_at", type: "timestamptz", nullable: true })
  closedAt: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
