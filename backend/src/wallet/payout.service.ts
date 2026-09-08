import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import type { PublicUser } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { WalletBalanceEntity, WalletTransactionEntity } from "../database/entities/wallet.entity.js";
import { WithdrawalRequestEntity, WithdrawalRegistrationEntity, WithdrawalEventEntity, type WithdrawalStatus } from "../database/entities/withdrawal.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { PayoutEvidenceService } from "./payout-evidence.service.js";
import { WalletFailure } from "./wallet.failure.js";
import { centsMoney, decryptRecipient, encryptRecipient, moneyCents, normalizeWithdrawal, payoutHash, payoutKey, type WithdrawalInput } from "./payout-recipient.js";

export function withdrawalView(row: WithdrawalRequestEntity) {
  return { id: row.id, ownerId: row.ownerId, amount: Number(row.amount), status: row.status, method: row.method,
    accountMasked: row.accountMasked, nameMasked: row.nameMasked, batchId: row.batchId, reason: row.reason,
    transferReference: row.transferReference, paidAt: row.paidAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    ownerName: null as string | null, teamName: null as string | null, assigneeId: row.assigneeId, assigneeName: null as string | null,
    assignedAt: row.assignedAt?.toISOString() ?? null, registeredById: row.registeredById, reviewedById: row.reviewedById,
    reviewedAt: row.reviewedAt?.toISOString() ?? null, reviewMode: row.reviewMode, latestRegistrationId: row.latestRegistrationId,
    revision: row.revision, overdue: ["pending", "processing", "review_pending", "investigating"].includes(row.status) && Date.now() - row.createdAt.getTime() >= 86_400_000 };
}
@Injectable()
export class PayoutService {
  constructor(private readonly dataSource: DataSource, private readonly audit: AuditService, private readonly evidence: PayoutEvidenceService) {}

