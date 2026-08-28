import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { SceneCategoryPricingEntity } from "../database/entities/scene-category-pricing.entity.js";
import { SceneClassificationEntity } from "../database/entities/scene-classification.entity.js";
import { SceneLevel1Entity } from "../database/entities/scene-level1.entity.js";
import { SceneLibraryEntity } from "../database/entities/scene-library.entity.js";

export type PublicLevel1Scene = {
  id: string;
  code: string;
  name: string;
  categoryKey: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  level2Count: number;
  libraryCount: number;
  updatedAt: number;
};

export type PublicSceneClassification = {
  id: string;
  level1Code: string;
  level1Name: string;
  level2Name: string;
  description: string;
  enabled: boolean;
  updatedAt: number;
};

export type PublicSceneLibrary = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  subScenes: Array<{ id: string; level2Name: string; level1Code: string }>;
  subSceneIds: string[];
  description: string;
  enabled: boolean;
  createdByName: string;
  updatedAt: number;
};

export class SceneSystemFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SceneSystemFailure";
  }
}

@Injectable()
export class SceneSystemService {
  constructor(
    @InjectRepository(SceneLevel1Entity)
    private readonly level1: Repository<SceneLevel1Entity>,
    @InjectRepository(SceneClassificationEntity)
    private readonly classification: Repository<SceneClassificationEntity>,
    @InjectRepository(SceneLibraryEntity)
    private readonly library: Repository<SceneLibraryEntity>,
    @InjectRepository(SceneCategoryPricingEntity)
    private readonly pricing: Repository<SceneCategoryPricingEntity>,
    private readonly audit: AuditService,
  ) {}

  // ---------- 一级场景 ----------

