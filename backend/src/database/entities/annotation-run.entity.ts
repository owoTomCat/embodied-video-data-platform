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

import type { LabelSetSnapshot } from "../../rules/rule-calculator.js";
import type { AnnotationGateIssue } from "../../video-annotation/annotation-auto-gate.js";
import { SubmissionEntity } from "./submission.entity.js";

export type AnnotationExecutionStatus =
  | "queued"
  | "running"
  | "retry_scheduled"
  | "succeeded"
  | "system_failed"
  | "stuck"
  | "cancelled";

export type AnnotationReviewStatus =
  | "pending"
  | "not_required"
  | "accepted_unchanged"
  | "accepted_corrected"
  | "rejected"
  | "unable_to_judge";

export type AnnotationPublicationStatus =
  | "candidate_only"
  | "human_verified"
  | "auto_accepted"
  | "rejected"
  | "superseded";

export type AnnotationAutoEligibility =
  | "not_evaluated"
  | "eligible"
  | "manual_required";

export type AnnotationAuditStatus = "not_selected" | "pending" | "completed";

@Entity({ name: "annotation_runs" })
@Index("idx_annotation_runs_submission_created", ["submissionId", "createdAt"])
@Index("idx_annotation_runs_execution_retry", ["executionStatus", "nextRetryAt"])
@Index("idx_annotation_runs_execution_updated", ["executionStatus", "updatedAt", "id"])
@Index("idx_annotation_runs_review_publication_updated", ["reviewStatus", "publicationStatus", "updatedAt", "id"])
@Index("uq_annotation_runs_current_published", ["submissionId"], {
  unique: true,
  where: `"publication_status" IN ('human_verified', 'auto_accepted')`,
})
@Index("uq_annotation_runs_pending_candidate", ["submissionId"], {
  unique: true,
  where: `"execution_status" = 'succeeded' AND "review_status" = 'pending' AND "publication_status" = 'candidate_only'`,
})
export class AnnotationRunEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "submission_id", type: "varchar", length: 64 })
  submissionId!: string;

  @ManyToOne(() => SubmissionEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "submission_id" })
  submission?: SubmissionEntity;

  @Column({ type: "varchar", length: 24, default: "initial" })
  trigger!: "initial" | "manual";

  @Column({ name: "pipeline_version", type: "varchar", length: 80 })
  pipelineVersion!: string;

  @Column({ name: "schema_version", type: "varchar", length: 80 })
  schemaVersion!: string;

  @Column({ name: "evidence_policy_version", type: "varchar", length: 80 })
  evidencePolicyVersion!: string;

  @Column({ name: "prompt_version", type: "varchar", length: 120, nullable: true })
  promptVersion: string | null = null;

  @Column({ name: "prompt_content_sha256", type: "char", length: 64, nullable: true })
  promptContentSha256: string | null = null;

  @Column({ name: "system_prompt_snapshot", type: "text", nullable: true })
  systemPromptSnapshot: string | null = null;

  @Column({ name: "output_example_snapshot", type: "jsonb", nullable: true })
  outputExampleSnapshot: Record<string, unknown> | null = null;

  @Column({ type: "varchar", length: 120, nullable: true })
  model: string | null = null;

  @Column({ name: "label_set_version_id", type: "varchar", length: 64, nullable: true })
  labelSetVersionId: string | null = null;

  @Column({ name: "label_set_revision", type: "integer", nullable: true })
  labelSetRevision: number | null = null;

  @Column({ name: "label_set_snapshot", type: "jsonb", nullable: true })
  labelSetSnapshot: LabelSetSnapshot | null = null;

  @Column({ name: "execution_status", type: "varchar", length: 24 })
  executionStatus!: AnnotationExecutionStatus;

  @Column({ name: "review_status", type: "varchar", length: 32 })
  reviewStatus!: AnnotationReviewStatus;

  @Column({ name: "publication_status", type: "varchar", length: 24 })
  publicationStatus!: AnnotationPublicationStatus;

  @Column({ name: "attempt_count", type: "integer", default: 0 })
  attemptCount = 0;

  @Column({ name: "full_model_attempts", type: "integer", default: 0 })
  fullModelAttempts = 0;

  @Column({ name: "schema_repair_calls", type: "integer", default: 0 })
  schemaRepairCalls = 0;

  @Column({ name: "targeted_repair_calls", type: "integer", default: 0 })
  targetedRepairCalls = 0;

  @Column({ name: "infrastructure_retry_count", type: "integer", default: 0 })
  infrastructureRetryCount = 0;

  @Column({ name: "provider_call_count", type: "integer", default: 0 })
  providerCallCount = 0;

  @Column({ name: "review_revision", type: "integer", default: 0 })
  reviewRevision = 0;

  @Column({ name: "last_error_code", type: "varchar", length: 80, nullable: true })
  lastErrorCode: string | null = null;

  @Column({ name: "last_error_message", type: "text", nullable: true })
  lastErrorMessage: string | null = null;

  @Column({ name: "next_retry_at", type: "timestamptz", nullable: true })
  nextRetryAt: Date | null = null;

  @Column({ name: "provider_request_id", type: "varchar", length: 200, nullable: true })
  providerRequestId: string | null = null;

  @Column({ name: "response_model", type: "varchar", length: 120, nullable: true })
  responseModel: string | null = null;

  @Column({ name: "raw_result", type: "jsonb", nullable: true })
  rawResult: Record<string, unknown> | null = null;

  @Column({ name: "normalized_result", type: "jsonb", nullable: true })
  normalizedResult: Record<string, unknown> | null = null;

  @Column({ name: "human_result", type: "jsonb", nullable: true })
  humanResult: Record<string, unknown> | null = null;

  @Column({ name: "auto_eligibility", type: "varchar", length: 24, default: "not_evaluated" })
  autoEligibility: AnnotationAutoEligibility = "not_evaluated";

  @Column({ name: "auto_gate_version", type: "varchar", length: 80, nullable: true })
  autoGateVersion: string | null = null;

  @Column({ name: "auto_gate_issues", type: "jsonb", default: () => "'[]'::jsonb" })
  autoGateIssues: AnnotationGateIssue[] = [];

  @Column({ name: "would_auto_accept", type: "boolean", default: false })
  wouldAutoAccept = false;

  @Column({ name: "auto_accept_enabled_snapshot", type: "boolean", default: false })
  autoAcceptEnabledSnapshot = false;

  @Column({ name: "auto_gate_evaluated_at", type: "timestamptz", nullable: true })
  autoGateEvaluatedAt: Date | null = null;

  @Column({ name: "audit_status", type: "varchar", length: 24, default: "not_selected" })
  auditStatus: AnnotationAuditStatus = "not_selected";

  @Column({ name: "audit_selected_at", type: "timestamptz", nullable: true })
  auditSelectedAt: Date | null = null;

  @Column({ name: "input_tokens", type: "integer", nullable: true })
  inputTokens: number | null = null;

  @Column({ name: "output_tokens", type: "integer", nullable: true })
  outputTokens: number | null = null;

  @Column({ name: "total_tokens", type: "integer", nullable: true })
  totalTokens: number | null = null;

  @Column({ name: "latency_ms", type: "integer", nullable: true })
  latencyMs: number | null = null;

  @Column({ name: "frame_count", type: "integer", nullable: true })
  frameCount: number | null = null;

  @Column({ name: "source_timestamps_ms", type: "jsonb", default: () => "'[]'::jsonb" })
  sourceTimestampsMs: number[] = [];

  @Column({ name: "queued_at", type: "timestamptz" })
  queuedAt!: Date;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt: Date | null = null;

  @Column({ name: "completed_at", type: "timestamptz", nullable: true })
  completedAt: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
