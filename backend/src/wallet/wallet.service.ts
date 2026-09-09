import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";

import { WalletFailure } from "./wallet.failure.js";
import {
  WalletBalanceEntity,
  WalletTransactionEntity,
  type WalletTransactionType,
} from "../database/entities/wallet.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import type { PublicUser } from "../auth/auth.types.js";

export type WalletBalanceView = {
  ownerId: string;
  ownerName: string;
  totalBalance: number;
  settlingBalance: number;
  availableBalance: number;
  reservedBalance: number;
  withdrawnBalance: number;
  cumulativeWithdrawn: number;
  nextSettlementAt: number | null;
};

function decimal(value: number, scale = 2): string {
  return value.toFixed(scale);
}

function numberOr(value: string | null | undefined): number {
  return Number(value ?? 0) || 0;
}
function requireConsistentBalance(row: WalletBalanceEntity): void {
  const amounts = [row.totalBalance, row.settlingBalance, row.availableBalance, row.reservedBalance, row.withdrawnBalance].map((value) => Number(value));
  if (amounts.some((value) => !Number.isFinite(value) || value < 0) ||
      Math.round(amounts[0]! * 100) !== amounts.slice(1).reduce((sum, value) => sum + Math.round(value * 100), 0)) {
    throw new WalletFailure("ACCOUNTING_INCONSISTENCY", "钱包分项余额与总额不一致", 409);
  }
}


