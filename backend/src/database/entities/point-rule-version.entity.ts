import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { UserEntity } from "./user.entity.js";

export type PointRuleCoefficientBand = {
  minScore: number;
  maxScore: number;
  ratio: number;
  label: string;
};

@Entity({ name: "point_rule_versions" })
@Index("uq_point_rule_versions_revision", ["revision"], { unique: true })
export class PointRuleVersionEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ type: "integer" })
  revision!: number;

  @Column({ type: "varchar", length: 64 })
  version!: string;

  @Column({
    name: "default_points_per_minute",
    type: "numeric",
    precision: 12,
    scale: 4,
  })
  defaultPointsPerMinute!: string;

  @Column({ name: "coefficient_bands", type: "jsonb" })
  coefficientBands!: PointRuleCoefficientBand[];

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "boolean", default: false })
  active = false;

  @Column({ name: "created_by_account_id", type: "varchar", length: 64, nullable: true })
  createdByAccountId: string | null = null;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_account_id" })
  createdBy?: UserEntity;

  @Column({ name: "created_by_name", type: "varchar", length: 120 })
  createdByName!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}
