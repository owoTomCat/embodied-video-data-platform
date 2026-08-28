import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository, type EntityManager } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import { csvDocument } from "../csv/csv.js";
import { CollectionTaskEntity } from "../database/entities/collection-task.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { PointCycleAdjustmentEntity } from "../database/entities/point-cycle-adjustment.entity.js";
import { PointCycleEntity } from "../database/entities/point-cycle.entity.js";
import { PointCycleItemEntity } from "../database/entities/point-cycle-item.entity.js";
import { PointRuleVersionEntity } from "../database/entities/point-rule-version.entity.js";
import { QualityRuleVersionEntity } from "../database/entities/quality-rule-version.entity.js";
import { SubmissionDuplicateCandidateEntity } from "../database/entities/submission-duplicate-candidate.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import {
  pointRuleSnapshot,
  pointsForRule,
  settlementRatioForScore,
} from "../rules/rule-calculator.js";
import { loadLatestPointCycleAdjustments } from "./latest-point-cycle-adjustments.js";
import { AdjustPointCycleItemDto } from "./dto/point-cycle.dto.js";
import { PointCycleFailure } from "./point-cycle-failure.js";
import { PointCyclesPolicy } from "./point-cycles.policy.js";
import { PointRulesService } from "./point-rules.service.js";
import { WalletService } from "../wallet/wallet.service.js";

const POINT_CYCLE_THUMBNAIL_TTL_SECONDS = 10 * 60;
/** 锁定后自动结算天数（用户需求：锁定 3 天后自动结算） */
const SETTLE_AFTER_DAYS = 3;

type PointCycleThumbnail = {
  url: string;
  expiresAt: number;
  contentType: "image/jpeg";
};

/** 批量读取各提交的原始无效时长（人工覆盖优先，其次质检结果） */
async function loadInvalidDurationBySubmission(
  manager: EntityManager,
  submissionIds: string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(submissionIds)];
  if (unique.length === 0) return new Map();
  const rows = await manager
    .getRepository(VideoQualityResultEntity)
    .createQueryBuilder("quality")
    .select([
      "quality.submissionId AS submission_id",
      "COALESCE(quality.manual_invalid_duration_ms, quality.invalid_duration_ms, 0) AS invalid_ms",
    ])
    .where("quality.submissionId IN (:...submissionIds)", { submissionIds: unique })
    .getRawMany<{ submission_id: string; invalid_ms: string | null }>();
  return new Map(
    rows.map((row) => [row.submission_id, Number(row.invalid_ms ?? 0)]),
  );
}

type Candidate = {
  submission: SubmissionEntity;
  quality: VideoQualityResultEntity;
  durationMs: number;
  finalScore: number;
  settlementRatio: number;
  invalidDurationMs: number;
  effectiveDurationMs: number;
  pointsPerMinute: number;
  points: number;
  taskName: string | null;
};

