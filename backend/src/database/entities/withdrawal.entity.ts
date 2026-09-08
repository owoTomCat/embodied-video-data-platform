import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type WithdrawalStatus = "pending" | "processing" | "review_pending" | "investigating" | "paid" | "rejected" | "failed";
export type ReviewMode = "independent" | "single" | "legacy" | "manual";

@Entity({ name: "withdrawal_batches" })
export class WithdrawalBatchEntity {
  @PrimaryColumn({ type: "varchar", length: 64 }) id!: string;
  @Column({ name: "created_by", type: "varchar", length: 64 }) createdBy!: string;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}

@Entity({ name: "withdrawal_requests" })
@Index("uq_withdrawal_owner_key", ["ownerId", "idempotencyKey"], { unique: true })
@Index("idx_withdrawal_status_created", ["status", "createdAt"])
export class WithdrawalRequestEntity {
  @PrimaryColumn({ type: "varchar", length: 64 }) id!: string;
  @Column({ name: "owner_id", type: "varchar", length: 64 }) ownerId!: string;
  @Column({ name: "idempotency_key", type: "varchar", length: 64 }) idempotencyKey!: string;
  @Column({ name: "payload_hash", type: "varchar", length: 64 }) payloadHash!: string;
  @Column({ type: "numeric", precision: 14, scale: 2 }) amount!: string;
  @Column({ type: "varchar", length: 16 }) status!: WithdrawalStatus;
  @Column({ type: "varchar", length: 16 }) method!: "alipay" | "bank";
  @Column({ name: "recipient_encrypted", type: "text", select: false }) recipientEncrypted!: string;
  @Column({ name: "account_masked", type: "varchar", length: 16 }) accountMasked!: string;
  @Column({ name: "name_masked", type: "varchar", length: 16 }) nameMasked!: string;
  @Column({ name: "batch_id", type: "varchar", length: 64, nullable: true }) batchId: string | null = null;
  @Column({ type: "varchar", length: 500, nullable: true }) reason: string | null = null;
  @Column({ name: "transfer_reference", type: "varchar", length: 120, nullable: true }) transferReference: string | null = null;
  @Column({ name: "paid_at", type: "timestamptz", nullable: true }) paidAt: Date | null = null;
  @Column({ name: "assignee_id", type: "varchar", length: 64, nullable: true }) assigneeId: string | null = null;
  @Column({ name: "assigned_at", type: "timestamptz", nullable: true }) assignedAt: Date | null = null;
  @Column({ type: "integer", default: 0 }) revision = 0;
  @Column({ name: "registered_by_id", type: "varchar", length: 64, nullable: true }) registeredById: string | null = null;
  @Column({ name: "reviewed_by_id", type: "varchar", length: 64, nullable: true }) reviewedById: string | null = null;
  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true }) reviewedAt: Date | null = null;
  @Column({ name: "review_mode", type: "varchar", length: 16, nullable: true }) reviewMode: ReviewMode | null = null;
  @Column({ name: "latest_registration_id", type: "varchar", length: 64, nullable: true }) latestRegistrationId: string | null = null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity({ name: "withdrawal_registrations" })
export class WithdrawalRegistrationEntity {
  @PrimaryColumn({ type: "varchar", length: 64 }) id!: string;
  @Column({ name: "request_id", type: "varchar", length: 64 }) requestId!: string;
  @Column({ name: "request_revision", type: "integer" }) requestRevision!: number;
  @Column({ name: "registered_by_id", type: "varchar", length: 64 }) registeredById!: string;
  @Column({ name: "registered_by_name", type: "varchar", length: 120 }) registeredByName!: string;
  @Column({ name: "transfer_reference", type: "varchar", length: 120 }) transferReference!: string;
  @Column({ name: "paid_at", type: "timestamptz" }) paidAt!: Date;
  @Column({ name: "evidence_ids", type: "jsonb" }) evidenceIds!: string[];
  @Column({ type: "varchar", length: 500, nullable: true }) note: string | null = null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}

@Entity({ name: "withdrawal_events" })
export class WithdrawalEventEntity {
  @PrimaryColumn({ type: "varchar", length: 64 }) id!: string;
  @Column({ name: "request_id", type: "varchar", length: 64 }) requestId!: string;
  @Column({ type: "bigint", generated: "increment" }) sequence!: string;
  @Column({ type: "varchar", length: 64 }) action!: string;
  @Column({ name: "actor_id", type: "varchar", length: 64, nullable: true }) actorId!: string | null;
  @Column({ name: "actor_name", type: "varchar", length: 120 }) actorName!: string;
  @Column({ type: "varchar", length: 500, nullable: true }) reason!: string | null;
  @Column({ name: "registration_id", type: "varchar", length: 64, nullable: true }) registrationId!: string | null;
  @Column({ type: "jsonb" }) details!: {
    revision?: number; status?: WithdrawalStatus; amount?: string;
    assigneeId?: string | null; reviewMode?: ReviewMode | null;
    oldAssigneeId?: string | null; oldAssigneeName?: string | null;
    newAssigneeId?: string; newAssigneeName?: string;
    evidenceIds?: string[]; fundsNotTransferred?: boolean;
    legacyAuditId?: string; legacy?: boolean;
    before?: Record<string, unknown> | null; after?: Record<string, unknown> | null;
  };
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}
