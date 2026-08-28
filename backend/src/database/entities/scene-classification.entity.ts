import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * 场景分类表：系统所有可能的场景字典。
 * 一行 = 一个二级场景条目：一级编码 + 一级场景 + 二级场景 + 场景描述。
 * 一级场景 = 计费场景大类（F01 家庭 / O01 办公室 / W01 工厂 / G01 通用）。
 */
@Entity({ name: "scene_classification" })
@Index("uq_scene_classification_level2", ["level1Code", "level2Name"], {
  unique: true,
})
export class SceneClassificationEntity {
  @PrimaryColumn({ type: "varchar", length: 64 })
  id!: string;

  /** 一级编码（F01 家庭 / O01 办公室 / W01 工厂 / G01 通用） */
  @Column({ name: "level1_code", type: "varchar", length: 16 })
  level1Code!: string;

  /** 一级场景名称（家庭 / 办公室 / 工厂 / 通用） */
  @Column({ name: "level1_name", type: "varchar", length: 40 })
  level1Name!: string;

  /** 二级场景名称（厨房 / 客厅 / 工位 / 装配区 …） */
  @Column({ name: "level2_name", type: "varchar", length: 80 })
  level2Name!: string;

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
