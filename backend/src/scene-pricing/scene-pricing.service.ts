import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { SceneCategoryPricingEntity } from "../database/entities/scene-category-pricing.entity.js";
import {
  sceneCategoryKeyForSceneName,
  type SceneCategoryKey,
} from "../tasks/preset-scenes.js";

export type SceneCategoryPricingView = {
  categoryKey: string;
  name: string;
  pricePerHour: number;
  description: string;
  updatedAt: number;
};

export function numberOr(value: string | null | undefined): number {
  return Number(value ?? 0) || 0;
}

@Injectable()
export class ScenePricingService {
  constructor(
    @InjectRepository(SceneCategoryPricingEntity)
    private readonly pricing: Repository<SceneCategoryPricingEntity>,
    private readonly audit: AuditService,
  ) {}

  private toView(row: SceneCategoryPricingEntity): SceneCategoryPricingView {
    return {
      categoryKey: row.categoryKey,
      name: row.name,
      pricePerHour: numberOr(row.pricePerHour),
      description: row.description,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  /** 全部场景大类定价（含默认值） */
  async list(): Promise<SceneCategoryPricingView[]> {
    const rows = await this.pricing.find({
      order: { categoryKey: "ASC" },
    });
    return rows.map((row) => this.toView(row));
  }

  /** 单个场景大类定价 */
  async get(key: string): Promise<SceneCategoryPricingView | null> {
    const row = await this.pricing.findOneBy({ categoryKey: key });
    return row ? this.toView(row) : null;
  }

  /**
   * 更新场景大类单价（元/小时）。
   * 范围校验由 DTO（20~40）与数据库 CHECK 约束双重兜底。
   */
  async update(
    actor: PublicUser,
    key: string,
    input: { pricePerHour: number; description?: string },
  ): Promise<SceneCategoryPricingView> {
    this.requireAdmin(actor);
    const row = await this.pricing.findOneBy({ categoryKey: key });
    if (!row) {
      throw new ScenePricingFailure("NOT_FOUND", "场景大类不存在", 404);
    }
    const before = this.toView(row);
    row.pricePerHour = input.pricePerHour.toFixed(2);
    if (input.description !== undefined) {
      row.description = input.description.trim();
    }
    const saved = await this.pricing.save(row);
    await this.audit.record(
      this.pricing.manager,
      actor,
      "scene_pricing_update",
      { id: key, name: row.name },
      `更新场景「${row.name}」单价为 ${Number(row.pricePerHour).toFixed(2)} 元/小时`,
      { categoryKey: key, pricePerHour: before.pricePerHour },
      { categoryKey: key, pricePerHour: numberOr(saved.pricePerHour) },
    );
    return this.toView(saved);
  }

  /**
   * 按场景名称解析场景大类单价（元/小时）。
   * 仅预设场景命中；通用/自定义任务返回 null（由全局默认兜底或任务自填）。
   */
  async pricePerHourForSceneName(sceneName: string): Promise<number | null> {
    const categoryKey = sceneCategoryKeyForSceneName(sceneName);
    if (!categoryKey) return null;
    const row = await this.pricing.findOneBy({ categoryKey });
    return row ? numberOr(row.pricePerHour) : null;
  }

  /** 全部大类键 → 单价映射（任务创建页带出默认价用） */
  async priceMap(): Promise<Partial<Record<SceneCategoryKey, number>>> {
    const rows = await this.pricing.find();
    const map: Partial<Record<SceneCategoryKey, number>> = {};
    for (const row of rows) {
      map[row.categoryKey as SceneCategoryKey] = numberOr(row.pricePerHour);
    }
    return map;
  }

  private requireAdmin(actor: PublicUser): void {
    if (actor.status !== "active" || actor.role !== "admin") {
      throw new ScenePricingFailure(
        "FORBIDDEN",
        "仅管理员可修改场景定价",
        403,
      );
    }
  }
}

export class ScenePricingFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ScenePricingFailure";
  }
}
