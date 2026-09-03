import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * 场景（单层）：原 scene_classification 的二级场景升级为唯一场景实体。
 * 每个场景归属一个计费大类 category_key（scene_category_pricing.category_key），
 * 一级场景不再作为独立实体（scene_level1 已删除），计费/分栏统一走 scene_category_pricing。
 */
@Entity({ name: "scene" })
@Index("uq_scene_category_name", ["categoryKey", "name"], { unique: true })
export class SceneEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  /** 场景名称（原 level2_name：厨房 / 客厅 / 工位 / 装配区 …） */
  @Column({ type: "varchar", length: 80 })
  name!: string;

  /** 计费大类 key（scene_category_pricing.category_key） */
  @Column({ name: "category_key", type: "varchar", length: 64 })
  categoryKey!: string;

  /** 场景描述 */
  @Column({ type: "text", default: "" })
  description = "";

  @Column({ type: "boolean", default: true })
  enabled = true;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
