import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository, type EntityManager } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import {
  PublicSiteSnapshotEntity,
  type PublicSiteScene,
  type PublicSiteTrendPoint,
} from "../database/entities/public-site-snapshot.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import { IdentityFailure } from "../identity/identity.policy.js";
import type { UpdatePublicSiteConfigDto } from "./dto/public-site-config.dto.js";

const PUBLIC_SITE_LOCK_KEY = 7_326_195_424;
const DEFAULT_PRIMARY_SCENE = "真实操作数据";
const DEFAULT_PRIMARY_DESCRIPTION = "由已通过质检的视频聚合生成";
const DEFAULT_CTA_COPY = "为你的具身智能项目准备下一批高质量数据";
const SCENE_LABELS: Record<string, string> = {
  kitchen: "家庭厨房",
  scene: "桌面整理",
};
const QUALITY_EFFECTIVE_PASSED_SQL = `
  CASE
    WHEN quality.passed IS NOT NULL THEN quality.passed
    WHEN quality.status = 'review_pending' AND quality.manualFinalScore IS NULL
      THEN NULL
    WHEN COALESCE(quality.manualFinalScore, quality.finalScore) IS NULL
      THEN NULL
    ELSE COALESCE(quality.manualFinalScore, quality.finalScore) >= COALESCE(
      (quality.qualityRuleSnapshot ->> 'passThreshold')::numeric,
      60
    )
  END
`;
const QUALITY_PASSED_SQL = `(${QUALITY_EFFECTIVE_PASSED_SQL}) IS TRUE`;

export type PublicSiteSnapshot = {
  id: string;
  revision: number;
  snapshotDate: string;
  generatedByName: string;
  generatedAt: number;
  metrics: {
    deliverableVideoCount: number;
    effectiveDurationSeconds: number;
    sceneCount: number;
    qualityPassRate: number;
  };
  config: {
    primarySceneName: string;
    primarySceneDescription: string;
    ctaCopy: string;
  };
  sceneBreakdown: PublicSiteScene[];
  trend: PublicSiteTrendPoint[];
};

type AggregateRow = {
  deliverable_count: string | number | null;
  effective_duration_seconds: string | number | null;
  quality_pass_rate: string | number | null;
};

type SceneRow = {
  scene_id: string | null;
  scene_summary: string | null;
  video_count: string | number;
};

type TrendRow = {
  label: string;
  video_count: string | number;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number, digits: number): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function publicSnapshot(snapshot: PublicSiteSnapshotEntity): PublicSiteSnapshot {
  return {
    id: snapshot.id,
    revision: snapshot.revision,
    snapshotDate: snapshot.snapshotDate,
    generatedByName: snapshot.generatedByName,
    generatedAt: snapshot.createdAt.getTime(),
    metrics: {
      deliverableVideoCount: snapshot.deliverableVideoCount,
      effectiveDurationSeconds: Number(snapshot.effectiveDurationSeconds),
      sceneCount: snapshot.sceneCount,
      qualityPassRate: Number(snapshot.qualityPassRate),
    },
    config: {
      primarySceneName: snapshot.primarySceneName,
      primarySceneDescription: snapshot.primarySceneDescription,
      ctaCopy: snapshot.ctaCopy,
    },
    sceneBreakdown: snapshot.sceneBreakdown,
    trend: snapshot.trend,
  };
}

