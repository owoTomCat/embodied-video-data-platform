import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository, type EntityManager } from "typeorm";

import { AuditService } from "../audit/audit.service.js";
import type { PublicUser } from "../auth/auth.types.js";
import {
  PointRuleVersionEntity,
  type PointRuleCoefficientBand,
} from "../database/entities/point-rule-version.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import type { CreatePointRuleDto } from "./dto/point-rule.dto.js";
import { PointCycleFailure } from "./point-cycle-failure.js";
import { DEFAULT_COEFFICIENT_BANDS } from "../rules/rule-calculator.js";

const POINT_RULE_LOCK_KEY = 7_326_195_423;
const DEFAULT_BANDS: PointRuleCoefficientBand[] =
  DEFAULT_COEFFICIENT_BANDS.map((band) => ({ ...band }));

export type PublicPointRule = {
  id: string;
  revision: number;
  version: string;
  defaultPointsPerMinute: number;
  coefficientBands: PointRuleCoefficientBand[];
  description: string;
  active: boolean;
  createdByAccountId: string;
  createdByName: string;
  createdAt: number;
};

function normalizeBands(
  bands: PointRuleCoefficientBand[],
): PointRuleCoefficientBand[] {
  const normalized = bands.map((band) => {
    const minScore = Math.round(band.minScore);
    const maxScore = Math.round(band.maxScore);
    if (minScore > maxScore) {
      throw new PointCycleFailure(
        "VALIDATION",
        "质量系数分段的起始分不能大于结束分",
        400,
      );
    }
    return {
      minScore,
      maxScore,
      ratio: Math.round(band.ratio * 10_000) / 10_000,
      label: band.label.trim(),
    };
  });
  const ordered = [...normalized].sort(
    (left, right) => left.minScore - right.minScore,
  );
  if (
    ordered[0]?.minScore !== 0 ||
    ordered.at(-1)?.maxScore !== 100 ||
    ordered.some(
      (band, index) =>
        !band.label ||
        (index > 0 && ordered[index - 1]!.maxScore + 1 !== band.minScore),
    )
  ) {
    throw new PointCycleFailure(
      "VALIDATION",
      "质量系数分段必须无重叠、无空档地覆盖 0 到 100 分",
      400,
    );
  }
  return normalized;
}

function normalizeRuleInput(input: CreatePointRuleDto): {
  version: string;
  defaultPointsPerMinute: number;
  coefficientBands: PointRuleCoefficientBand[];
  description: string;
} {
  const version = input.version.trim();
  const description = input.description.trim();
  if (!version) throw new PointCycleFailure("VALIDATION", "请填写版本名称", 400);
  if (!description) {
    throw new PointCycleFailure("VALIDATION", "请填写规则说明", 400);
  }
  return {
    version,
    defaultPointsPerMinute:
      Math.round(input.defaultPointsPerMinute * 10_000) / 10_000,
    coefficientBands: normalizeBands(input.coefficientBands),
    description,
  };
}

export function publicPointRule(
  rule: PointRuleVersionEntity,
): PublicPointRule {
  return {
    id: rule.id,
    revision: rule.revision,
    version: rule.version,
    defaultPointsPerMinute: Number(rule.defaultPointsPerMinute),
    coefficientBands: rule.coefficientBands,
    description: rule.description,
    active: rule.active,
    createdByAccountId: rule.createdByAccountId,
    createdByName: rule.createdByName,
    createdAt: rule.createdAt.getTime(),
  };
}

@Injectable()
export class PointRulesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(PointRuleVersionEntity)
    private readonly rules: Repository<PointRuleVersionEntity>,
    private readonly audit: AuditService,
  ) {}

  async ensureDefault(): Promise<PointRuleVersionEntity> {
    const current = await this.rules.findOneBy({ active: true });
    if (current) return current;
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        POINT_RULE_LOCK_KEY,
      ]);
      const repository = manager.getRepository(PointRuleVersionEntity);
      const active = await repository.findOneBy({ active: true });
      if (active) return active;
      const creator = await manager.getRepository(UserEntity).findOne({
        where: { role: "admin", status: "active" },
        order: { createdAt: "ASC" },
      });
      if (!creator) {
        throw new Error("初始化单价规则前必须存在启用的管理员账号");
      }
      return repository.save({
        id: `PRV-${randomUUID()}`,
        revision: 1,
        version: "POINTS-2026-08",
        defaultPointsPerMinute: "20.0000",
        coefficientBands: DEFAULT_BANDS,
        description: "默认单价规则：按有效时长（元/小时）和质量系数计算",
        active: true,
        createdByAccountId: creator.id,
        createdByName: "系统初始化",
      });
    });
  }

  async getActive(actor: PublicUser): Promise<PointRuleVersionEntity> {
    if (actor.status !== "active") {
      throw new PointCycleFailure("FORBIDDEN", "账号已停用", 403);
    }
    return this.ensureDefault();
  }

  async getActiveForCalculation(
    manager: EntityManager = this.dataSource.manager,
    lock = false,
  ): Promise<PointRuleVersionEntity> {
    const query = manager
      .getRepository(PointRuleVersionEntity)
      .createQueryBuilder("rule")
      .where("rule.active = true");
    if (lock) query.setLock("pessimistic_read");
    const rule = await query.getOne();
    if (!rule) throw new Error("当前单价规则不存在");
    return rule;
  }

  async create(
    actor: PublicUser,
    input: CreatePointRuleDto,
  ): Promise<PointRuleVersionEntity> {
    this.requireAdmin(actor);
    const normalized = normalizeRuleInput(input);
    await this.ensureDefault();
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock($1)", [
        POINT_RULE_LOCK_KEY,
      ]);
      const repository = manager.getRepository(PointRuleVersionEntity);
      const existing = await repository.findOneBy({
        version: normalized.version,
      });
      if (existing) {
        throw new PointCycleFailure(
          "CONFLICT",
          "单价规则版本名称已存在",
          409,
        );
      }
      const current = await repository.findOne({
        where: { active: true },
        lock: { mode: "pessimistic_write" },
      });
      if (!current) throw new Error("当前单价规则不存在");
      current.active = false;
      await repository.save(current);
      const next = await repository.save({
        id: `PRV-${randomUUID()}`,
        revision: current.revision + 1,
        ...normalized,
        defaultPointsPerMinute: normalized.defaultPointsPerMinute.toFixed(4),
        active: true,
        createdByAccountId: actor.id,
        createdByName: actor.displayName,
      });
      await this.audit.record(
        manager,
        actor,
        "point_rule_publish",
        { id: next.id, name: next.version },
        `发布单价规则 ${next.version}，默认 ${Number(next.defaultPointsPerMinute).toFixed(2)} 元/小时`,
        {
          version: current.version,
          defaultPointsPerMinute: Number(current.defaultPointsPerMinute),
          coefficientBands: current.coefficientBands,
        },
        {
          version: next.version,
          defaultPointsPerMinute: Number(next.defaultPointsPerMinute),
          coefficientBands: next.coefficientBands,
        },
      );
      return next;
    });
  }

  private requireAdmin(actor: PublicUser): void {
    if (actor.status !== "active" || actor.role !== "admin") {
      throw new PointCycleFailure("FORBIDDEN", "仅管理员可管理单价规则", 403);
    }
  }
}