  private admin(actor: PublicUser) {
    if (actor.role !== "admin" || actor.status !== "active") throw new WalletFailure("FORBIDDEN", "仅有效管理员可操作财务提现", 403);
  }
  private async lockedBalance(manager: EntityManager, ownerId: string) {
    await manager.getRepository(WalletBalanceEntity).createQueryBuilder().insert().values({ ownerId }).orIgnore().execute();
    return manager.getRepository(WalletBalanceEntity).findOneOrFail({ where: { ownerId }, lock: { mode: "pessimistic_write" } });
  }
  private async auditState(manager: EntityManager, actor: PublicUser, action: string, row: WithdrawalRequestEntity) {
    await this.audit.record(manager, actor, action, { id: row.ownerId, name: row.ownerId }, `提现 ${row.id}：${row.status}`, null,
      { requestId: row.id, batchId: row.batchId, status: row.status, amount: row.amount, accountMasked: row.accountMasked });
    await manager.getRepository(WithdrawalEventEntity).insert({ id: `WE-${randomUUID()}`, requestId: row.id, action,
      actorId: actor.id, actorName: actor.displayName, reason: action === "withdrawal.paid" ? null : row.reason, registrationId: row.latestRegistrationId,
      details: { revision: row.revision, status: row.status, amount: row.amount, assigneeId: row.assigneeId, reviewMode: row.reviewMode } });
  }
  async submit(actor: PublicUser, input: WithdrawalInput) {
    if (actor.role !== "collector") throw new WalletFailure("FORBIDDEN", "仅数采人员可申请提现", 403);
    const { cents, recipient, idempotencyKey } = normalizeWithdrawal(input);
    const key = payoutKey();
    const hash = payoutHash(cents, recipient, key);
    return this.dataSource.transaction(async (manager) => {
      const balance = await this.lockedBalance(manager, actor.id);
      const repo = manager.getRepository(WithdrawalRequestEntity);
      const previous = await repo.findOneBy({ ownerId: actor.id, idempotencyKey });
      if (previous) {
        if (previous.payloadHash !== hash) throw new WalletFailure("IDEMPOTENCY_CONFLICT", "此提交标识已用于不同申请，请恢复原申请信息或发起新申请", 409);
        return withdrawalView(previous);
      }
      if (moneyCents(balance.availableBalance) < cents) throw new WalletFailure("INSUFFICIENT_BALANCE", "可提现余额不足", 409);
      const id = `WR-${randomUUID()}`;
      const row = repo.create({ id, ownerId: actor.id, idempotencyKey, payloadHash: hash, amount: centsMoney(cents), status: "pending",
        method: recipient.method, recipientEncrypted: encryptRecipient(recipient, id, key),
        accountMasked: recipient.account.length > 4 ? `***${recipient.account.slice(-4)}` : "***", nameMasked: recipient.name.length > 1 ? `${recipient.name.slice(0, 1)}***` : "***" });
      balance.availableBalance = centsMoney(moneyCents(balance.availableBalance) - cents);
      balance.reservedBalance = centsMoney(moneyCents(balance.reservedBalance) + cents);
      await manager.getRepository(WalletBalanceEntity).save(balance);
      await repo.save(row);
      await this.auditState(manager, actor, "withdrawal.submitted", row);
      return withdrawalView(row);
    });
  }
  async list(actor: PublicUser, input: { page?: number; pageSize?: number; status?: WithdrawalStatus; ownerId?: string; batchId?: string; scope?: "mine"; overdue?: "true" | "false" } = {}) {
    if (actor.role !== "collector") this.admin(actor);
    const page = input.page ?? 1, pageSize = input.pageSize ?? 25;
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new WalletFailure("VALIDATION", "分页参数无效", 400);
    if (input.status && !["pending", "processing", "review_pending", "investigating", "paid", "rejected", "failed"].includes(input.status)) throw new WalletFailure("VALIDATION", "状态无效", 400);
    if (actor.role === "collector" && input.ownerId && input.ownerId !== actor.id) throw new WalletFailure("FORBIDDEN", "不可读取他人申请", 403);
    const query = this.dataSource.getRepository(WithdrawalRequestEntity).createQueryBuilder("request");
    const ownerId = actor.role === "collector" ? actor.id : input.ownerId;
    if (ownerId) query.andWhere("request.ownerId = :ownerId", { ownerId });
    if (input.status) query.andWhere("request.status = :status", { status: input.status });
    if (input.batchId) query.andWhere("request.batchId = :batchId", { batchId: input.batchId });
    if (input.scope === "mine") query.andWhere("request.assigneeId = :actorId", { actorId: actor.id });
    if (input.overdue === "true") query.andWhere("request.status IN (:...open) AND request.createdAt <= :cutoff", { open: ["pending", "processing", "review_pending", "investigating"], cutoff: new Date(Date.now() - 86_400_000) });
    const [rows, total] = await query.orderBy("request.createdAt", "DESC").addOrderBy("request.id", "DESC").skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { requests: await Promise.all(rows.map(row => this.view(this.dataSource.manager, row))), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
  private async view(manager: EntityManager, row: WithdrawalRequestEntity) {
    const owner = await manager.getRepository(UserEntity).findOne({ where: { id: row.ownerId }, relations: { team: true } });
    const assignee = row.assigneeId ? await manager.getRepository(UserEntity).findOneBy({ id: row.assigneeId }) : null;
    return { ...withdrawalView(row), ownerName: owner?.displayName ?? null, teamName: owner?.team?.name ?? null, assigneeName: assignee?.displayName ?? null };
  }
  private async activeAdmin(manager: EntityManager, actor: PublicUser) {
    this.admin(actor);
    const user = await manager.getRepository(UserEntity).findOneBy({ id: actor.id, role: "admin", status: "active" });
    if (!user) throw new WalletFailure("FORBIDDEN", "需要有效管理员身份", 403);
  }
  private async lockedRequest(manager: EntityManager, id: string) {
    const row = await manager.getRepository(WithdrawalRequestEntity).createQueryBuilder("request")
      .addSelect("request.recipientEncrypted").where("request.id = :id", { id }).setLock("pessimistic_write").getOne();
    if (!row) throw new WalletFailure("NOT_FOUND", "申请不存在", 404);
    return row;
  }
  async detail(actor: PublicUser, id: string) {
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor);
      const row = await this.lockedRequest(manager, id);
      const registrations = await manager.getRepository(WithdrawalRegistrationEntity).find({ where: { requestId: id }, order: { requestRevision: "ASC" } });
      const events = await manager.getRepository(WithdrawalEventEntity).find({ where: { requestId: id }, order: { sequence: "ASC" } });
      return { request: await this.view(manager, row),
        registrations: registrations.map(r => ({ id: r.id, registeredById: r.registeredById, registeredByName: r.registeredByName, transferReference: r.transferReference, paidAt: r.paidAt.toISOString(), evidenceIds: r.evidenceIds, note: r.note, createdAt: r.createdAt.toISOString() })),
        evidence: await this.evidence.listForRequest(manager, id),
        timeline: events.map(e => ({ id: e.id, action: e.action, actorId: e.actorId, actorName: e.actorName, reason: e.reason, registrationId: e.registrationId, createdAt: e.createdAt.toISOString(),
          evidenceIds: Array.isArray(e.details.evidenceIds) ? e.details.evidenceIds.filter((id): id is string => typeof id === "string") : [],
          assignment: e.action === "withdrawal.assigned" && typeof e.details.newAssigneeId === "string" ? {
            fromId: typeof e.details.oldAssigneeId === "string" ? e.details.oldAssigneeId : null,
            fromName: typeof e.details.oldAssigneeName === "string" ? e.details.oldAssigneeName : null,
            toId: e.details.newAssigneeId, toName: typeof e.details.newAssigneeName === "string" ? e.details.newAssigneeName : null,
          } : null })) };
    });
  }
  private async moveReserve(manager: EntityManager, actor: PublicUser, row: WithdrawalRequestEntity) {
    const balance = await this.lockedBalance(manager, row.ownerId), cents = moneyCents(row.amount);
    if (moneyCents(balance.reservedBalance) < cents) throw new WalletFailure("BALANCE_CONFLICT", "预留余额异常，请核对", 409);
    const before = { reservedBalance: balance.reservedBalance, availableBalance: balance.availableBalance, withdrawnBalance: balance.withdrawnBalance };
    balance.reservedBalance = centsMoney(moneyCents(balance.reservedBalance) - cents);
    balance.withdrawnBalance = centsMoney(moneyCents(balance.withdrawnBalance) + cents);
    balance.cumulativeWithdrawn = centsMoney(moneyCents(balance.cumulativeWithdrawn) + cents);
    await manager.getRepository(WalletTransactionEntity).insert({ id: `WT-${randomUUID()}`, ownerId: row.ownerId, type: "withdraw", amount: `-${row.amount}`, balanceAfter: balance.totalBalance, remark: `人工付款确认：${row.id}`, createdByAccountId: actor.id });
    await manager.getRepository(WalletBalanceEntity).save(balance);
    await this.audit.record(manager, actor, "withdrawal.reserve_paid", { id: row.id, name: row.id }, `提现 ${row.id}`, before,
      { reservedBalance: balance.reservedBalance, availableBalance: balance.availableBalance, withdrawnBalance: balance.withdrawnBalance, requestId: row.id, registrationId: row.latestRegistrationId, revision: row.revision, reviewMode: row.reviewMode });
  }
  async listPayouts(actor: PublicUser, input: { page?: number; pageSize?: number; q?: string; status?: "unpaid" | "paid" | "all" } = {}) {
    const page = input.page ?? 1, pageSize = input.pageSize ?? 25, status = input.status ?? "unpaid";
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
      || !["unpaid", "paid", "all"].includes(status) || (input.q !== undefined && (typeof input.q !== "string" || input.q.length > 200))) {
      throw new WalletFailure("VALIDATION", "查询参数无效", 400);
    }
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor);
      const query = manager.getRepository(WithdrawalRequestEntity).createQueryBuilder("request")
        .addSelect("request.recipientEncrypted").leftJoin(UserEntity, "owner", "owner.id = request.ownerId")
        .leftJoin("owner.team", "team");
      if (status === "unpaid") query.andWhere("request.status IN (:...statuses)", { statuses: ["pending", "processing", "review_pending", "investigating"] });
      else if (status === "paid") query.andWhere("request.status = :status", { status });
      const search = input.q?.trim();
      if (search) query.andWhere("(strpos(lower(request.id), :search) > 0 OR strpos(lower(request.ownerId), :search) > 0 OR strpos(lower(owner.username), :search) > 0 OR strpos(lower(owner.displayName), :search) > 0 OR strpos(lower(team.name), :search) > 0)", { search: search.toLowerCase() });
      const [rows, total] = await query.orderBy("request.createdAt", "DESC").addOrderBy("request.id", "DESC")
        .skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
      const requests = [];
      for (const row of rows) requests.push(await this.payoutView(manager, row));
      await this.audit.record(manager, actor, "withdrawal.recipients_viewed", { id: actor.id, name: actor.displayName },
        "查看提现收款表格", null, { requestIds: rows.map(row => row.id), page, pageSize, status });
      return { requests, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
    });
  }

  private async payoutView(manager: EntityManager, row: WithdrawalRequestEntity) {
    const confirmedById = row.status === "paid" ? row.reviewedById : null;
    const confirmer = confirmedById ? await manager.getRepository(UserEntity).findOneBy({ id: confirmedById }) : null;
    const event = row.status === "paid" ? await manager.getRepository(WithdrawalEventEntity).findOne({
      where: { requestId: row.id, action: "withdrawal.paid" }, order: { sequence: "DESC" },
    }) : null;
    return { ...await this.view(manager, row), recipient: decryptRecipient(row.recipientEncrypted, row.id, payoutKey()),
      confirmedById: confirmedById ?? event?.actorId ?? null,
      confirmedByName: event?.actorName ?? confirmer?.displayName ?? null,
      confirmedAt: row.status === "paid" ? (row.reviewedAt ?? event?.createdAt)?.toISOString() ?? null : null };
  }

  async confirm(actor: PublicUser, id: string) {
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor);
      const row = await this.lockedRequest(manager, id);
      if (row.status !== "paid") {
        if (!["pending", "processing", "review_pending", "investigating"].includes(row.status)) {
          throw new WalletFailure("STATE_CONFLICT", "已终结的申请不可确认打款", 409);
        }
        row.reviewedById = actor.id;
        row.reviewedAt = new Date();
        row.reviewMode = "manual";
        row.revision++;
        await this.moveReserve(manager, actor, row);
        row.status = "paid";
        await manager.getRepository(WithdrawalRequestEntity).save(row);
        await this.auditState(manager, actor, "withdrawal.paid", row);
      }
      const result = await this.payoutView(manager, row);
      await this.audit.record(manager, actor, "withdrawal.recipient_viewed", { id, name: id }, "查看提现收款信息", null, { requestId: id });
      return result;
    });
  }
}
