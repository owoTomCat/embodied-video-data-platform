import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * 场景大类定价（元/小时）。
 *
 * 定价按「场景大类」设置：同一大类下的细分场景共用同一价格，
 * 如家庭大类下的厨房/客厅/卧室均按家庭价结算。
 * 价格区间约束 [20, 40] 元/小时（家庭最低，上限 40），由 CHECK 约束兜底。
 */
@Entity({ name: "scene_category_pricing" })
export class SceneCategoryPricingEntity {
  @PrimaryColumn({ name: "category_key", type: "varchar", length: 64 })
  categoryKey!: string;

  /** 大类名称（家庭 / 办公室 / 工厂 / 通用） */
  @Column({ type: "varchar", length: 120 })
  name!: string;

  /** 每小时单价（元/小时） */
  @Column({ name: "price_per_hour", type: "numeric", precision: 10, scale: 2 })
  pricePerHour!: string;

  @Column({ type: "text", default: "" })
  description = "";

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
