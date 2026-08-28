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

export type WalletBalanceView = {
  ownerId: string;
  ownerName: string;
  totalBalance: number;
  settlingBalance: number;
  availableBalance: number;
  withdrawnBalance: number;
  cumulativeWithdrawn: number;
};

function decimal(value: number, scale = 2): string {
  return value.toFixed(scale);
}

function numberOr(value: string | null | undefined): number {
  return Number(value ?? 0) || 0;
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
    let row = await repo.findOne({ where: { ownerId }, lock: { mode: "pessimistic_write" } });
    if (!row) {
      row = repo.create({
        ownerId,
        totalBalance: "0.00",
        settlingBalance: "0.00",
        availableBalance: "0.00",
        withdrawnBalance: "0.00",
        cumulativeWithdrawn: "0.00",
      });
      row = await repo.save(row);
    }
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
    const amount = Math.round(input.amount * 100) / 100;
    const total = numberOr(row.totalBalance) + amount;
    const settling = numberOr(row.settlingBalance) + amount;
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
    const amount = Math.round(input.amount * 100) / 100;
    const settling = Math.max(0, numberOr(row.settlingBalance) - amount);
    const available = numberOr(row.availableBalance) + amount;
    const total = settling + available + numberOr(row.withdrawnBalance);
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

  /**
   * 提现：从「可提现」转出，记录已提现与累计提现。
   * available -= amount, withdrawn += amount, cumulative_withdrawn += amount；流水 type=withdraw（负值）。
   */
  async withdraw(
    actor: { id: string; displayName: string },
    input: { ownerId: string; amount: number; remark?: string },
  ): Promise<WalletBalanceView> {
    const amount = Math.round(input.amount * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new WalletFailure("VALIDATION", "提现金额必须大于 0", 400);
    }
    return this.transactions.manager.transaction(async (manager) => {
      const row = await this.balanceRow(manager, input.ownerId);
      const available = numberOr(row.availableBalance);
      if (amount > available) {
        throw new WalletFailure(
          "INSUFFICIENT_BALANCE",
          `可提现余额不足（当前可提现 ${available.toFixed(2)} 元）`,
          409,
        );
      }
      const nextAvailable = Math.round((available - amount) * 100) / 100;
      const withdrawn = numberOr(row.withdrawnBalance) + amount;
      const cumulative = numberOr(row.cumulativeWithdrawn) + amount;
      const total = numberOr(row.settlingBalance) + nextAvailable + withdrawn;
      row.availableBalance = decimal(nextAvailable);
      row.withdrawnBalance = decimal(withdrawn);
      row.cumulativeWithdrawn = decimal(cumulative);
      row.totalBalance = decimal(total);
      await manager.getRepository(WalletBalanceEntity).save(row);
      await this.recordTransaction(manager, {
        ownerId: input.ownerId,
        type: "withdraw",
        amount: -amount,
        balanceAfter: total,
        remark: input.remark ?? null,
        createdByAccountId: actor.id,
      });
      return this.view(row, input.ownerId);
    });
  }

  private async view(
    row: WalletBalanceEntity,
    ownerId: string,
  ): Promise<WalletBalanceView> {
    const owner = await this.users.findOneBy({ id: ownerId });
    return {
      ownerId,
      ownerName: owner?.displayName ?? ownerId,
      totalBalance: numberOr(row.totalBalance),
      settlingBalance: numberOr(row.settlingBalance),
      availableBalance: numberOr(row.availableBalance),
      withdrawnBalance: numberOr(row.withdrawnBalance),
      cumulativeWithdrawn: numberOr(row.cumulativeWithdrawn),
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
        withdrawnBalance: 0,
        cumulativeWithdrawn: 0,
      };
    }
    return this.view(row, ownerId);
  }

  /** 批量钱包（管理员全平台 / 团长本队 / 数采本人） */
  async listWallets(
    actor: { id: string; role: "admin" | "leader" | "collector"; teamId?: string },
  ): Promise<WalletBalanceView[]> {
    let rows: WalletBalanceEntity[];
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
    }>
  > {
    const rows = await this.transactions.find({
      where: { ownerId },
      order: { createdAt: "DESC" },
      take: Math.min(100, Math.max(1, limit)),
    });
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: numberOr(row.amount),
      balanceAfter: numberOr(row.balanceAfter),
      cycleId: row.cycleId,
      submissionId: row.submissionId,
      remark: row.remark,
      createdAt: row.createdAt.getTime(),
    }));
  }
}

export { decimal as walletDecimal, numberOr as walletNumber };