@Injectable()
export class PublicSiteService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PublicSiteSnapshotEntity)
    private readonly snapshots: Repository<PublicSiteSnapshotEntity>,
    private readonly audit: AuditService,
  ) {}

  async getSnapshot(): Promise<PublicSiteSnapshot> {
    const active = await this.snapshots.findOne({
      where: { active: true },
      order: { createdAt: "DESC" },
    });
    if (active) return publicSnapshot(active);
    return this.createSnapshot(null, {
      primarySceneName: DEFAULT_PRIMARY_SCENE,
      primarySceneDescription: DEFAULT_PRIMARY_DESCRIPTION,
      ctaCopy: DEFAULT_CTA_COPY,
    });
  }

  async refreshSnapshot(
    actor: PublicUser,
    input: UpdatePublicSiteConfigDto,
  ): Promise<PublicSiteSnapshot> {
    this.requireAdmin(actor);
    const normalized = {
      ctaCopy: input.ctaCopy.trim(),
      // 主推场景由后台按最高频场景自动生成，忽略客户端传入值
      primarySceneName: "",
      primarySceneDescription: "",
    };
    if (!normalized.ctaCopy) {
      throw new IdentityFailure("VALIDATION", "请填写商务联系文案", 400);
    }
    return this.createSnapshot(actor, normalized);
  }

  private async createSnapshot(
    actor: PublicUser | null,
    config: UpdatePublicSiteConfigDto,
  ): Promise<PublicSiteSnapshot> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        PUBLIC_SITE_LOCK_KEY,
      ]);
      const repository = manager.getRepository(PublicSiteSnapshotEntity);
      const current = await repository.findOne({
        where: { active: true },
        lock: { mode: "pessimistic_write" },
        order: { revision: "DESC" },
      });
      const aggregate = await this.aggregateMetrics(manager);
      const scenes = await this.aggregateScenes(manager, aggregate.count);
      const trend = await this.aggregateTrend(manager);
      // 主推场景自动取后台最高频场景（与公开首页保持一致），无数据时用默认文案
      const primaryScene = scenes[0];
      const primarySceneName =
        primaryScene?.name ?? DEFAULT_PRIMARY_SCENE;
      const primarySceneDescription =
        primaryScene?.description ?? DEFAULT_PRIMARY_DESCRIPTION;

      if (current) {
        current.active = false;
        await repository.save(current);
      }
      const next = await repository.save({
        id: `PSS-${randomUUID()}`,
        revision: (current?.revision ?? 0) + 1,
        snapshotDate: todayIsoDate(),
        active: true,
        deliverableVideoCount: aggregate.count,
        effectiveDurationSeconds: String(aggregate.effectiveDurationSeconds),
        sceneCount: aggregate.sceneCount,
        qualityPassRate: aggregate.qualityPassRate.toFixed(2),
        primarySceneName,
        primarySceneDescription,
        ctaCopy: config.ctaCopy,
        sceneBreakdown: scenes,
        trend,
        generatedByAccountId: actor?.id ?? null,
        generatedByName: actor?.displayName ?? "系统初始化",
      });
      if (actor) {
        await this.audit.record(
          manager,
          actor,
          "public_site_snapshot_publish",
          { id: next.id, name: next.snapshotDate },
          `发布公开官网脱敏快照 V${next.revision}`,
          current
            ? {
                revision: current.revision,
                deliverableVideoCount: current.deliverableVideoCount,
                effectiveDurationSeconds: Number(
                  current.effectiveDurationSeconds,
                ),
                qualityPassRate: Number(current.qualityPassRate),
              }
            : null,
          {
            revision: next.revision,
            deliverableVideoCount: next.deliverableVideoCount,
            effectiveDurationSeconds: Number(next.effectiveDurationSeconds),
            qualityPassRate: Number(next.qualityPassRate),
          },
        );
      }
      return publicSnapshot(next);
    });
  }

  private async aggregateMetrics(
    manager: EntityManager,
  ): Promise<{
    count: number;
    effectiveDurationSeconds: number;
    qualityPassRate: number;
    sceneCount: number;
  }> {
    const aggregate = await manager
      .getRepository(SubmissionEntity)
      .createQueryBuilder("submission")
      .select(
        `
        SUM(
          CASE
            WHEN ${QUALITY_PASSED_SQL}
            THEN 1
            ELSE 0
          END
        )
        `,
        "deliverable_count",
      )
      .addSelect(
        `
        COALESCE(
          SUM(
            CASE
              WHEN ${QUALITY_PASSED_SQL}
              THEN COALESCE(
                (quality.manualBillableDurationMs)::numeric,
                (quality.billableDurationMs)::numeric,
                GREATEST(
                  COALESCE((metadata.durationSeconds)::numeric * 1000, 0) -
                    COALESCE(
                      (quality.manualInvalidDurationMs)::numeric,
                      (quality.invalidDurationMs)::numeric,
                      0
                    ),
                  0
                )
              )
              ELSE 0
            END
          ),
          0
        ) / 1000
        `,
        "effective_duration_seconds",
      )
      .addSelect(
        `
        CASE
          WHEN COUNT(*) FILTER (
            WHERE (${QUALITY_EFFECTIVE_PASSED_SQL}) IS NOT NULL
          ) = 0 THEN 0
          ELSE
            SUM(
              CASE
                WHEN ${QUALITY_PASSED_SQL}
                THEN 1
                ELSE 0
              END
            )::numeric / COUNT(*) FILTER (
              WHERE (${QUALITY_EFFECTIVE_PASSED_SQL}) IS NOT NULL
            )::numeric * 100
        END
        `,
        "quality_pass_rate",
      )
      .innerJoin(
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .leftJoin(
        MediaMetadataEntity,
        "metadata",
        "metadata.submissionId = submission.id",
      )
      .where("submission.processingStatus = :completed", {
        completed: "completed",
      })
      .andWhere("submission.assetStatus = :activeAsset", {
        activeAsset: "active",
      })
      .andWhere("submission.storageStatus = :availableStorage", {
        availableStorage: "available",
      })
      .andWhere("quality.status IN (:...statuses)", {
        statuses: ["scored", "review_pending"],
      })
      .getRawOne<AggregateRow>();
    const sceneRows = await this.sceneRows(manager);
    return {
      count: Math.trunc(numberValue(aggregate?.deliverable_count)),
      effectiveDurationSeconds: Math.round(
        numberValue(aggregate?.effective_duration_seconds),
      ),
      qualityPassRate: round(numberValue(aggregate?.quality_pass_rate), 2),
      sceneCount: sceneRows.length,
    };
  }

  private async aggregateScenes(
    manager: EntityManager,
    totalCount: number,
  ): Promise<PublicSiteScene[]> {
    const rows = await this.sceneRows(manager);
    if (rows.length === 0) {
      return [
        {
          name: DEFAULT_PRIMARY_SCENE,
          description: "等待更多通过质检的视频形成公开场景分布",
          videoCount: 0,
          share: 0,
        },
      ];
    }
    return rows.slice(0, 4).map((row) => {
      const videoCount = Math.trunc(numberValue(row.video_count));
      const sceneId = row.scene_id?.trim() ?? "";
      const summary = row.scene_summary?.trim() ?? "";
      const name = SCENE_LABELS[sceneId] ?? (summary || sceneId || "未命名场景");
      return {
        name,
        description: summary || "已通过质检的视频场景",
        videoCount,
        share:
          totalCount === 0
            ? 0
            : round((videoCount / Math.max(totalCount, 1)) * 100, 1),
      };
    });
  }

  private async sceneRows(
    manager: EntityManager,
  ): Promise<SceneRow[]> {
    return manager
      .getRepository(SubmissionEntity)
      .createQueryBuilder("submission")
      .select(
        "COALESCE(quality.normalizedResult #>> '{detectedTask,scene_id}', '')",
        "scene_id",
      )
      .addSelect(
        "COALESCE(quality.normalizedResult #>> '{detectedTask,task_summary}', '')",
        "scene_summary",
      )
      .addSelect("COUNT(*)", "video_count")
      .innerJoin(
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .where("submission.processingStatus = :completed", {
        completed: "completed",
      })
      .andWhere("submission.assetStatus = :activeAsset", {
        activeAsset: "active",
      })
      .andWhere("submission.storageStatus = :availableStorage", {
        availableStorage: "available",
      })
      .andWhere("quality.status IN (:...statuses)", {
        statuses: ["scored", "review_pending"],
      })
      .andWhere(QUALITY_PASSED_SQL)
      .groupBy("scene_id")
      .addGroupBy("scene_summary")
      .orderBy("video_count", "DESC")
      .addOrderBy("scene_summary", "ASC")
      .limit(12)
      .getRawMany<SceneRow>();
  }

  private async aggregateTrend(
    manager: EntityManager,
  ): Promise<PublicSiteTrendPoint[]> {
    const rows = await manager
      .getRepository(SubmissionEntity)
      .createQueryBuilder("submission")
      .select("to_char(date_trunc('day', submission.createdAt), 'MM-DD')", "label")
      .addSelect("COUNT(*)", "video_count")
      .innerJoin(
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .where("submission.processingStatus = :completed", {
        completed: "completed",
      })
      .andWhere("submission.assetStatus = :activeAsset", {
        activeAsset: "active",
      })
      .andWhere("submission.storageStatus = :availableStorage", {
        availableStorage: "available",
      })
      .andWhere("quality.status IN (:...statuses)", {
        statuses: ["scored", "review_pending"],
      })
      .andWhere(QUALITY_PASSED_SQL)
      .groupBy("date_trunc('day', submission.createdAt)")
      .orderBy("date_trunc('day', submission.createdAt)", "DESC")
      .limit(12)
      .getRawMany<TrendRow>();
    return rows
      .reverse()
      .map((row) => ({
        label: row.label,
        value: Math.trunc(numberValue(row.video_count)),
      }));
  }

  private requireAdmin(actor: PublicUser): void {
    if (actor.status !== "active" || actor.role !== "admin") {
      throw new IdentityFailure("FORBIDDEN", "仅管理员可发布公开配置", 403);
    }
  }
}
