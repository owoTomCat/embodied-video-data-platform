import type { EntityManager } from "typeorm";

import { PointCycleAdjustmentEntity } from "../database/entities/point-cycle-adjustment.entity.js";

export async function loadLatestPointCycleAdjustments(
  manager: EntityManager,
  pointCycleItemIds: string[],
): Promise<Map<string, PointCycleAdjustmentEntity>> {
  if (pointCycleItemIds.length === 0) return new Map();

  const adjustments = await manager
    .getRepository(PointCycleAdjustmentEntity)
    .createQueryBuilder("adjustment")
    .distinctOn(["adjustment.pointCycleItemId"])
    .where("adjustment.pointCycleItemId IN (:...pointCycleItemIds)", {
      pointCycleItemIds,
    })
    .orderBy("adjustment.pointCycleItemId", "ASC")
    .addOrderBy("adjustment.sequence", "DESC")
    .getMany();

  return new Map(
    adjustments.map((adjustment) => [
      adjustment.pointCycleItemId,
      adjustment,
    ]),
  );
}
