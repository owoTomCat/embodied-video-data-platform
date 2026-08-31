import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { AnnotationReviewEntity } from "./annotation-review.entity.js";
import { AnnotationRunEntity } from "./annotation-run.entity.js";

export type AnnotationCorrectionTarget =
  | "scene"
  | "task_segment"
  | "atomic_action"
  | "object"
  | "tool"
  | "interaction"
  | "completion"
  | "outcome"
  | "failure_recovery"
  | "evidence"
  | "annotation";

@Entity({ name: "annotation_corrections" })
@Index("idx_annotation_corrections_run_created", ["annotationRunId", "createdAt"])
export class AnnotationCorrectionEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "annotation_run_id", type: "varchar", length: 64 })
  annotationRunId!: string;

  @ManyToOne(() => AnnotationRunEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "annotation_run_id" })
  annotationRun?: AnnotationRunEntity;

  @Column({ name: "review_id", type: "varchar", length: 64 })
  reviewId!: string;

  @ManyToOne(() => AnnotationReviewEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "review_id" })
  review?: AnnotationReviewEntity;

  @Column({ name: "target_type", type: "varchar", length: 40 })
  targetType!: AnnotationCorrectionTarget;

  @Column({ name: "target_id", type: "varchar", length: 120 })
  targetId!: string;

  @Column({ name: "field_path", type: "varchar", length: 300 })
  fieldPath!: string;

  @Column({ name: "previous_value", type: "jsonb", nullable: true })
  previousValue: unknown = null;

  @Column({ name: "next_value", type: "jsonb", nullable: true })
  nextValue: unknown = null;

  @Column({ name: "reason_code", type: "varchar", length: 80 })
  reasonCode!: string;

  @Column({ type: "text", nullable: true })
  comment: string | null = null;

  @Column({ name: "reviewer_account_id", type: "varchar", length: 64 })
  reviewerAccountId!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
