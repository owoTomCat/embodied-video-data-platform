import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { SceneCategoryPricingEntity } from "../database/entities/scene-category-pricing.entity.js";
import { SceneEntity } from "../database/entities/scene.entity.js";
import { SceneLibraryEntity } from "../database/entities/scene-library.entity.js";

export type PublicScene = {
  id: string;
  name: string;
  categoryKey: string;
  description: string;
  enabled: boolean;
  updatedAt: number;
};

export type PublicSceneLibrary = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  subScenes: Array<{ id: string; name: string; categoryKey: string }>;
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
    @InjectRepository(SceneEntity)
    private readonly scenes: Repository<SceneEntity>,
    @InjectRepository(SceneLibraryEntity)
    private readonly library: Repository<SceneLibraryEntity>,
    @InjectRepository(SceneCategoryPricingEntity)
    private readonly pricing: Repository<SceneCategoryPricingEntity>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- 场景（单层） ----------

  /** 全部场景（单层） */
  async listScenes(): Promise<PublicScene[]> {
    const rows = await this.scenes.find({
      order: { categoryKey: "ASC", name: "ASC" },
    });
    return rows.map(this.toSceneView);
  }

  private toSceneView(row: SceneEntity): PublicScene {
    return {
      id: row.id,
      name: row.name,
      categoryKey: row.categoryKey,
      description: row.description,
      enabled: row.enabled,
      updatedAt: row.updatedAt.getTime(),
    };
  }

  async createScene(
    actor: PublicUser,
    input: { name: string; categoryKey: string; description?: string },
  ): Promise<PublicScene> {
    this.requireAdmin(actor);
    const name = input.name.trim();
    if (!name) {
      throw new SceneSystemFailure("VALIDATION", "请填写场景名称", 400);
    }
    const pricingRow = await this.pricing.findOneBy({
      categoryKey: input.categoryKey,
    });
    if (!pricingRow) {
      throw new SceneSystemFailure("VALIDATION", "计费大类不存在", 400);
    }
    const duplicate = await this.scenes.findOneBy({
      categoryKey: input.categoryKey,
      name,
    });
    if (duplicate) {
      throw new SceneSystemFailure(
        "CONFLICT",
        `「${pricingRow.name}」下已存在场景「${name}」`,
        409,
      );
    }
    const row = await this.scenes.save(
      this.scenes.create({
        id: `SC-${randomUUID().slice(0, 8).toUpperCase()}`,
        name,
        categoryKey: input.categoryKey,
        description: input.description?.trim() ?? "",
        enabled: true,
      }),
    );
    await this.audit.record(
      this.scenes.manager,
      actor,
      "scene_update",
      { id: row.id, name: `${pricingRow.name}-${row.name}` },
      `新增场景「${pricingRow.name}-${row.name}」`,
      null,
      { id: row.id, name: row.name, categoryKey: row.categoryKey },
    );
    return this.toSceneView(row);
  }

  async updateScene(
    actor: PublicUser,
    id: string,
    input: { name?: string; description?: string; enabled?: boolean },
  ): Promise<PublicScene> {
    this.requireAdmin(actor);
    const row = await this.scenes.findOneBy({ id });
    if (!row) {
      throw new SceneSystemFailure("NOT_FOUND", "场景不存在", 404);
    }
    const before = this.toSceneView(row);
    if (input.name !== undefined) row.name = input.name.trim();
    if (input.description !== undefined) {
      row.description = input.description.trim();
    }
    if (input.enabled !== undefined) row.enabled = input.enabled;
    const saved = await this.scenes.save(row);
    await this.audit.record(
      this.scenes.manager,
      actor,
      "scene_update",
      { id: saved.id, name: saved.name },
      `更新场景「${saved.name}」`,
      { id: before.id, name: before.name, enabled: before.enabled },
      { id: saved.id, name: saved.name, enabled: saved.enabled },
    );
    return this.toSceneView(saved);
  }

  async deleteScene(actor: PublicUser, id: string): Promise<{ deleted: boolean }> {
    this.requireAdmin(actor);
    const row = await this.scenes.findOneBy({ id });
    if (!row) {
      throw new SceneSystemFailure("NOT_FOUND", "场景不存在", 404);
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
        `该场景被 ${usedBy} 个场景库引用，请先从场景库移除后再删除`,
        409,
      );
    }
    await this.scenes.delete({ id });
    await this.audit.record(
      this.scenes.manager,
      actor,
      "scene_delete",
      { id: row.id, name: row.name },
      `删除场景「${row.name}」`,
      { id: row.id, name: row.name },
      null,
    );
    return { deleted: true };
  }

  // ---------- 场景库（只读；写操作已废弃，统一由 scene-guide 数采自建） ----------

  /** 场景库列表（hydrate 类别名与子场景详情） */
  async listLibrary(): Promise<PublicSceneLibrary[]> {
    const rows = await this.library.find({
      order: { createdAt: "DESC" },
    });
    return this.hydrateLibraries(rows);
  }

  /** 按 id 查单个场景库条目 */
  async getLibraryById(id: string): Promise<PublicSceneLibrary | null> {
    const row = await this.library.findOneBy({ id });
    if (!row) return null;
    const [hydrated] = await this.hydrateLibraries([row]);
    return hydrated ?? null;
  }

  private async hydrateLibraries(
    rows: SceneLibraryEntity[],
  ): Promise<PublicSceneLibrary[]> {
    const [scenes, pricingRows] = await Promise.all([
      this.scenes.find(),
      this.pricing.find(),
    ]);
    const sceneById = new Map(scenes.map((item) => [item.id, item]));
    const pricingByKey = new Map(
      pricingRows.map((item) => [item.categoryKey, item]),
    );
    return rows.map((row) => {
      const categoryName =
        pricingByKey.get(row.categoryKey)?.name ?? row.categoryKey;
      return {
        id: row.id,
        name: row.name,
        categoryKey: row.categoryKey,
        categoryName,
        subScenes: row.subSceneIds
          .map((id) => sceneById.get(id))
          .filter((item): item is SceneEntity => Boolean(item))
          .map((item) => ({
            id: item.id,
            name: item.name,
            categoryKey: item.categoryKey,
          })),
        subSceneIds: row.subSceneIds,
        description: row.description,
        enabled: row.enabled,
        createdByName: row.createdByName,
        updatedAt: row.updatedAt.getTime(),
      };
    });
  }

  // ---------- 场景存量（两层任务体系第一层；PR-4 中改为按 scene_id 归口） ----------

  /**
   * 各场景的存量/目标/缺口。
   * 存量 = 该场景下质检合格提交的有效时长（可计费时长）；
   * 目标 = 该场景下所有 scene_type 任务的目标时长之和；
   * 缺口 = max(0, 目标 − 当前存量)。用于场景存量均衡看板。
   */
  async sceneInventory(): Promise<{
    items: Array<{
      sceneName: string;
      type: "scene_type" | "measured";
      currentSeconds: number;
      targetSeconds: number;
      shortfallSeconds: number;
      taskCount: number;
    }>;
  }> {
    // 目标：按场景名分组 scene_type 任务的目标时长
    const targetRows = await this.dataSource.query<Array<{
      scene_name: string;
      target_seconds: string;
      task_count: string;
    }>>(
      `SELECT scene_name,
              COALESCE(SUM(target_duration_seconds), 0)::float AS target_seconds,
              COUNT(*)::int AS task_count
         FROM collection_tasks
        WHERE task_type = 'scene_type' AND target_duration_seconds IS NOT NULL
        GROUP BY scene_name`,
    );

    // 存量：按提交快照场景名分组合格提交的有效时长（与计费同口径）
    const stockRows = await this.dataSource.query<Array<{
      scene_name: string;
      current_ms: string;
    }>>(
      `SELECT COALESCE(submission.task_scene_name, task.scene_name, '') AS scene_name,
              COALESCE(SUM(
                COALESCE(quality.manual_billable_duration_ms, quality.billable_duration_ms, 0)
              ), 0)::float AS current_ms
         FROM submissions submission
         LEFT JOIN collection_tasks task ON task.id = submission.task_id
         LEFT JOIN video_quality_results quality ON quality.submission_id = submission.id
        WHERE quality.passed = true
          AND quality.status IN ('scored', 'review_pending')
        GROUP BY 1`,
    );

    const stockMap = new Map(
      stockRows.map((row) => [
        row.scene_name,
        Number(row.current_ms) || 0,
      ]),
    );
    const sceneSet = new Set<string>([
      ...targetRows.map((row) => row.scene_name),
      ...stockMap.keys(),
    ]);

    const items = [...sceneSet].map((sceneName) => {
      const currentMs = stockMap.get(sceneName) ?? 0;
      const targetRow = targetRows.find((row) => row.scene_name === sceneName);
      const targetSeconds = Number(targetRow?.target_seconds) || 0;
      const currentSeconds = currentMs / 1000;
      return {
        sceneName,
        type: targetRow ? ("scene_type" as const) : ("measured" as const),
        currentSeconds: Math.round(currentSeconds),
        targetSeconds: Math.round(targetSeconds),
        shortfallSeconds: Math.max(0, Math.round(targetSeconds - currentSeconds)),
        taskCount: Number(targetRow?.task_count) || 0,
      };
    });
    items.sort((left, right) => right.shortfallSeconds - left.shortfallSeconds);
    return { items };
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
