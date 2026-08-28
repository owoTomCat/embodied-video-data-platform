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

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
