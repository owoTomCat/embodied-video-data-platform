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

import { TeamEntity } from "./team.entity.js";
import { UserEntity } from "./user.entity.js";

export type UploadStatus =
  | "created"
  | "uploading"
  | "completing"
  | "uploaded"
  | "aborted";

export type SubmissionProcessingStatus =
  | "uploading"
  | "queued"
  | "probing"
  | "awaiting_ai"
  | "ai_processing"
  | "completed"
  | "stuck"
  | "system_failed";

export type SubmissionAssetStatus = "active" | "quarantined";
export type SubmissionStorageStatus = "available" | "delete_pending" | "deleted";
export type SubmissionStorageDeleteMode = "objects" | "submission";

@Entity({ name: "submissions" })
@Index("idx_submissions_owner_created", ["ownerId", "createdAt"])
@Index("idx_submissions_team_created", ["teamId", "createdAt"])
@Index("idx_submissions_processing_status", ["processingStatus"])
@Index("idx_submissions_asset_status", ["assetStatus"])
@Index("idx_submissions_storage_status", ["storageStatus"])
export class SubmissionEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "owner_id", type: "varchar", length: 64 })
  ownerId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "owner_id" })
  owner?: UserEntity;

  @Column({ name: "team_id", type: "varchar", length: 64 })
  teamId!: string;

  @ManyToOne(() => TeamEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "team_id" })
  team?: TeamEntity;

  @Column({ name: "original_file_name", type: "varchar", length: 255 })
  originalFileName!: string;

  @Column({ name: "content_type", type: "varchar", length: 64 })
  contentType!: string;

  @Column({ name: "expected_size_bytes", type: "bigint" })
  expectedSizeBytes!: string;

  @Column({ name: "checksum_sha256", type: "char", length: 64 })
  checksumSha256!: string;

  @Index("idx_submissions_object_key", { unique: true })
  @Column({ name: "object_key", type: "text" })
  objectKey!: string;

  @Column({ name: "multipart_upload_id", type: "text", nullable: true })
  multipartUploadId: string | null = null;

  @Column({ name: "multipart_completion_parts", type: "jsonb", nullable: true })
  multipartCompletionParts: Array<{ partNumber: number; etag: string }> | null = null;

  @Column({ name: "upload_status", type: "varchar", length: 16 })
  uploadStatus!: UploadStatus;

  @Column({ name: "processing_status", type: "varchar", length: 24 })
  processingStatus!: SubmissionProcessingStatus;

  @Column({ name: "failure_code", type: "varchar", length: 64, nullable: true })
  failureCode: string | null = null;

  @Column({ name: "failure_message", type: "text", nullable: true })
  failureMessage: string | null = null;

  @Column({ name: "is_test_data", type: "boolean", default: false })
  isTestData = false;

  /** 所属采集任务；历史提交为 null（无任务模式） */
  @Index("idx_submissions_task_id")
  @Column({ name: "task_id", type: "varchar", length: 64, nullable: true })
  taskId: string | null = null;

  /** 提交时锁定的任务版本号（后续任务修改不影响已提交数据） */
  @Column({ name: "task_revision", type: "integer", nullable: true })
  taskRevision: number | null = null;

  /** 快照：任务场景名 */
  @Column({ name: "task_scene_name", type: "varchar", length: 120, nullable: true })
  taskSceneName: string | null = null;

  /** 快照：AI 规范化后的任务要求（AI 质检使用） */
  @Column({ name: "task_requirements_snapshot", type: "jsonb", nullable: true })
  taskRequirementsSnapshot: unknown | null = null;

  /** 快照：任务单价（元/小时，结算使用）；空则回退全局默认 */
  @Column({
    name: "task_price_points_per_minute",
    type: "numeric",
    precision: 10,
    scale: 2,
    nullable: true,
  })
  taskPricePointsPerMinute: string | null = null;

  @Column({ name: "asset_status", type: "varchar", length: 24, default: "active" })
  assetStatus: SubmissionAssetStatus = "active";

  @Column({ name: "quarantine_reason", type: "text", nullable: true })
  quarantineReason: string | null = null;

  @Column({ name: "quarantined_at", type: "timestamptz", nullable: true })
  quarantinedAt: Date | null = null;

  @Column({ name: "quarantined_by_account_id", type: "varchar", length: 64, nullable: true })
  quarantinedByAccountId: string | null = null;

  @Column({ name: "quarantined_by_name", type: "varchar", length: 120, nullable: true })
  quarantinedByName: string | null = null;

  @Column({ name: "storage_status", type: "varchar", length: 24, default: "available" })
  storageStatus: SubmissionStorageStatus = "available";

  @Column({ name: "storage_retain_until", type: "timestamptz", nullable: true })
  storageRetainUntil: Date | null = null;

  @Column({ name: "storage_deleted_at", type: "timestamptz", nullable: true })
  storageDeletedAt: Date | null = null;

  @Column({ name: "storage_deleted_by_account_id", type: "varchar", length: 64, nullable: true })
  storageDeletedByAccountId: string | null = null;

  @Column({ name: "storage_deleted_by_name", type: "varchar", length: 120, nullable: true })
  storageDeletedByName: string | null = null;

  @Column({ name: "storage_delete_reason", type: "text", nullable: true })
  storageDeleteReason: string | null = null;

  @Column({ name: "storage_delete_mode", type: "varchar", length: 24, nullable: true })
  storageDeleteMode: SubmissionStorageDeleteMode | null = null;

  @Column({ name: "storage_delete_object_keys", type: "jsonb", default: () => "'[]'::jsonb" })
  storageDeleteObjectKeys: string[] = [];

  @Column({ name: "storage_delete_force", type: "boolean", default: false })
  storageDeleteForce = false;

  @Column({ name: "data_usage_authorized", type: "boolean", default: false })
  dataUsageAuthorized = false;

  @Column({ name: "privacy_confirmed", type: "boolean", default: false })
  privacyConfirmed = false;

  @Column({ name: "sensitive_content_confirmed", type: "boolean", default: false })
  sensitiveContentConfirmed = false;

  @Column({
    name: "upload_policy_version",
    type: "varchar",
    length: 64,
    default: "DATA-AUTH-2026-08",
  })
  uploadPolicyVersion = "DATA-AUTH-2026-08";

  @Column({ name: "authorization_confirmed_at", type: "timestamptz", nullable: true })
  authorizationConfirmedAt: Date | null = null;

  @Column({ name: "uploaded_at", type: "timestamptz", nullable: true })
  uploadedAt: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
