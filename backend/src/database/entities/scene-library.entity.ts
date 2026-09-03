import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  type Relation,
  UpdateDateColumn,
} from "typeorm";

import { UserEntity } from "./user.entity.js";

/**
 * 场景库：系统实际管理的采集场景。
 * 一行 = 一个采集场景（外包人员在其对应的场景中采集，如「采集员A家」）。
 * 记录：场景名称 + 场景类别（一级，关联 scene_category_pricing 计费）+ 包含的子场景（二级列表）。
 */
@Entity({ name: "scene_library" })
@Index("idx_scene_library_category", ["categoryKey"])
export class SceneLibraryEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  /** 场景名称（如「采集员A家」「采集员B家」） */
  @Column({ type: "varchar", length: 120 })
  name!: string;

  /** 场景类别（一级）：family / office / factory / generic，对应计费大类 */
  @Column({ name: "category_key", type: "varchar", length: 64 })
  categoryKey!: string;

  /** 该场景包含的子场景：scene_classification.id 列表 */
  @Column({
    name: "sub_scene_ids",
    type: "jsonb",
    default: () => "'[]'::jsonb",
  })
  subSceneIds: string[] = [];

  /** 建库时拍摄的环境照片（MinIO 对象），首张用作场景库卡片封面 + 供 AI 识别生成任务卡 */
  @Column({ name: "photo_refs", type: "jsonb", default: () => "'[]'::jsonb" })
  photoRefs: Array<{ objectKey: string; contentType?: string; name?: string }> = [];

  /** 场景库卡片封面对象 key（= 首张照片），便于数采快速分辨 */
  @Column({ name: "cover_object_key", type: "varchar", length: 512, nullable: true })
  coverObjectKey: string | null = null;

  @Column({ type: "text", default: "" })
  description = "";

  @Column({ type: "boolean", default: true })
  enabled = true;

  @Column({ name: "created_by_account_id", type: "varchar", length: 64 })
  createdByAccountId!: string;

  @ManyToOne(() => UserEntity, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_account_id" })
  createdBy?: Relation<UserEntity>;

  @Column({ name: "created_by_name", type: "varchar", length: 120 })
  createdByName!: string;

  /** 归属数采人员（场景库所有者）：数采个人场景库有值；管理员统一管理的场景库为 null */
  @Index("idx_scene_library_owner", ["ownerAccountId"])
  @Column({ name: "owner_account_id", type: "varchar", length: 64, nullable: true })
  ownerAccountId: string | null = null;

  @ManyToOne(() => UserEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "owner_account_id" })
  owner?: Relation<UserEntity> | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