function decimal(value: number, digits: number): string {
  return value.toFixed(digits);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 上海时区的当天日期（自动锁定使用） */
function shanghaiIsoDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function pointCycleId(businessDate: string): string {
  const compactDate = businessDate.replaceAll("-", "");
  return `PC-${compactDate}-${randomUUID().slice(0, 8)}`;
}

function effectiveItemValues(
  item: PointCycleItemEntity,
  adjustment?: PointCycleAdjustmentEntity,
) {
  return {
    finalScore: Number(adjustment?.nextFinalScore ?? item.finalScore),
    settlementRatio: Number(
      adjustment?.nextSettlementRatio ?? item.settlementRatio,
    ),
    effectiveDurationMs: Number(
      adjustment?.nextEffectiveDurationMs ?? item.effectiveDurationMs,
    ),
    points: Number(adjustment?.nextPoints ?? item.points),
  };
}

function publicItem(
  item: PointCycleItemEntity,
  adjustment?: PointCycleAdjustmentEntity,
  invalidDurationMs?: number,
  thumbnail?: PointCycleThumbnail,
) {
  const effective = effectiveItemValues(item, adjustment);
  return {
    id: item.id,
    submissionId: item.submissionId,
    ownerId: item.ownerId,
    ownerName: item.ownerName,
    teamId: item.teamId,
    teamName: item.teamName,
    fileName: item.fileName,
    taskId: item.taskId,
    taskName: item.taskName,
    taskSceneName: item.taskSceneName,
    taskPricePointsPerMinute:
      item.taskPricePointsPerMinute === null ||
      item.taskPricePointsPerMinute === undefined
        ? null
        : Number(item.taskPricePointsPerMinute),
    finalScore: effective.finalScore,
    settlementRatio: effective.settlementRatio,
    effectiveDurationMs: effective.effectiveDurationMs,
    effectiveMinutes:
      Math.round((effective.effectiveDurationMs / 60_000) * 100) / 100,
    invalidDurationMs:
      adjustment?.nextInvalidDurationMs !== undefined
        ? Number(adjustment.nextInvalidDurationMs)
        : (invalidDurationMs ?? 0),
    pointsPerMinute: Number(item.pointsPerMinute),
    points: effective.points,
    qualityRevision: item.qualityRevision,
    qualityReviewedAt: item.qualityReviewedAt?.getTime(),
    adjusted: adjustment !== undefined,
    adjustedAt: adjustment?.createdAt.getTime(),
    ...(thumbnail ? { thumbnail } : {}),
  };
}

function publicCycle(
  cycle: PointCycleEntity,
  latestAdjustments = new Map<string, PointCycleAdjustmentEntity>(),
  invalidBySubmission = new Map<string, number>(),
  thumbnails = new Map<string, PointCycleThumbnail>(),
) {
  const items = cycle.items ?? [];
  const publicItems = items.map((item) =>
    publicItem(
      item,
      latestAdjustments.get(item.id),
      invalidBySubmission.get(item.submissionId),
      thumbnails.get(item.submissionId),
    ),
  );
  const visibleSubmissionCount = items.length;
  const visibleEffectiveDurationMs = publicItems.reduce(
    (total, item) => total + item.effectiveDurationMs,
    0,
  );
  const visibleTotalPoints =
    Math.round(
      publicItems.reduce((total, item) => total + item.points, 0) * 100,
    ) / 100;
  const effectiveDurationMs =
    visibleSubmissionCount > 0
      ? visibleEffectiveDurationMs
      : Number(cycle.effectiveDurationMs);
  return {
    id: cycle.id,
    businessDate: cycle.businessDate,
    status: cycle.status,
    submissionCount:
      visibleSubmissionCount > 0
        ? visibleSubmissionCount
        : cycle.submissionCount,
    effectiveDurationMs,
    effectiveMinutes:
      Math.round((effectiveDurationMs / 60_000) * 100) / 100,
    totalPoints:
      visibleSubmissionCount > 0
        ? visibleTotalPoints
        : Number(cycle.totalPoints),
    pointRuleVersionId: cycle.pointRuleVersionId,
    pointRuleRevision: cycle.pointRuleRevision,
    pointRuleSnapshot: cycle.pointRuleSnapshot,
    createdByAccountId: cycle.createdByAccountId,
    createdByName: cycle.createdByName,
    settleDueAt: cycle.settleDueAt?.getTime() ?? null,
    settledAt: cycle.settledAt?.getTime() ?? null,
    createdAt: cycle.createdAt.getTime(),
    items: publicItems,
  };
}

@Injectable()
export class PointCyclesService {
  constructor(
    @InjectRepository(PointCycleEntity)
    private readonly cycles: Repository<PointCycleEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    private readonly policy: PointCyclesPolicy,
    private readonly audit: AuditService,
    private readonly pointRules: PointRulesService,
    private readonly wallet: WalletService,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
  ) {}

  async preview(actor: PublicUser) {
    this.policy.requireCreate(actor);
    await this.pointRules.ensureDefault();
    const pointRule = await this.pointRules.getActiveForCalculation();
    const candidates = await this.loadCandidates(
      pointRule,
      this.dataSource.manager,
      false,
    );
    return this.publicPreview(candidates);
  }

  async list(actor: PublicUser) {
    this.policy.requireRead(actor);
    const query = this.cycles
      .createQueryBuilder("cycle")
      .leftJoinAndSelect("cycle.items", "item")
      .orderBy("cycle.createdAt", "DESC")
      .addOrderBy("item.teamName", "ASC")
      .addOrderBy("item.ownerName", "ASC")
      .addOrderBy("item.fileName", "ASC");
    if (actor.role === "leader") {
      query.andWhere("item.teamId = :teamId", { teamId: actor.teamId });
    } else if (actor.role === "collector") {
      query.andWhere("item.ownerId = :ownerId", { ownerId: actor.id });
    }
    const cycles = await query.getMany();
    const latestAdjustments = await loadLatestPointCycleAdjustments(
      this.dataSource.manager,
      cycles.flatMap((cycle) => (cycle.items ?? []).map((item) => item.id)),
    );
    const invalidBySubmission = await loadInvalidDurationBySubmission(
      this.dataSource.manager,
      cycles.flatMap((cycle) =>
        (cycle.items ?? []).map((item) => item.submissionId),
      ),
    );
    return Promise.all(
      cycles.map((cycle) =>
        this.withThumbnails(cycle, latestAdjustments, invalidBySubmission),
      ),
    );
  }

  async get(actor: PublicUser, id: string) {
    this.policy.requireRead(actor);
    const query = this.cycles
      .createQueryBuilder("cycle")
      .leftJoinAndSelect("cycle.items", "item")
      .where("cycle.id = :id", { id })
      .orderBy("item.teamName", "ASC")
      .addOrderBy("item.ownerName", "ASC")
      .addOrderBy("item.fileName", "ASC");
    if (actor.role === "leader") {
      query.andWhere("item.teamId = :teamId", { teamId: actor.teamId });
    } else if (actor.role === "collector") {
      query.andWhere("item.ownerId = :ownerId", { ownerId: actor.id });
    }
    const cycle = await query.getOne();
    if (!cycle || (cycle.items ?? []).length === 0) {
      throw new PointCycleFailure("NOT_FOUND", "积分周期不存在", 404);
    }
    const latestAdjustments = await loadLatestPointCycleAdjustments(
      this.dataSource.manager,
      (cycle.items ?? []).map((item) => item.id),
    );
    const invalidBySubmission = await loadInvalidDurationBySubmission(
      this.dataSource.manager,
      (cycle.items ?? []).map((item) => item.submissionId),
    );
    return this.withThumbnails(cycle, latestAdjustments, invalidBySubmission);
  }

  async exportCsv(actor: PublicUser, id: string): Promise<string> {
    const cycle = await this.get(actor, id);
    const rows = [
      [
        "cycle_id",
        "business_date",
        "submission_id",
        "file_name",
        "team_id",
        "team_name",
        "owner_id",
        "owner_name",
        "task_id",
        "task_name",
        "task_scene_name",
        "final_score",
        "settlement_ratio",
        "effective_minutes",
        "points_per_minute",
        "points",
        "quality_revision",
        "quality_reviewed_at",
      ],
      ...cycle.items.map((item) => [
        cycle.id,
        cycle.businessDate,
        item.submissionId,
        item.fileName,
        item.teamId,
        item.teamName,
        item.ownerId,
        item.ownerName,
        item.taskId ?? "",
        item.taskName ?? "",
        item.taskSceneName ?? "",
        item.finalScore.toFixed(1),
        item.settlementRatio.toFixed(4),
        item.effectiveMinutes.toFixed(2),
        item.pointsPerMinute.toFixed(4),
        item.points.toFixed(2),
        item.qualityRevision,
        item.qualityReviewedAt
          ? new Date(item.qualityReviewedAt).toISOString()
          : "",
      ]),
    ];
    return csvDocument(rows);
  }

  /**
   * 对已锁定周期中的单个视频条目进行人工积分调整。
   * 管理员可调整最终评分和/或无效时长；结算系数与积分由服务端按周期快照规则重算，
   * 调整记录完整保留 before/after 快照并写入审计。
   */
  async adjustItem(
    actor: PublicUser,
    cycleId: string,
    itemId: string,
    input: AdjustPointCycleItemDto,
  ) {
    this.policy.requireCreate(actor);
    const reason = input.reason.trim();
    if (!reason) {
      throw new PointCycleFailure("VALIDATION", "请填写调整原因", 400);
    }
    return this.dataSource.transaction(async (manager) => {
      const cycle = await manager.getRepository(PointCycleEntity).findOne({
        where: { id: cycleId },
        lock: { mode: "pessimistic_write" },
      });
      if (!cycle) {
        throw new PointCycleFailure("NOT_FOUND", "积分周期不存在", 404);
      }
      // 周期一旦锁定即为最终结算依据，锁定/已结算后的条目不允许再编辑
      if (cycle.status === "locked" || cycle.status === "settled") {
        throw new PointCycleFailure(
          "CYCLE_LOCKED",
          "周期已锁定，锁定后的条目不允许编辑；如需纠错请在下次锁定前处理",
          409,
        );
      }
      const item = await manager.getRepository(PointCycleItemEntity).findOne({
        where: { id: itemId, cycleId },
        lock: { mode: "pessimistic_write" },
      });
      if (!item) {
        throw new PointCycleFailure("NOT_FOUND", "周期条目不存在", 404);
      }
      const quality = await manager
        .getRepository(VideoQualityResultEntity)
        .findOne({ where: { submissionId: item.submissionId } });
      if (!quality) {
        throw new PointCycleFailure(
          "VALIDATION",
          "该条目的质检结果不存在，无法调整",
          409,
        );
      }

      const adjustments = await loadLatestPointCycleAdjustments(manager, [
        itemId,
      ]);
      const latest = adjustments.get(itemId);
      const previous = effectiveItemValues(item, latest);
      const previousInvalidMs = Number(
        latest?.nextInvalidDurationMs ??
          quality.manualInvalidDurationMs ??
          quality.invalidDurationMs ??
          0,
      );
      const durationMs = previous.effectiveDurationMs + previousInvalidMs;

      const nextFinalScore =
        input.nextFinalScore === undefined
          ? previous.finalScore
          : input.nextFinalScore;
      const nextInvalidMs =
        input.nextInvalidDurationMs === undefined
          ? previousInvalidMs
          : input.nextInvalidDurationMs;
      if (nextInvalidMs > durationMs) {
        throw new PointCycleFailure(
          "VALIDATION",
          `无效时长（${Math.round(nextInvalidMs / 1_000)} 秒）不能超过视频总时长（${Math.round(durationMs / 1_000)} 秒）`,
          400,
        );
      }
      const nextEffectiveMs = Math.max(0, durationMs - nextInvalidMs);

      if (
        nextFinalScore === previous.finalScore &&
        nextInvalidMs === previousInvalidMs
      ) {
        throw new PointCycleFailure(
          "VALIDATION",
          "评分与无效时长均未变化，无需调整",
          400,
        );
      }

      const passThreshold = Number(
        quality.qualityRuleSnapshot?.passThreshold ?? 60,
      );
      const nextRatio = settlementRatioForScore({
        score: nextFinalScore,
        passThreshold,
        coefficientBands: cycle.pointRuleSnapshot?.coefficientBands ?? [],
      });
      const nextPoints = pointsForRule({
        pointsPerMinute: Number(item.pointsPerMinute),
        effectiveDurationMs: nextEffectiveMs,
        settlementRatio: nextRatio,
      });
      const previousPoints = Number(previous.points);

      const adjustment = await manager
        .getRepository(PointCycleAdjustmentEntity)
        .save({
          id: `PCA-${randomUUID()}`,
          pointCycleItemId: itemId,
          submissionId: item.submissionId,
          previousFinalScore: decimal(previous.finalScore, 1),
          nextFinalScore: decimal(nextFinalScore, 1),
          previousSettlementRatio: decimal(previous.settlementRatio, 4),
          nextSettlementRatio: decimal(nextRatio, 4),
          previousInvalidDurationMs: String(previousInvalidMs),
          nextInvalidDurationMs: String(nextInvalidMs),
          previousEffectiveDurationMs: String(previous.effectiveDurationMs),
          nextEffectiveDurationMs: String(nextEffectiveMs),
          previousPoints: decimal(previousPoints, 2),
          nextPoints: decimal(nextPoints, 2),
          pointsDelta: decimal(nextPoints - previousPoints, 2),
          reason,
          createdByAccountId: actor.id,
          createdByName: actor.displayName,
        });

      await this.audit.record(
        manager,
        actor,
        "point_cycle_adjust",
        { id: cycle.id, name: cycle.businessDate },
        `调整周期 ${cycle.businessDate} 条目「${item.fileName}」积分：${decimal(previousPoints, 2)} → ${decimal(nextPoints, 2)}`,
        {
          submissionId: item.submissionId,
          previousFinalScore: previous.finalScore,
          previousPoints: previousPoints,
        },
        {
          submissionId: item.submissionId,
          nextFinalScore,
          nextPoints,
          reason,
        },
      );

      const reloaded = await manager
        .getRepository(PointCycleEntity)
        .createQueryBuilder("cycle")
        .leftJoinAndSelect("cycle.items", "item")
        .where("cycle.id = :cycleId", { cycleId })
        .orderBy("item.teamName", "ASC")
        .addOrderBy("item.ownerName", "ASC")
        .addOrderBy("item.fileName", "ASC")
        .getOneOrFail();
      const allAdjustments = await loadLatestPointCycleAdjustments(
        manager,
        (reloaded.items ?? []).map((entry) => entry.id),
      );
      const invalidBySubmission = await loadInvalidDurationBySubmission(
        manager,
        (reloaded.items ?? []).map((entry) => entry.submissionId),
      );
      void adjustment;
      return this.withThumbnails(
        reloaded,
        allAdjustments,
        invalidBySubmission,
        manager,
      );
    });
  }

  async create(actor: PublicUser, businessDate = todayIsoDate()) {
    this.policy.requireCreate(actor);
    await this.pointRules.ensureDefault();
    return this.dataSource.transaction(async (manager) => {
      const pointRule = await this.pointRules.getActiveForCalculation(
        manager,
        true,
      );
      const candidates = await this.loadCandidates(pointRule, manager, true);
      if (candidates.length === 0) {
        throw new PointCycleFailure(
          "NO_ELIGIBLE_SUBMISSIONS",
          "当前没有可锁定积分数据",
          409,
        );
      }
      const totals = this.summarize(candidates);
      const cycleId = pointCycleId(businessDate);
      const settleDueAt = new Date(Date.now() + SETTLE_AFTER_DAYS * 24 * 60 * 60 * 1_000);
      const cycle = await manager.getRepository(PointCycleEntity).save({
        id: cycleId,
        businessDate,
        status: "locked",
        submissionCount: totals.count,
        effectiveDurationMs: String(totals.effectiveDurationMs),
        totalPoints: decimal(totals.points, 2),
        pointRuleVersionId: pointRule.id,
        pointRuleRevision: pointRule.revision,
        pointRuleSnapshot: pointRuleSnapshot({
          ...pointRule,
          defaultPointsPerMinute: Number(pointRule.defaultPointsPerMinute),
        }),
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
        settleDueAt,
      });
      await manager.getRepository(PointCycleItemEntity).save(
        candidates.map((candidate) => ({
          id: `PCI-${randomUUID()}`,
          cycleId,
          submissionId: candidate.submission.id,
          ownerId: candidate.submission.ownerId,
          ownerName: candidate.submission.owner?.displayName ?? "",
          teamId: candidate.submission.teamId,
          teamName: candidate.submission.team?.name ?? "",
          fileName: candidate.submission.originalFileName,
          taskId: candidate.submission.taskId,
          taskName: candidate.taskName,
          taskSceneName: candidate.submission.taskSceneName,
          taskPricePointsPerMinute: candidate.submission.taskPricePointsPerMinute,
          finalScore: decimal(candidate.finalScore, 1),
          settlementRatio: decimal(candidate.settlementRatio, 4),
          effectiveDurationMs: String(candidate.effectiveDurationMs),
          pointsPerMinute: decimal(candidate.pointsPerMinute, 4),
          points: decimal(candidate.points, 2),
          qualityRevision: candidate.quality.reviewRevision,
          qualityReviewedAt: candidate.quality.manualReviewedAt,
        })),
      );
      // 锁定即入钱包「结算中」：按数采人员汇总金额（1 积分 = 1 元占位，定价规则后续再定）
      const amountsByOwner = new Map<string, number>();
      for (const candidate of candidates) {
        amountsByOwner.set(
          candidate.submission.ownerId,
          (amountsByOwner.get(candidate.submission.ownerId) ?? 0) + candidate.points,
        );
      }
      for (const [ownerId, amount] of amountsByOwner) {
        await this.wallet.creditSettling(manager, {
          ownerId,
          amount,
          cycleId,
          createdByAccountId: actor.id,
          remark: `周期 ${businessDate} 锁定`,
        });
      }
      await this.audit.record(
        manager,
        actor,
        "point_cycle_lock",
        { id: cycle.id, name: cycle.businessDate },
        `锁定 ${totals.count} 条合格数据，合计 ${decimal(totals.points, 2)} 分`,
        null,
        {
          submissionCount: totals.count,
          effectiveDurationMs: totals.effectiveDurationMs,
          totalPoints: totals.points,
        },
      );
      const locked = await manager
        .getRepository(PointCycleEntity)
        .createQueryBuilder("cycle")
        .leftJoinAndSelect("cycle.items", "item")
        .where("cycle.id = :cycleId", { cycleId })
        .orderBy("item.teamName", "ASC")
        .addOrderBy("item.ownerName", "ASC")
        .addOrderBy("item.fileName", "ASC")
        .getOneOrFail();
      const invalidBySubmission = await loadInvalidDurationBySubmission(
        manager,
        (locked.items ?? []).map((entry) => entry.submissionId),
      );
      return this.withThumbnails(
        locked,
        undefined,
        invalidBySubmission,
        manager,
      );
    });
  }

  /**
   * 结算到期周期：把「结算中」金额转入「可提现」，周期标记为已结算。
   * 由定时任务调用（也可手动触发单个周期结算）。
   */
  async settleDueCycles(now = new Date()): Promise<number> {
    const due = await this.cycles
      .createQueryBuilder("cycle")
      .where("cycle.status = :locked", { locked: "locked" })
      .andWhere("cycle.settle_due_at IS NOT NULL")
      .andWhere("cycle.settle_due_at <= :now", { now })
      .select("cycle.id", "id")
      .getRawMany<{ id: string }>();
    let settled = 0;
    for (const row of due) {
      try {
        await this.settleCycle(row.id, now);
        settled += 1;
      } catch {
        // 单个周期结算失败不影响其他周期，下次扫描重试
      }
    }
    return settled;
  }

  /** 结算单个周期（幂等：已结算直接返回当前状态） */
  async settleCycle(
    cycleId: string,
    now = new Date(),
    actor?: PublicUser,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(PointCycleEntity);
      const cycle = await repository.findOne({
        where: { id: cycleId },
        lock: { mode: "pessimistic_write" },
      });
      if (!cycle) {
        throw new PointCycleFailure("NOT_FOUND", "积分周期不存在", 404);
      }
      if (cycle.status === "settled") return { cycle, already: true };
      if (cycle.status !== "locked") {
        throw new PointCycleFailure(
          "CYCLE_NOT_SETTLABLE",
          "只有锁定中的周期可以结算",
          409,
        );
      }
      const items = await manager
        .getRepository(PointCycleItemEntity)
        .findBy({ cycleId });
      const byOwner = new Map<string, number>();
      for (const item of items) {
        byOwner.set(
          item.ownerId,
          (byOwner.get(item.ownerId) ?? 0) + Number(item.points),
        );
      }
      for (const [ownerId, amount] of byOwner) {
        await this.wallet.settleToAvailable(manager, {
          ownerId,
          amount,
          cycleId,
          remark: `周期 ${cycle.businessDate} 结算`,
        });
      }
      cycle.status = "settled";
      cycle.settledAt = now;
      await repository.save(cycle);
      if (actor) {
        await this.audit.record(
          manager,
          actor,
          "point_cycle_settle",
          { id: cycle.id, name: cycle.businessDate },
          `结算周期 ${cycle.businessDate}：${byOwner.size} 位数采钱包转入可提现，合计 ${decimal(
            [...byOwner.values()].reduce((sum, value) => sum + value, 0),
            2,
          )} 元`,
          null,
          { settledAt: now.toISOString() },
        );
      }
      return { cycle, already: false };
    });
    return this.get(actor ?? this.systemActor(), cycleId);
  }

  /**
   * 每天凌晨 2 点（上海时区）自动锁定当日合格数据；
   * 当天已锁定或无合格数据时跳过。由定时任务调用。
   */
  async autoLockDue(now = new Date()): Promise<boolean> {
    const businessDate = shanghaiIsoDate(now);
    const existing = await this.cycles.findOneBy({ businessDate });
    if (existing) return false;
    const admin = await this.users.findOne({
      where: { role: "admin", status: "active" },
      order: { createdAt: "ASC" },
    });
    if (!admin) return false;
    try {
      await this.create(this.systemActor(admin), businessDate);
      return true;
    } catch (error) {
      if (
        error instanceof PointCycleFailure &&
        error.code === "NO_ELIGIBLE_SUBMISSIONS"
      ) {
        return false;
      }
      throw error;
    }
  }

  private systemActor(admin?: UserEntity): PublicUser {
    if (admin) {
      return {
        id: admin.id,
        displayName: admin.displayName,
        username: admin.username,
        role: admin.role,
        teamId: admin.teamId ?? undefined,
        status: admin.status,
        updatedAt: admin.updatedAt.getTime(),
      };
    }
    return {
      id: "system",
      displayName: "系统定时任务",
      username: "system",
      role: "admin",
      status: "active",
      updatedAt: 0,
    };
  }

  private async withThumbnails(
    cycle: PointCycleEntity,
    latestAdjustments = new Map<string, PointCycleAdjustmentEntity>(),
    invalidBySubmission = new Map<string, number>(),
    manager: EntityManager = this.dataSource.manager,
  ) {
    const submissionIds = (cycle.items ?? []).map((item) => item.submissionId);
    const metadata = submissionIds.length
      ? await manager
          .getRepository(MediaMetadataEntity)
          .findBy({ submissionId: In([...new Set(submissionIds)]) })
      : [];
    const thumbnails = new Map<string, PointCycleThumbnail>();
    await Promise.all(
      metadata.map(async (item) => {
        if (!item.thumbnailObjectKey) return;
        try {
          const signed = await this.storage.presignDownloadObject({
            objectKey: item.thumbnailObjectKey,
            expiresInSeconds: POINT_CYCLE_THUMBNAIL_TTL_SECONDS,
          });
          thumbnails.set(item.submissionId, {
            url: signed.url,
            expiresAt: signed.expiresAt.getTime(),
            contentType: "image/jpeg",
          });
        } catch {
          // 单个缩略图不可用时保留条目文字信息，不阻断整个周期明细。
        }
      }),
    );
    return publicCycle(
      cycle,
      latestAdjustments,
      invalidBySubmission,
      thumbnails,
    );
  }

  private async loadCandidates(
    pointRule: PointRuleVersionEntity,
    manager: EntityManager = this.dataSource.manager,
    lock = false,
  ): Promise<Candidate[]> {
    let lockedIds: string[] | null = null;
    if (lock) {
      const ids = await this.candidateIdQuery(manager).getRawMany<{
        submission_id: string;
      }>();
      lockedIds = ids.map((row) => row.submission_id);
      if (lockedIds.length === 0) return [];
      await manager
        .getRepository(SubmissionEntity)
        .createQueryBuilder("submission")
        .setLock("pessimistic_write")
        .where("submission.id IN (:...ids)", { ids: lockedIds })
        .getMany();
    }

    const query = manager
      .getRepository(SubmissionEntity)
      .createQueryBuilder("submission")
      .innerJoinAndSelect("submission.owner", "owner")
      .innerJoinAndSelect("submission.team", "team")
      .innerJoinAndMapOne(
        "submission.quality",
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .leftJoin(
        QualityRuleVersionEntity,
        "qualityRule",
        "qualityRule.id = quality.qualityRuleVersionId",
      )
      .leftJoinAndMapOne(
        "submission.metadata",
        MediaMetadataEntity,
        "metadata",
        "metadata.submissionId = submission.id",
      )
      .leftJoin(
        PointCycleItemEntity,
        "pointItem",
        "pointItem.submissionId = submission.id",
      )
      .leftJoin(
        SubmissionDuplicateCandidateEntity,
        "duplicateCandidate",
        "duplicateCandidate.submissionId = submission.id AND duplicateCandidate.status = :duplicateCandidateStatus",
        { duplicateCandidateStatus: "candidate" },
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
      .andWhere("pointItem.id IS NULL")
      .andWhere("duplicateCandidate.id IS NULL")
      .andWhere("quality.status IN (:...statuses)", {
        statuses: ["scored", "review_pending"],
      })
      .andWhere(
        "(quality.manualFinalScore IS NOT NULL OR quality.status = :scoredStatus)",
        { scoredStatus: "scored" },
      )
      .andWhere(`
        COALESCE(quality.manualFinalScore, quality.finalScore) >= COALESCE(
          (quality.qualityRuleSnapshot ->> 'passThreshold')::numeric,
          qualityRule.passThreshold,
          60
        )
      `)
      .orderBy("submission.createdAt", "ASC");
    if (lockedIds) {
      query.andWhere("submission.id IN (:...lockedIds)", { lockedIds });
    }

    const submissions = await query.getMany();
    const taskIds = [
      ...new Set(
        submissions
          .map((submission) => submission.taskId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const taskTitles = new Map(
      taskIds.length === 0
        ? []
        : (
            await manager
              .getRepository(CollectionTaskEntity)
              .findBy({ id: In(taskIds) })
          ).map((task) => [task.id, task.title]),
    );
    const legacyRuleIds = [
      ...new Set(
        submissions.flatMap((submission) => {
          const quality = (
            submission as SubmissionEntity & {
              quality?: VideoQualityResultEntity | null;
            }
          ).quality;
          return quality?.qualityRuleVersionId && !quality.qualityRuleSnapshot
            ? [quality.qualityRuleVersionId]
            : [];
        }),
      ),
    ];
    const legacyRules = new Map(
      (
        legacyRuleIds.length === 0
          ? []
          : await manager
              .getRepository(QualityRuleVersionEntity)
              .findBy({ id: In(legacyRuleIds) })
      ).map((rule) => [rule.id, rule]),
    );
    return submissions.flatMap((submission) => {
      const quality = (
        submission as SubmissionEntity & {
          quality?: VideoQualityResultEntity | null;
        }
      ).quality;
      const metadata = (
        submission as SubmissionEntity & {
          metadata?: MediaMetadataEntity | null;
        }
      ).metadata;
      if (!quality) return [];
      const finalScore = Number(quality.manualFinalScore ?? quality.finalScore);
      const settlementRatio = settlementRatioForScore({
        score: finalScore,
        passThreshold:
          quality.qualityRuleSnapshot?.passThreshold ??
          (quality.qualityRuleVersionId
            ? legacyRules.get(quality.qualityRuleVersionId)?.passThreshold
            : undefined) ??
          60,
        coefficientBands: pointRule.coefficientBands,
      });
      if (
        !Number.isFinite(finalScore) ||
        !Number.isFinite(settlementRatio) ||
        settlementRatio <= 0
      ) {
        return [];
      }
      const invalidDurationMs = Number(
        quality.manualInvalidDurationMs ?? quality.invalidDurationMs ?? 0,
      );
      const durationMs = metadata
        ? Math.round(Number(metadata.durationSeconds) * 1_000)
        : Number(
            quality.manualBillableDurationMs ??
              quality.billableDurationMs ??
              0,
          ) + invalidDurationMs;
      const effectiveDurationMs = Math.max(0, durationMs - invalidDurationMs);
      // 单价优先级：任务快照单价 > 团队单价 > 全局默认积分
      const taskPrice =
        submission.taskPricePointsPerMinute === null ||
        submission.taskPricePointsPerMinute === undefined
          ? null
          : Number(submission.taskPricePointsPerMinute);
      const teamPointsPerMinute = Number(
        submission.team?.unitPricePerMinute ?? 0,
      );
      const pointsPerMinute =
        taskPrice !== null && taskPrice > 0
          ? taskPrice
          : teamPointsPerMinute > 0
            ? teamPointsPerMinute
            : Number(pointRule.defaultPointsPerMinute);
      const points = pointsForRule({
        pointsPerMinute,
        effectiveDurationMs,
        settlementRatio,
      });
      return [
        {
          submission,
          quality,
          durationMs,
          finalScore,
          settlementRatio,
          invalidDurationMs,
          effectiveDurationMs,
          pointsPerMinute,
          points,
          taskName: submission.taskId
            ? taskTitles.get(submission.taskId) ?? null
            : null,
        },
      ];
    });
  }

  private candidateIdQuery(manager: EntityManager) {
    return manager
      .getRepository(SubmissionEntity)
      .createQueryBuilder("submission")
      .select("submission.id", "submission_id")
      .innerJoin(
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .leftJoin(
        QualityRuleVersionEntity,
        "qualityRule",
        "qualityRule.id = quality.qualityRuleVersionId",
      )
      .leftJoin(
        PointCycleItemEntity,
        "pointItem",
        "pointItem.submissionId = submission.id",
      )
      .leftJoin(
        SubmissionDuplicateCandidateEntity,
        "duplicateCandidate",
        "duplicateCandidate.submissionId = submission.id AND duplicateCandidate.status = :duplicateCandidateStatus",
        { duplicateCandidateStatus: "candidate" },
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
      .andWhere("pointItem.id IS NULL")
      .andWhere("duplicateCandidate.id IS NULL")
      .andWhere("quality.status IN (:...statuses)", {
        statuses: ["scored", "review_pending"],
      })
      .andWhere(
        "(quality.manualFinalScore IS NOT NULL OR quality.status = :scoredStatus)",
        { scoredStatus: "scored" },
      )
      .andWhere(`
        COALESCE(quality.manualFinalScore, quality.finalScore) >= COALESCE(
          (quality.qualityRuleSnapshot ->> 'passThreshold')::numeric,
          qualityRule.passThreshold,
          60
        )
      `)
      .orderBy("submission.createdAt", "ASC");
  }

  private publicPreview(candidates: Candidate[]) {
    const totals = this.summarize(candidates);
    return {
      submissionCount: totals.count,
      effectiveDurationMs: totals.effectiveDurationMs,
      effectiveMinutes:
        Math.round((totals.effectiveDurationMs / 60_000) * 100) / 100,
      totalPoints: totals.points,
      teamSummaries: [...totals.teamSummaries.values()].sort((left, right) =>
        left.teamName.localeCompare(right.teamName, "zh-CN"),
      ),
    };
  }

  private summarize(candidates: Candidate[]) {
    const teamSummaries = new Map<
      string,
      {
        teamId: string;
        teamName: string;
        submissionCount: number;
        effectiveDurationMs: number;
        points: number;
      }
    >();
    const totals = candidates.reduce(
      (accumulator, candidate) => {
        accumulator.count += 1;
        accumulator.effectiveDurationMs += candidate.effectiveDurationMs;
        accumulator.points += candidate.points;
        const teamId = candidate.submission.teamId;
        const existing =
          teamSummaries.get(teamId) ??
          {
            teamId,
            teamName: candidate.submission.team?.name ?? "",
            submissionCount: 0,
            effectiveDurationMs: 0,
            points: 0,
          };
        existing.submissionCount += 1;
        existing.effectiveDurationMs += candidate.effectiveDurationMs;
        existing.points =
          Math.round((existing.points + candidate.points) * 100) / 100;
        teamSummaries.set(teamId, existing);
        return accumulator;
      },
      { count: 0, effectiveDurationMs: 0, points: 0 },
    );
    return {
      count: totals.count,
      effectiveDurationMs: totals.effectiveDurationMs,
      points: Math.round(totals.points * 100) / 100,
      teamSummaries,
    };
  }
}
