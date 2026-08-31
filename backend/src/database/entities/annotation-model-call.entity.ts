import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { AnnotationRunEntity } from "./annotation-run.entity.js";

export type AnnotationModelCallKind =
  | "full"
  | "schema_repair"
  | "targeted_repair";
export type AnnotationModelCallStatus = "succeeded" | "failed";

@Entity({ name: "annotation_model_calls" })
@Index("idx_annotation_model_calls_run_created", ["annotationRunId", "createdAt", "id"])
export class AnnotationModelCallEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "annotation_run_id", type: "varchar", length: 64 })
  annotationRunId!: string;

  @ManyToOne(() => AnnotationRunEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "annotation_run_id" })
  annotationRun?: AnnotationRunEntity;

  @Column({ name: "logical_full_attempt", type: "integer" })
  logicalFullAttempt!: number;

  @Column({ name: "call_kind", type: "varchar", length: 24 })
  callKind!: AnnotationModelCallKind;

  @Column({ name: "call_status", type: "varchar", length: 16 })
  callStatus!: AnnotationModelCallStatus;

  @Column({ name: "http_status", type: "integer", nullable: true })
  httpStatus: number | null = null;

  @Column({ name: "provider_request_id", type: "varchar", length: 200, nullable: true })
  providerRequestId: string | null = null;

  @Column({ name: "response_model", type: "varchar", length: 120, nullable: true })
  responseModel: string | null = null;

  @Column({ name: "input_tokens", type: "integer", nullable: true })
  inputTokens: number | null = null;

  @Column({ name: "output_tokens", type: "integer", nullable: true })
  outputTokens: number | null = null;

  @Column({ name: "total_tokens", type: "integer", nullable: true })
  totalTokens: number | null = null;

  @Column({ name: "latency_ms", type: "integer" })
  latencyMs!: number;

  @Column({ name: "error_code", type: "varchar", length: 80, nullable: true })
  errorCode: string | null = null;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
