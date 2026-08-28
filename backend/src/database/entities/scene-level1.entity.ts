import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * 一级场景（可管理）。
 * 与计费大类 1:1 关联（category_key → scene_category_pricing）；
 * 新增一级场景时自动创建对应计费行（默认 20 元/小时）。
 */
@Entity({ name: "scene_level1" })
@Index("uq_scene_level1_code", ["code"], { unique: true })
@Index("uq_scene_level1_name", ["name"], { unique: true })
@Index("uq_scene_level1_category", ["categoryKey"], { unique: true })
export class SceneLevel1Entity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  /** 一级编码（F01/O01/W01/G01 或新增编码），创建后不可修改 */
  @Column({ type: "varchar", length: 16 })
  code!: string;

  /** 一级场景名称 */
  @Column({ type: "varchar", length: 40 })
  name!: string;

  /** 计费大类 key（scene_category_pricing.category_key） */
  @Column({ name: "category_key", type: "varchar", length: 64 })
  categoryKey!: string;

  @Column({ type: "text", default: "" })
  description = "";

  @Column({ name: "sort_order", type: "integer", default: 0 })
  sortOrder = 0;

  @Column({ type: "boolean", default: true })
  enabled = true;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
