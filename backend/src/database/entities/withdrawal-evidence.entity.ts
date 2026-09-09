import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({ name: "withdrawal_evidence" })
@Index("idx_withdrawal_evidence_request", ["requestId", "createdAt"])
export class WithdrawalEvidenceEntity {
  @PrimaryColumn({ type: "varchar", length: 64 }) id!: string;
  @Column({ name: "request_id", type: "varchar", length: 64 }) requestId!: string;
  @Column({ name: "original_file_name", type: "varchar", length: 180 }) originalFileName!: string;
  @Column({ name: "content_type", type: "varchar", length: 32 }) contentType!: string;
  @Column({ name: "size_bytes", type: "bigint" }) sizeBytes!: string;
  @Column({ type: "varchar", length: 64 }) sha256!: string;
  @Column({ name: "uploaded_by_id", type: "varchar", length: 64 }) uploadedById!: string;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @Column({ name: "object_key", type: "varchar", length: 256, select: false, unique: true }) objectKey!: string;
}
