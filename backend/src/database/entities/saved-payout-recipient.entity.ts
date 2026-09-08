import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "saved_payout_recipients" })
export class SavedPayoutRecipientEntity {
  @PrimaryColumn({ name: "owner_id", type: "varchar", length: 64 }) ownerId!: string;
  @PrimaryColumn({ type: "varchar", length: 16 }) method!: "alipay" | "bank";
  @Column({ name: "recipient_encrypted", type: "text", select: false }) recipientEncrypted!: string;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
