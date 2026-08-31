import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import {
  AnnotationRunEntity,
  type AnnotationReviewStatus,
} from "./annotation-run.entity.js";

@Entity({ name: "annotation_reviews" })
@Index("uq_annotation_reviews_run_revision", ["annotationRunId", "revision"], {
  unique: true,
})
export class AnnotationReviewEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "annotation_run_id", type: "varchar", length: 64 })
  annotationRunId!: string;

  @ManyToOne(() => AnnotationRunEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "annotation_run_id" })
  annotationRun?: AnnotationRunEntity;

  @Column({ type: "integer" })
  revision!: number;

  @Column({ type: "varchar", length: 32 })
  disposition!: Exclude<AnnotationReviewStatus, "pending" | "not_required">;

  @Column({ name: "review_kind", type: "varchar", length: 16, default: "blocking" })
  reviewKind: "blocking" | "audit" = "blocking";

  @Column({ name: "reviewed_fields", type: "jsonb", default: () => "'[]'::jsonb" })
  reviewedFields: string[] = [];

  @Column({ name: "reason_codes", type: "jsonb", default: () => "'[]'::jsonb" })
  reasonCodes: string[] = [];

  @Column({ name: "review_duration_ms", type: "integer" })
  reviewDurationMs!: number;

  @Column({ type: "text" })
  reason!: string;

  @Column({ name: "reviewer_account_id", type: "varchar", length: 64 })
  reviewerAccountId!: string;

  @Column({ name: "reviewer_name", type: "varchar", length: 120 })
  reviewerName!: string;

  @Column({ name: "corrected_result", type: "jsonb", nullable: true })
  correctedResult: Record<string, unknown> | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
