import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

export type WorkerKind = "media" | "ai_quality" | "ai_annotation";
export type WorkerHeartbeatStatus = "idle" | "running" | "stopped";

@Entity({ name: "worker_heartbeats" })
@Index("idx_worker_heartbeats_kind_seen", ["kind", "lastSeenAt"])
export class WorkerHeartbeatEntity {
  @PrimaryColumn({ type: "varchar", length: 120 })
  id!: string;

  @Column({ type: "varchar", length: 32 })
  kind!: WorkerKind;

  @Column({ name: "host_name", type: "varchar", length: 160 })
  hostName!: string;

  @Column({ name: "process_id", type: "integer" })
  processId!: number;

  @Column({ type: "varchar", length: 16 })
  status!: WorkerHeartbeatStatus;

  @Column({ name: "current_submission_id", type: "varchar", length: 64, nullable: true })
  currentSubmissionId: string | null = null;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string | null = null;

  @Column({ name: "current_task_started_at", type: "timestamptz", nullable: true })
  currentTaskStartedAt: Date | null = null;

  @Column({ name: "completed_task_count", type: "integer", default: 0 })
  completedTaskCount = 0;

  @Column({ name: "failed_task_count", type: "integer", default: 0 })
  failedTaskCount = 0;

  @Column({ name: "total_task_duration_ms", type: "bigint", default: "0" })
  totalTaskDurationMs = "0";

  @Column({ name: "last_task_duration_ms", type: "integer", nullable: true })
  lastTaskDurationMs: number | null = null;

  @Column({ name: "max_task_duration_ms", type: "integer", default: 0 })
  maxTaskDurationMs = 0;

  @Column({ name: "started_at", type: "timestamptz" })
  startedAt!: Date;

  @Column({ name: "last_seen_at", type: "timestamptz" })
  lastSeenAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