@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(WalletBalanceEntity)
    private readonly balances: Repository<WalletBalanceEntity>,
    @InjectRepository(WalletTransactionEntity)
    private readonly transactions: Repository<WalletTransactionEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  /** 读取钱包余额（不存在则创建零余额账户） */
  private async balanceRow(
    manager: EntityManager,
    ownerId: string,
  ): Promise<WalletBalanceEntity> {
    const repo = manager.getRepository(WalletBalanceEntity);
    await repo.createQueryBuilder().insert().values({ ownerId }).orIgnore().execute();
    const row = await repo.findOneOrFail({ where: { ownerId }, lock: { mode: "pessimistic_write" } });
    return row;
  }

  /** 记一笔流水（amount 带符号） */
  private async recordTransaction(
    manager: EntityManager,
    input: {
      ownerId: string;
      type: WalletTransactionType;
      amount: number;
      balanceAfter: number;
      cycleId?: string | null;
      submissionId?: string | null;
      remark?: string | null;
      createdByAccountId?: string | null;
    },
  ): Promise<void> {
    await manager.getRepository(WalletTransactionEntity).save({
      id: `WT-${randomUUID().slice(0, 12)}`,
      ownerId: input.ownerId,
      type: input.type,
      amount: decimal(input.amount),
      balanceAfter: decimal(input.balanceAfter),
      cycleId: input.cycleId ?? null,
      submissionId: input.submissionId ?? null,
      remark: input.remark ?? null,
      createdByAccountId: input.createdByAccountId ?? null,
    });
  }

  /**
   * 周期锁定：金额进入「结算中」。
   * total += amount, settling += amount；流水 type=lock。
   */
  async creditSettling(
    manager: EntityManager,
    input: {
      ownerId: string;
      amount: number;
      cycleId: string;
      submissionId?: string | null;
      remark?: string;
      createdByAccountId?: string | null;
    },
  ): Promise<void> {
    const row = await this.balanceRow(manager, input.ownerId);
    requireConsistentBalance(row);
    const amount = Math.round(input.amount * 100) / 100;
    const total = numberOr(row.totalBalance) + amount;
    const settling = numberOr(row.settlingBalance) + amount;
    if (!Number.isFinite(amount) || total < 0 || Math.round(settling * 100) < 0) {
      throw new WalletFailure("ACCOUNTING_INCONSISTENCY", "结算中余额不足或金额无效", 409);
    }
    row.totalBalance = decimal(total);
    row.settlingBalance = decimal(settling);
    await manager.getRepository(WalletBalanceEntity).save(row);
    await this.recordTransaction(manager, {
      ownerId: input.ownerId,
      type: "lock",
      amount,
      balanceAfter: total,
      cycleId: input.cycleId,
      submissionId: input.submissionId,
      remark: input.remark,
      createdByAccountId: input.createdByAccountId,
    });
  }

  /**
   * 周期结算：金额从「结算中」转入「可提现」。
   * settling -= amount, available += amount；流水 type=settle。
   */
  async settleToAvailable(
    manager: EntityManager,
    input: {
      ownerId: string;
      amount: number;
      cycleId: string;
      submissionId?: string | null;
      remark?: string;
    },
  ): Promise<void> {
    const row = await this.balanceRow(manager, input.ownerId);
    requireConsistentBalance(row);
    const amount = Math.round(input.amount * 100) / 100;
    const settling = Math.round((numberOr(row.settlingBalance) - amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0 || settling < 0) {
      throw new WalletFailure("ACCOUNTING_INCONSISTENCY", "结算中余额不足或金额无效", 409);
    }
    const available = numberOr(row.availableBalance) + amount;
    const total = settling + available + numberOr(row.reservedBalance) + numberOr(row.withdrawnBalance);
    row.settlingBalance = decimal(settling);
    row.availableBalance = decimal(available);
    row.totalBalance = decimal(total);
    await manager.getRepository(WalletBalanceEntity).save(row);
    await this.recordTransaction(manager, {
      ownerId: input.ownerId,
      type: "settle",
      amount,
      balanceAfter: total,
      cycleId: input.cycleId,
      submissionId: input.submissionId,
      remark: input.remark,
    });
  }


  private async view(
    row: WalletBalanceEntity,
    ownerId: string,
  ): Promise<WalletBalanceView> {
    const owner = await this.users.findOneBy({ id: ownerId });
    const [due] = await this.balances.query(
      `SELECT MIN(c.settle_due_at) AS due
       FROM point_cycles c
       JOIN wallet_transactions t ON t.cycle_id = c.id
       WHERE c.status = 'locked' AND t.owner_id = $1 AND t.type = 'lock'
       AND c.id IN (SELECT cycle_id FROM wallet_transactions WHERE owner_id = $1 AND type = 'lock' GROUP BY cycle_id HAVING SUM(amount) > 0)`,
      [ownerId],
    );
    return {
      ownerId,
      ownerName: owner?.displayName ?? ownerId,
      totalBalance: numberOr(row.totalBalance),
      settlingBalance: numberOr(row.settlingBalance),
      availableBalance: numberOr(row.availableBalance),
      reservedBalance: numberOr(row.reservedBalance),
      withdrawnBalance: numberOr(row.withdrawnBalance),
      cumulativeWithdrawn: numberOr(row.cumulativeWithdrawn),
      nextSettlementAt: due?.due ? new Date(due.due).getTime() : null,
    };
  }

  /** 单个钱包（含余额视图） */
  async getWallet(ownerId: string): Promise<WalletBalanceView> {
    const row = await this.balances.findOneBy({ ownerId });
    if (!row) {
      return {
        ownerId,
        ownerName: (await this.users.findOneBy({ id: ownerId }))?.displayName ?? ownerId,
        totalBalance: 0,
        settlingBalance: 0,
        availableBalance: 0,
        reservedBalance: 0,
        withdrawnBalance: 0,
        cumulativeWithdrawn: 0,
        nextSettlementAt: null,
      };
    }
    return this.view(row, ownerId);
  }

  /** 批量钱包（管理员全平台 / 团长本队 / 数采本人） */
  async listWallets(
    actor: { id: string; role: "admin" | "leader" | "collector"; teamId?: string },
  ): Promise<WalletBalanceView[]> {
    let rows: WalletBalanceEntity[];
    if (actor.role === "leader" && !actor.teamId) return [];
    if (actor.role === "collector") {
      const row = await this.balances.findOneBy({ ownerId: actor.id });
      rows = row ? [row] : [];
    } else {
      const query = this.balances
        .createQueryBuilder("wallet")
        .leftJoin("wallet.owner", "owner")
        .orderBy("wallet.totalBalance", "DESC");
      if (actor.role === "leader" && actor.teamId) {
        query.where("owner.teamId = :teamId", { teamId: actor.teamId });
      }
      rows = await query.getMany();
    }
    return Promise.all(rows.map((row) => this.view(row, row.ownerId)));
  }

  /** 钱包流水 */
  async listTransactions(
    actor: PublicUser,
    ownerId: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      type: WalletTransactionType;
      amount: number;
      balanceAfter: number;
      cycleId: string | null;
      submissionId: string | null;
      remark: string | null;
      createdAt: number;
      settleDueAt: number | null;
      fileName: string | null;
    }>
  > {
    await this.authorizeOwner(actor, ownerId);
    const rows = await this.transactions.find({
      where: { ownerId },
      order: { createdAt: "DESC" },
      take: Math.min(100, Math.max(1, limit)),
    });
    const ids = rows.map((row) => row.id);
    const evidence: Array<{ id: string; due: Date | string | null; file_name: string | null }> = ids.length
      ? await this.transactions.query(
          `SELECT t.id, c.settle_due_at AS due, COALESCE(i.file_name, s.original_file_name) AS file_name
           FROM wallet_transactions t
           LEFT JOIN point_cycles c ON c.id = t.cycle_id
           LEFT JOIN point_cycle_items i ON i.cycle_id = t.cycle_id AND i.submission_id = t.submission_id
           LEFT JOIN submissions s ON s.id = t.submission_id
           WHERE t.id = ANY($1::varchar[])`, [ids],
        )
      : [];
    const byId = new Map(evidence.map((entry) => [entry.id, entry]));
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: numberOr(row.amount),
      balanceAfter: numberOr(row.balanceAfter),
      cycleId: row.cycleId,
      submissionId: row.submissionId,
      remark: row.remark,
      createdAt: row.createdAt.getTime(),
      settleDueAt: byId.get(row.id)?.due ? new Date(byId.get(row.id)!.due!).getTime() : null,
      fileName: byId.get(row.id)?.file_name ?? null,
    }));
  }

  private async authorizeOwner(actor: PublicUser, ownerId: string): Promise<void> {
    if (actor.role === "admin" || actor.id === ownerId) return;
    if (actor.role === "leader" && actor.teamId) {
      const owner = await this.users.findOneBy({ id: ownerId });
      if (owner?.teamId === actor.teamId) return;
    }
    throw new WalletFailure("FORBIDDEN", "无权读取此钱包", 403);
  }

  // ---------- 流水统计（管理员监控） ----------

  /**
   * 按日/周/月聚合全平台钱包流水（lock=结算中流入 / settle=结算转可提现 / withdraw=提现流出，带符号）。
   * 供管理端折线图使用（悬浮显示各类型明细）。
   */
  async statsFlow(input: {
    bucket: "day" | "week" | "month";
    from?: string;
    to?: string;
  }): Promise<
    Array<{ bucket: string; lock: number; settle: number; withdraw: number }>
  > {
    const from = input.from ? new Date(input.from) : new Date("1970-01-01");
    const to = input.to ? new Date(input.to) : new Date();
    const rows = await this.transactions.query(
      `SELECT
         to_char(date_trunc($1, "created_at"), 'YYYY-MM-DD') AS bucket,
         COALESCE(SUM(amount) FILTER (WHERE type = 'lock'), 0)::float AS lock,
         COALESCE(SUM(amount) FILTER (WHERE type = 'settle'), 0)::float AS settle,
         COALESCE(SUM(amount) FILTER (WHERE type = 'withdraw'), 0)::float AS withdraw
       FROM wallet_transactions
       WHERE "created_at" >= $2 AND "created_at" <= $3
       GROUP BY 1
       ORDER BY 1`,
      [input.bucket, from, to],
    );
    return rows.map((row: Record<string, unknown>) => ({
      bucket: String(row.bucket),
      lock: Number(row.lock) || 0,
      settle: Number(row.settle) || 0,
      withdraw: Number(row.withdraw) || 0,
    }));
  }

  /**
   * 按团队聚合全平台钱包流水（团队成员归属）。
   * 供管理端团队分布饼图使用（饼图用 settle 占比，标注显示各类型明细）。
   */
  async statsByTeam(input: {
    from?: string;
    to?: string;
  }): Promise<
    Array<{
      teamId: string | null;
      teamName: string;
      lock: number;
      settle: number;
      withdraw: number;
    }>
  > {
    const from = input.from ? new Date(input.from) : new Date("1970-01-01");
    const to = input.to ? new Date(input.to) : new Date();
    const rows = await this.transactions.query(
      `SELECT
         team.id AS team_id,
         COALESCE(team.name, '未归属团队') AS team_name,
         COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'lock'), 0)::float AS lock,
         COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'settle'), 0)::float AS settle,
         COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'withdraw'), 0)::float AS withdraw
       FROM wallet_transactions t
       JOIN users u ON u.id = t.owner_id
       LEFT JOIN teams team ON team.id = u.team_id
       WHERE t."created_at" >= $1 AND t."created_at" <= $2
       GROUP BY team.id, team.name
       ORDER BY settle DESC`,
      [from, to],
    );
    return rows.map((row: Record<string, unknown>) => ({
      teamId: row.team_id === null ? null : String(row.team_id),
      teamName: String(row.team_name),
      lock: Number(row.lock) || 0,
      settle: Number(row.settle) || 0,
      withdraw: Number(row.withdraw) || 0,
    }));
  }
}

export { decimal as walletDecimal, numberOr as walletNumber };
