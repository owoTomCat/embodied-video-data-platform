import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { CollectionTaskEntity } from "../database/entities/collection-task.entity.js";
import { SceneCategoryPricingEntity } from "../database/entities/scene-category-pricing.entity.js";
import { SceneEntity } from "../database/entities/scene.entity.js";
import { SceneLibraryEntity } from "../database/entities/scene-library.entity.js";

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
    @InjectRepository(SceneEntity)
    private readonly scenes: Repository<SceneEntity>,
    @InjectRepository(SceneLibraryEntity)
    private readonly libraries: Repository<SceneLibraryEntity>,
    @InjectRepository(CollectionTaskEntity)
    private readonly collectionTasks: Repository<CollectionTaskEntity>,
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
   * 新增场景大类（category_key 自动生成；单价范围 [20, 40]）。
   */
  async create(
    actor: PublicUser,
    input: { name: string; pricePerHour: number; description?: string },
  ): Promise<SceneCategoryPricingView> {
    this.requireAdmin(actor);
    const name = input.name.trim();
    if (!name) {
      throw new ScenePricingFailure("VALIDATION", "请填写大类名称", 400);
    }
    const nameConflict = await this.pricing.findOneBy({ name });
    if (nameConflict) {
      throw new ScenePricingFailure("CONFLICT", `计费大类「${name}」已存在`, 409);
    }
    const categoryKey = await this.resolveUniqueCategoryKey(name);
    const row = await this.pricing.save(
      this.pricing.create({
        categoryKey,
        name,
        pricePerHour: input.pricePerHour.toFixed(2),
        description: input.description?.trim() ?? "",
      }),
    );
    await this.audit.record(
      this.pricing.manager,
      actor,
      "scene_pricing_update",
      { id: categoryKey, name },
      `新增计费大类「${name}」（单价 ${Number(row.pricePerHour).toFixed(2)} 元/小时）`,
      null,
      { categoryKey, name, pricePerHour: numberOr(row.pricePerHour) },
    );
    return this.toView(row);
  }

  /** 删除计费大类（需无场景/场景库/场景型任务引用）。 */
  async delete(actor: PublicUser, key: string): Promise<{ deleted: boolean }> {
    this.requireAdmin(actor);
    const row = await this.pricing.findOneBy({ categoryKey: key });
    if (!row) {
      throw new ScenePricingFailure("NOT_FOUND", "计费大类不存在", 404);
    }
    const [sceneCount, libraryCount, taskCount] = await Promise.all([
      this.scenes.countBy({ categoryKey: key }),
      this.libraries.countBy({ categoryKey: key }),
      this.collectionTasks.countBy({ categoryKey: key }),
    ]);
    if (sceneCount + libraryCount + taskCount > 0) {
      throw new ScenePricingFailure(
        "IN_USE",
        `该计费大类仍被 ${sceneCount} 个场景、${libraryCount} 个场景库、${taskCount} 个任务引用，无法删除`,
        409,
      );
    }
    await this.pricing.delete({ categoryKey: key });
    await this.audit.record(
      this.pricing.manager,
      actor,
      "scene_pricing_delete",
      { id: key, name: row.name },
      `删除计费大类「${row.name}」`,
      { categoryKey: key, name: row.name },
      null,
    );
    return { deleted: true };
  }

  /** 由名称自动生成唯一且 URL 安全的 category_key（中文名回退为 cat_<hash>）。 */
  private async resolveUniqueCategoryKey(name: string): Promise<string> {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const base =
      slug || `cat_${createHash("sha256").update(name).digest("hex").slice(0, 8)}`;
    let key = base;
    let counter = 1;
    while (await this.pricing.findOneBy({ categoryKey: key })) {
      key = `${base}_${counter++}`;
    }
    return key;
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
