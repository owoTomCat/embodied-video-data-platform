import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
} from "typeorm";

import { DeliveryPackageEntity } from "./delivery-package.entity.js";
import { PointCycleItemEntity } from "./point-cycle-item.entity.js";
import { SubmissionEntity } from "./submission.entity.js";

@Entity({ name: "delivery_package_items" })
@Index("idx_delivery_package_items_package", ["packageId"])
export class DeliveryPackageItemEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  @Column({ name: "package_id", type: "varchar", length: 64 })
  packageId!: string;

  @ManyToOne(() => DeliveryPackageEntity, (deliveryPackage) => deliveryPackage.items, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "package_id" })
  package?: Relation<DeliveryPackageEntity>;

  @Column({ name: "point_cycle_item_id", type: "varchar", length: 64 })
  pointCycleItemId!: string;

  @ManyToOne(() => PointCycleItemEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "point_cycle_item_id" })
  pointCycleItem?: Relation<PointCycleItemEntity>;

  @Column({ name: "submission_id", type: "varchar", length: 64 })
  submissionId!: string;

  @ManyToOne(() => SubmissionEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "submission_id" })
  submission?: Relation<SubmissionEntity>;

  @Column({ name: "file_name", type: "varchar", length: 255 })
  fileName!: string;

  @Column({ name: "object_key", type: "text" })
  objectKey!: string;

  @Column({ name: "owner_name", type: "varchar", length: 120 })
  ownerName!: string;

  @Column({ name: "team_name", type: "varchar", length: 120 })
  teamName!: string;

  @Column({ name: "final_score", type: "numeric", precision: 6, scale: 1 })
  finalScore!: string;

  @Column({ type: "numeric", precision: 18, scale: 2 })
  points!: string;

  @Column({ name: "size_bytes", type: "bigint" })
  sizeBytes!: string;

  @Column({
    name: "accepted_annotation_snapshot",
    type: "jsonb",
    nullable: true,
  })
  acceptedAnnotationSnapshot: Record<string, unknown> | null = null;
}
