/** 场景大类定价（元/小时），价格范围 [20, 40] */
export type SceneCategoryPricing = {
  categoryKey: string;
  name: string;
  pricePerHour: number;
  description: string;
  updatedAt: number;
};

export type UpdateSceneCategoryPriceInput = {
  pricePerHour: number;
  description?: string;
};
