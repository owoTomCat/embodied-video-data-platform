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

import { CollectionTaskEntity } from "./collection-task.entity.js";
import { SubmissionEntity } from "./submission.entity.js";
import { UserEntity } from "./user.entity.js";

/** 指导任务卡状态：ai_generated=AI生成未编辑可直接采集；in_review=数采编辑后待人工审核；approved/rejected=审核结果 */
export type GuideTaskStatus =
  | "ai_generated"
  | "in_review"
  | "approved"
  | "rejected";

/** 环境照片引用：object_key 指向 MinIO 存储的对象；dataUrl 供缩略图展示（可选） */
export type GuidePhotoRef = {
  objectKey: string;
  contentType?: string;
  name?: string;
  sizeBytes?: number;
};

/** 识别到的环境物体清单 */
export type GuideEnvObject = {
  name: string;
  category?: string;
  confidence?: number;
};

/** 结构化任务卡：目标物体 / 操作步骤 / 结束条件 / 成功·失败判定 */
export type GuideTaskCard = {
  target_objects: Array<{ name: string; action?: string }>;
  steps: string[];
  end_condition: string;
  success_criteria: string[];
  fail_criteria: string[];
};

@Entity({ name: "guide_tasks" })
@Index("idx_guide_tasks_task_owner", ["sceneTypeTaskId", "ownerAccountId"])
@Index("idx_guide_tasks_status_updated", ["status", "updatedAt", "id"])
export class GuideTaskEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  /** 关联的场景型任务（taskType = scene_type） */
  @Column({ name: "scene_type_task_id", type: "varchar", length: 64 })
  sceneTypeTaskId!: string;

  @ManyToOne(() => CollectionTaskEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "scene_type_task_id" })
  sceneTypeTask?: CollectionTaskEntity;

  /** 数采人员（指导任务卡所有者） */
  @Column({ name: "owner_account_id", type: "varchar", length: 64 })
  ownerAccountId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "owner_account_id" })
  owner?: UserEntity;

  /** 环境照片引用列表（MinIO 对象） */
  @Column({ name: "photo_refs", type: "jsonb", default: () => "'[]'::jsonb" })
  photoRefs: GuidePhotoRef[] = [];

  /** 视觉识别到的环境物体清单 */
  @Column({ name: "env_objects", type: "jsonb", default: () => "'[]'::jsonb" })
  envObjects: GuideEnvObject[] = [];

  /** AI 生成 / 数采编辑后的结构化任务卡 */
  @Column({ name: "task_card", type: "jsonb", nullable: true })
  taskCard: GuideTaskCard | null = null;

  /** 生成任务卡时用的模型名 / 提示词版本（快照） */
  @Column({ name: "vision_model", type: "varchar", length: 120, nullable: true })
  visionModel: string | null = null;

  @Column({ name: "card_prompt_version", type: "varchar", length: 120, nullable: true })
  cardPromptVersion: string | null = null;

  @Column({ name: "status", type: "varchar", length: 24 })
  status!: GuideTaskStatus;

  /** 数采是否编辑过任务卡（编辑过 → 需人工审核） */
  @Column({ name: "edited_at", type: "timestamptz", nullable: true })
  editedAt: Date | null = null;

  /** 采集完成后回填，追溯 AI 指导链路 */
  @Column({ name: "submission_id", type: "varchar", length: 64, nullable: true })
  submissionId: string | null = null;

  @ManyToOne(() => SubmissionEntity, { onDelete: "SET NULL" })
  @JoinColumn({ name: "submission_id" })
  submission?: SubmissionEntity | null;

  @Column({ name: "last_error_code", type: "varchar", length: 80, nullable: true })
  lastErrorCode: string | null = null;

  @Column({ name: "last_error_message", type: "text", nullable: true })
  lastErrorMessage: string | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
