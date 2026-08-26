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

export type UserRole = "admin" | "leader" | "collector";
export type UserStatus = "active" | "disabled";

@Entity({ name: "users" })
@Index("idx_users_role_status", ["role", "status"])
@Index("idx_users_team_id", ["teamId"])
export class UserEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "display_name", type: "varchar", length: 120 })
  displayName!: string;

  @Column({ type: "varchar", length: 80 })
  username!: string;

  /** 手机号（可选，用于人员管理快速联系） */
  @Column({ type: "varchar", length: 30, nullable: true })
  phone: string | null = null;

  @Index("idx_users_username_normalized", { unique: true })
  @Column({ name: "username_normalized", type: "citext" })
  usernameNormalized!: string;

  @Column({ name: "password_hash", type: "text" })
  passwordHash!: string;

  @Column({ type: "varchar", length: 16 })
  role!: UserRole;

  @Column({ name: "team_id", type: "varchar", length: 64, nullable: true })
  teamId: string | null = null;

  @ManyToOne(() => TeamEntity, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "team_id" })
  team?: TeamEntity | null;

  @Column({ type: "varchar", length: 16, default: "active" })
  status: UserStatus = "active";

  @Column({ name: "failed_attempt_count", type: "integer", default: 0 })
  failedAttemptCount = 0;

  @Column({ name: "first_failed_at", type: "timestamptz", nullable: true })
  firstFailedAt: Date | null = null;

  @Column({ name: "locked_until", type: "timestamptz", nullable: true })
  lockedUntil: Date | null = null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