  /** 一级场景列表（含二级数量与场景库引用数） */
  async listLevel1(): Promise<PublicLevel1Scene[]> {
    const rows = await this.level1.find({
      order: { sortOrder: "ASC", code: "ASC" },
    });
    const [level2Counts, libraryCounts] = await Promise.all([
      this.classification
        .createQueryBuilder("classification")
        .select("classification.level1Code", "code")
        .addSelect("COUNT(*)", "cnt")
        .groupBy("classification.level1Code")
        .getRawMany<{ code: string; cnt: string }>(),
      this.library
        .createQueryBuilder("library")
        .select("library.categoryKey", "key")
        .addSelect("COUNT(*)", "cnt")
        .groupBy("library.categoryKey")
        .getRawMany<{ key: string; cnt: string }>(),
    ]);
    const level2ByCode = new Map(level2Counts.map((row) => [row.code, Number(row.cnt)]));
    const libraryByKey = new Map(libraryCounts.map((row) => [row.key, Number(row.cnt)]));
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      categoryKey: row.categoryKey,
      description: row.description,
      sortOrder: row.sortOrder,
      enabled: row.enabled,
      level2Count: level2ByCode.get(row.code) ?? 0,
      libraryCount: libraryByKey.get(row.categoryKey) ?? 0,
      updatedAt: row.updatedAt.getTime(),
    }));
  }

  async getLevel1ByCode(code: string): Promise<SceneLevel1Entity | null> {
    return this.level1.findOneBy({ code });
  }

  async getLevel1ByCategoryKey(key: string): Promise<SceneLevel1Entity | null> {
    return this.level1.findOneBy({ categoryKey: key });
  }

  /**
   * 新增一级场景：同时创建对应计费行（category_key = 编码小写，默认 20 元/小时，可在结算页调整）。
   */
  async createLevel1(
    actor: PublicUser,
    input: { code: string; name: string; description?: string; sortOrder?: number },
  ): Promise<PublicLevel1Scene> {
    this.requireAdmin(actor);
    const code = input.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/u.test(code)) {
      throw new SceneSystemFailure(
        "VALIDATION",
        "一级编码需为 2-8 位大写字母或数字（如 F02、H01）",
        400,
      );
    }
    const name = input.name.trim();
    if (!name) {
      throw new SceneSystemFailure("VALIDATION", "请填写一级场景名称", 400);
    }
    const categoryKey = code.toLowerCase();
    const codeExists = await this.level1.findOneBy({ code });
    if (codeExists) {
      throw new SceneSystemFailure("CONFLICT", `一级编码 ${code} 已存在`, 409);
    }
    const nameExists = await this.level1.findOneBy({ name });
    if (nameExists) {
      throw new SceneSystemFailure("CONFLICT", `一级场景名称「${name}」已存在`, 409);
    }
    const pricingExists = await this.pricing.findOneBy({ categoryKey });
    if (pricingExists) {
      throw new SceneSystemFailure(
        "CONFLICT",
        `计费大类 ${categoryKey} 已存在，请更换编码`,
        409,
      );
    }
    const row = await this.level1.save(
      this.level1.create({
        id: `L1-${randomUUID().slice(0, 8).toUpperCase()}`,
        code,
        name,
        categoryKey,
        description: input.description?.trim() ?? "",
        sortOrder: input.sortOrder ?? 0,
        enabled: true,
      }),
    );
    // 计费行：默认 20 元/小时（范围 [20, 40]）
    await this.pricing.save(
      this.pricing.create({
        categoryKey,
        name,
        pricePerHour: "20.00",
        description: `${name}场景（新建一级场景默认价）`,
      }),
    );
    await this.audit.record(
      this.level1.manager,
      actor,
      "scene_level1_update",
      { id: row.id, name: `${code} ${name}` },
      `新增一级场景「${code} ${name}」并创建计费大类 ${categoryKey}`,
      null,
      { id: row.id, code, name, categoryKey },
    );
    return (await this.listLevel1()).find((item) => item.id === row.id)!;
  }

  async updateLevel1(
    actor: PublicUser,
    id: string,
    input: { name?: string; description?: string; sortOrder?: number; enabled?: boolean },
  ): Promise<PublicLevel1Scene> {
    this.requireAdmin(actor);
    const row = await this.level1.findOneBy({ id });
    if (!row) {
      throw new SceneSystemFailure("NOT_FOUND", "一级场景不存在", 404);
    }
    const before = { ...row };
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new SceneSystemFailure("VALIDATION", "请填写一级场景名称", 400);
      const nameExists = await this.level1.findOneBy({ name });
      if (nameExists && nameExists.id !== id) {
        throw new SceneSystemFailure("CONFLICT", `一级场景名称「${name}」已存在`, 409);
      }
      row.name = name;
    }
    if (input.description !== undefined) row.description = input.description.trim();
    if (input.sortOrder !== undefined) row.sortOrder = input.sortOrder;
    if (input.enabled !== undefined) row.enabled = input.enabled;
    const saved = await this.level1.save(row);
    // 同步计费行名称
    if (input.name !== undefined) {
      await this.pricing.update(
        { categoryKey: row.categoryKey },
        { name: row.name },
      );
    }
    await this.audit.record(
      this.level1.manager,
      actor,
      "scene_level1_update",
      { id: saved.id, name: `${saved.code} ${saved.name}` },
      `更新一级场景「${saved.code} ${saved.name}」`,
      { id: before.id, name: before.name, enabled: before.enabled },
      { id: saved.id, name: saved.name, enabled: saved.enabled },
    );
    return (await this.listLevel1()).find((item) => item.id === saved.id)!;
  }

  async deleteLevel1(actor: PublicUser, id: string): Promise<{ deleted: boolean }> {
    this.requireAdmin(actor);
    const row = await this.level1.findOneBy({ id });
    if (!row) {
      throw new SceneSystemFailure("NOT_FOUND", "一级场景不存在", 404);
    }
    const level2Count = await this.classification.countBy({
      level1Code: row.code,
    });
    if (level2Count > 0) {
      throw new SceneSystemFailure(
        "IN_USE",
        `该一级场景下还有 ${level2Count} 个二级场景，请先删除二级场景`,
        409,
      );
    }
    const libraryCount = await this.library.countBy({
      categoryKey: row.categoryKey,
    });
    if (libraryCount > 0) {
      throw new SceneSystemFailure(
        "IN_USE",
        `有 ${libraryCount} 个场景库场景关联该一级场景，请先移除`,
        409,
      );
    }
    await this.level1.delete({ id });
    await this.pricing.delete({ categoryKey: row.categoryKey });
    await this.audit.record(
      this.level1.manager,
      actor,
      "scene_level1_delete",
      { id: row.id, name: `${row.code} ${row.name}` },
      `删除一级场景「${row.code} ${row.name}」及计费大类 ${row.categoryKey}`,
      { id: row.id, code: row.code, name: row.name },
      null,
    );
    return { deleted: true };
  }

  // ---------- 场景分类表 ----------

  /** 全部二级场景（按一级分组返回扁平列表） */
  async listClassification(): Promise<PublicSceneClassification[]> {
    const rows = await this.classification.find({
      order: { level1Code: "ASC", level2Name: "ASC" },
    });
    return rows.map(this.toClassificationView);
  }

  private toClassificationView(
    row: SceneClassificationEntity,
  ): PublicSceneClassification {
    return {
      id: row.id,
      level1Code: row.level1Code,
      level1Name: row.level1Name,
      level2Name: row.level2Name,
      description: row.description,
      enabled: row.enabled,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async createClassification(
    actor: PublicUser,
    input: { level1Code: string; level2Name: string; description?: string },
  ): Promise<PublicSceneClassification> {
    this.requireAdmin(actor);
    const level1 = await this.getLevel1ByCode(input.level1Code.trim().toUpperCase());
    if (!level1) {
      throw new SceneSystemFailure("VALIDATION", "一级编码不存在", 400);
    }
    const duplicate = await this.classification.findOneBy({
      level1Code: level1.code,
      level2Name: input.level2Name.trim(),
    });
    if (duplicate) {
      throw new SceneSystemFailure(
        "CONFLICT",
        `「${level1.name}」下已存在二级场景「${input.level2Name.trim()}」`,
        409,
      );
    }
    const row = await this.classification.save(
      this.classification.create({
        id: `SC-${randomUUID().slice(0, 8).toUpperCase()}`,
        level1Code: level1.code,
        level1Name: level1.name,
        level2Name: input.level2Name.trim(),
        description: input.description?.trim() ?? "",
        enabled: true,
      }),
    );
    await this.audit.record(
      this.classification.manager,
      actor,
      "scene_classification_update",
      { id: row.id, name: `${level1.name}-${row.level2Name}` },
      `新增二级场景「${level1.name}-${row.level2Name}」`,
      null,
      { id: row.id, level1Code: row.level1Code, level2Name: row.level2Name },
    );
    return this.toClassificationView(row);
  }

  async updateClassification(
    actor: PublicUser,
    id: string,
    input: { level2Name?: string; description?: string; enabled?: boolean },
  ): Promise<PublicSceneClassification> {
    this.requireAdmin(actor);
    const row = await this.classification.findOneBy({ id });
    if (!row) {
      throw new SceneSystemFailure("NOT_FOUND", "二级场景不存在", 404);
    }
    const before = this.toClassificationView(row);
    if (input.level2Name !== undefined) row.level2Name = input.level2Name.trim();
    if (input.description !== undefined) {
      row.description = input.description.trim();
    }
    if (input.enabled !== undefined) row.enabled = input.enabled;
    const saved = await this.classification.save(row);
    await this.audit.record(
      this.classification.manager,
      actor,
      "scene_classification_update",
      { id: saved.id, name: `${saved.level1Name}-${saved.level2Name}` },
      `更新二级场景「${saved.level1Name}-${saved.level2Name}」`,
      { id: before.id, level2Name: before.level2Name },
      { id: saved.id, level2Name: saved.level2Name, enabled: saved.enabled },
    );
    return this.toClassificationView(saved);
  }

  async deleteClassification(
    actor: PublicUser,
    id: string,
  ): Promise<{ deleted: boolean }> {
    this.requireAdmin(actor);
    const row = await this.classification.findOneBy({ id });
    if (!row) {
      throw new SceneSystemFailure("NOT_FOUND", "二级场景不存在", 404);
    }
    const usedBy = await this.library
      .createQueryBuilder("library")
      .where("library.sub_scene_ids @> :ids::jsonb", {
        ids: JSON.stringify([id]),
      })
      .getCount();
    if (usedBy > 0) {
      throw new SceneSystemFailure(
        "IN_USE",
        `该二级场景被 ${usedBy} 个场景库场景引用，请先从场景库移除后再删除`,
        409,
      );
    }
    await this.classification.delete({ id });
    await this.audit.record(
      this.classification.manager,
      actor,
      "scene_classification_delete",
      { id: row.id, name: `${row.level1Name}-${row.level2Name}` },
      `删除二级场景「${row.level1Name}-${row.level2Name}」`,
      { id: row.id, level2Name: row.level2Name },
      null,
    );
    return { deleted: true };
  }

  // ---------- 场景库 ----------

  /** 场景库列表（hydrate 类别名与子场景详情） */
  async listLibrary(): Promise<PublicSceneLibrary[]> {
    const rows = await this.library.find({
      order: { createdAt: "DESC" },
    });
    const [classifications, level1Rows] = await Promise.all([
      this.classification.find(),
      this.level1.find(),
    ]);
    const byId = new Map(classifications.map((item) => [item.id, item]));
    const level1ByKey = new Map(level1Rows.map((item) => [item.categoryKey, item]));
    return rows.map((row) => this.toLibraryView(row, byId, level1ByKey));
  }

  /** 按 id 查单个场景库条目（供任务创建关联） */
  async getLibraryById(id: string): Promise<PublicSceneLibrary | null> {
    const row = await this.library.findOneBy({ id });
    if (!row) return null;
    const [classifications, level1Rows] = await Promise.all([
      this.classification.find(),
      this.level1.find(),
    ]);
    const byId = new Map(classifications.map((item) => [item.id, item]));
    const level1ByKey = new Map(level1Rows.map((item) => [item.categoryKey, item]));
    return this.toLibraryView(row, byId, level1ByKey);
  }

  private toLibraryView(
    row: SceneLibraryEntity,
    classificationById: Map<string, SceneClassificationEntity>,
    level1ByCategoryKey: Map<string, SceneLevel1Entity>,
  ): PublicSceneLibrary {
    const level1 = level1ByCategoryKey.get(row.categoryKey);
    return {
      id: row.id,
      name: row.name,
      categoryKey: row.categoryKey,
      categoryName: level1?.name ?? row.categoryKey,
      subScenes: row.subSceneIds
        .map((id) => classificationById.get(id))
        .filter((item): item is SceneClassificationEntity => Boolean(item))
        .map((item) => ({
          id: item.id,
          level2Name: item.level2Name,
          level1Code: item.level1Code,
        })),
      subSceneIds: row.subSceneIds,
      description: row.description,
      enabled: row.enabled,
      createdByName: row.createdByName,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async createLibrary(
    actor: PublicUser,
    input: {
      name: string;
      categoryKey: string;
      subSceneIds: string[];
      description?: string;
    },
  ): Promise<PublicSceneLibrary> {
    this.requireAdmin(actor);
    const level1 = await this.getLevel1ByCategoryKey(input.categoryKey);
    if (!level1) {
      throw new SceneSystemFailure("VALIDATION", "场景类别不存在", 400);
    }
    const subScenes = await this.validateSubScenes(input.subSceneIds, level1.code);
    const row = await this.library.save(
      this.library.create({
        id: `SL-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: input.name.trim(),
        categoryKey: level1.categoryKey,
        subSceneIds: subScenes.map((item) => item.id),
        description: input.description?.trim() ?? "",
        enabled: true,
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
      }),
    );
    await this.audit.record(
      this.library.manager,
      actor,
      "scene_library_update",
      { id: row.id, name: row.name },
      `新增场景库场景「${row.name}」（类别：${level1.name}）`,
      null,
      {
        id: row.id,
        name: row.name,
        categoryKey: row.categoryKey,
        subSceneIds: row.subSceneIds,
      },
    );
    return (await this.getLibraryById(row.id))!;
  }

  async updateLibrary(
    actor: PublicUser,
    id: string,
    input: {
      name?: string;
      categoryKey?: string;
      subSceneIds?: string[];
      description?: string;
      enabled?: boolean;
    },
  ): Promise<PublicSceneLibrary> {
    this.requireAdmin(actor);
    const row = await this.library.findOneBy({ id });
    if (!row) {
      throw new SceneSystemFailure("NOT_FOUND", "场景库场景不存在", 404);
    }
    let categoryCode = (await this.getLevel1ByCategoryKey(row.categoryKey))?.code ?? "F01";
    if (input.categoryKey !== undefined) {
      const level1 = await this.getLevel1ByCategoryKey(input.categoryKey);
      if (!level1) {
        throw new SceneSystemFailure("VALIDATION", "场景类别不存在", 400);
      }
      row.categoryKey = level1.categoryKey;
      categoryCode = level1.code;
    }
    if (input.name !== undefined) row.name = input.name.trim();
    if (input.subSceneIds !== undefined) {
      const subScenes = await this.validateSubScenes(input.subSceneIds, categoryCode);
      row.subSceneIds = subScenes.map((item) => item.id);
    }
    if (input.description !== undefined) {
      row.description = input.description.trim();
    }
    if (input.enabled !== undefined) row.enabled = input.enabled;
    const saved = await this.library.save(row);
    await this.audit.record(
      this.library.manager,
      actor,
      "scene_library_update",
      { id: saved.id, name: saved.name },
      `更新场景库场景「${saved.name}」`,
      { id: row.id, name: row.name },
      { id: saved.id, name: saved.name, categoryKey: saved.categoryKey },
    );
    return (await this.getLibraryById(saved.id))!;
  }

  async deleteLibrary(
    actor: PublicUser,
    id: string,
  ): Promise<{ deleted: boolean }> {
    this.requireAdmin(actor);
    const row = await this.library.findOneBy({ id });
    if (!row) {
      throw new SceneSystemFailure("NOT_FOUND", "场景库场景不存在", 404);
    }
    await this.library.delete({ id });
    await this.audit.record(
      this.library.manager,
      actor,
      "scene_library_delete",
      { id: row.id, name: row.name },
      `删除场景库场景「${row.name}」`,
      { id: row.id, name: row.name },
      null,
    );
    return { deleted: true };
  }

  /** 校验子场景 id 列表都属于指定一级编码，返回实体列表 */
  private async validateSubScenes(
    ids: string[],
    level1Code: string,
  ): Promise<SceneClassificationEntity[]> {
    const uniqueIds = [...new Set(ids)];
    const rows = await this.classification.findBy({ id: In(uniqueIds) });
    if (rows.length !== uniqueIds.length) {
      throw new SceneSystemFailure(
        "VALIDATION",
        "包含不存在的二级场景",
        400,
      );
    }
    const wrongCategory = rows.find((row) => row.level1Code !== level1Code);
    if (wrongCategory) {
      throw new SceneSystemFailure(
        "VALIDATION",
        `二级场景「${wrongCategory.level2Name}」不属于所选一级场景`,
        400,
      );
    }
    return rows;
  }

  private requireAdmin(actor: PublicUser): void {
    if (actor.status !== "active" || actor.role !== "admin") {
      throw new SceneSystemFailure(
        "FORBIDDEN",
        "仅管理员可管理场景体系",
        403,
      );
    }
  }
}
