import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { SceneClassificationEntity } from "../database/entities/scene-classification.entity.js";
import { SceneLibraryEntity } from "../database/entities/scene-library.entity.js";

/** 一级场景常量：编码 ↔ 名称 ↔ 计费大类 key */
export const LEVEL1_SCENES: Array<{
  code: string;
  name: string;
  categoryKey: string;
}> = [
  { code: "F01", name: "家庭", categoryKey: "family" },
  { code: "O01", name: "办公室", categoryKey: "office" },
  { code: "W01", name: "工厂", categoryKey: "factory" },
  { code: "G01", name: "通用", categoryKey: "generic" },
];

export const LEVEL1_BY_CODE = new Map(
  LEVEL1_SCENES.map((scene) => [scene.code, scene]),
);

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
    @InjectRepository(SceneClassificationEntity)
    private readonly classification: Repository<SceneClassificationEntity>,
    @InjectRepository(SceneLibraryEntity)
    private readonly library: Repository<SceneLibraryEntity>,
    private readonly audit: AuditService,
  ) {}

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
    const level1 = LEVEL1_BY_CODE.get(input.level1Code.trim().toUpperCase());
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
    const classifications = await this.classification.find();
    const byId = new Map(
      classifications.map((item) => [item.id, item]),
    );
    return rows.map((row) => this.toLibraryView(row, byId));
  }

  /** 按 id 查单个场景库条目（供任务创建关联） */
  async getLibraryById(id: string): Promise<PublicSceneLibrary | null> {
    const row = await this.library.findOneBy({ id });
    if (!row) return null;
    const classifications = await this.classification.find();
    const byId = new Map(
      classifications.map((item) => [item.id, item]),
    );
    return this.toLibraryView(row, byId);
  }

  private toLibraryView(
    row: SceneLibraryEntity,
    classificationById: Map<string, SceneClassificationEntity>,
  ): PublicSceneLibrary {
    const category = LEVEL1_SCENES.find(
      (scene) => scene.categoryKey === row.categoryKey,
    );
    return {
      id: row.id,
      name: row.name,
      categoryKey: row.categoryKey,
      categoryName: category?.name ?? row.categoryKey,
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
    const category = LEVEL1_SCENES.find(
      (scene) => scene.categoryKey === input.categoryKey,
    );
    if (!category) {
      throw new SceneSystemFailure("VALIDATION", "场景类别不存在", 400);
    }
    const subScenes = await this.validateSubScenes(
      input.subSceneIds,
      category.code,
    );
    const row = await this.library.save(
      this.library.create({
        id: `SL-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: input.name.trim(),
        categoryKey: category.categoryKey,
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
      `新增场景库场景「${row.name}」（类别：${category.name}）`,
      null,
      {
        id: row.id,
        name: row.name,
        categoryKey: row.categoryKey,
        subSceneIds: row.subSceneIds,
      },
    );
    return this.toLibraryView(row, await this.classificationMap());
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
    let categoryCode = LEVEL1_BY_CODE.get(row.categoryKey)?.code ?? "F01";
    if (input.categoryKey !== undefined) {
      const category = LEVEL1_SCENES.find(
        (scene) => scene.categoryKey === input.categoryKey,
      );
      if (!category) {
        throw new SceneSystemFailure("VALIDATION", "场景类别不存在", 400);
      }
      row.categoryKey = category.categoryKey;
      categoryCode = category.code;
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
    return this.toLibraryView(saved, await this.classificationMap());
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

  private async classificationMap(): Promise<
    Map<string, SceneClassificationEntity>
  > {
    const rows = await this.classification.find();
    return new Map(rows.map((item) => [item.id, item]));
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
