import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import type { PublicUser } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { csvDocument } from "../csv/csv.js";
import { WalletBalanceEntity, WalletTransactionEntity } from "../database/entities/wallet.entity.js";
import { WithdrawalBatchEntity, WithdrawalRequestEntity, WithdrawalRegistrationEntity, WithdrawalEventEntity, type WithdrawalStatus } from "../database/entities/withdrawal.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { PayoutEvidenceService } from "./payout-evidence.service.js";
import { WalletFailure } from "./wallet.failure.js";
import { centsMoney, decryptRecipient, encryptRecipient, moneyCents, normalizeWithdrawal, payoutHash, payoutKey, requiredText, type WithdrawalInput } from "./payout-recipient.js";

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
    if (actor.role !== "admin") throw new WalletFailure("FORBIDDEN", "仅管理员可操作财务提现", 403);
  }
  private async lockedBalance(manager: EntityManager, ownerId: string) {
    await manager.getRepository(WalletBalanceEntity).createQueryBuilder().insert().values({ ownerId }).orIgnore().execute();
    return manager.getRepository(WalletBalanceEntity).findOneOrFail({ where: { ownerId }, lock: { mode: "pessimistic_write" } });
  }
  private async auditState(manager: EntityManager, actor: PublicUser, action: string, row: WithdrawalRequestEntity) {
    await this.audit.record(manager, actor, action, { id: row.ownerId, name: row.ownerId }, `提现 ${row.id}：${row.status}`, null,
      { requestId: row.id, batchId: row.batchId, status: row.status, amount: row.amount, accountMasked: row.accountMasked });
    await manager.getRepository(WithdrawalEventEntity).insert({ id: `WE-${randomUUID()}`, requestId: row.id, action,
      actorId: actor.id, actorName: actor.displayName, reason: row.reason, registrationId: row.latestRegistrationId,
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
  async claim(actor: PublicUser, ids: string[]) {
    this.admin(actor);
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || id.length > 64)) throw new WalletFailure("VALIDATION", "请选择 1 至 100 条不同申请", 400);
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor);
      const repo = manager.getRepository(WithdrawalRequestEntity);
      const rows = await repo.createQueryBuilder("request").where("request.id IN (:...ids)", { ids }).orderBy("request.id", "ASC").setLock("pessimistic_write").getMany();
      if (rows.length !== ids.length || rows.some(row => row.status !== "pending" || row.batchId)) throw new WalletFailure("STATE_CONFLICT", "部分申请已被领取或不再待处理，请刷新；未创建批次", 409);
      const batch = await manager.getRepository(WithdrawalBatchEntity).save({ id: `WB-${randomUUID()}`, createdBy: actor.id });
      for (const row of rows) {
        row.status = "processing"; row.batchId = batch.id; row.assigneeId = actor.id; row.assignedAt = new Date(); row.revision++;
        await repo.save(row);
        await this.auditState(manager, actor, "withdrawal.claimed", row);
      }
      const requests = [];
      for (const row of rows) requests.push(await this.view(manager, row));
      return { batchId: batch.id, requests };
    });
  }
  async exportBatch(actor: PublicUser, batchId: string) {
    this.admin(actor);
    const key = payoutKey();
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor);
      const batch = await manager.getRepository(WithdrawalBatchEntity).findOneBy({ id: batchId });
      if (!batch) throw new WalletFailure("NOT_FOUND", "批次不存在", 404);
      const rows = await manager.getRepository(WithdrawalRequestEntity).createQueryBuilder("request").addSelect("request.recipientEncrypted").where("request.batchId = :batchId", { batchId }).orderBy("request.id", "ASC").setLock("pessimistic_write").getMany();
      if (rows.some(row => row.status === "processing" && row.assigneeId !== actor.id)) throw new WalletFailure("FORBIDDEN", "处理中收款信息仅经办人可导出", 403);
      const csvRows = [["request_id", "batch_id", "owner_id", "owner_name", "method", "recipient_name", "account_text", "bank_name", "amount_CNY", "submitted_at", "current_status", "notice"]];
      for (const row of rows) {
        const recipient = decryptRecipient(row.recipientEncrypted, row.id, key);
        const owner = await manager.getRepository(UserEntity).findOneBy({ id: row.ownerId });
        // Apostrophe is an intentional text marker, not an Excel formula. Import account_text as text and remove the marker before transfer.
        csvRows.push([row.id, batchId, row.ownerId, owner?.displayName ?? row.ownerId, recipient.method, recipient.name, `'${recipient.account}`, recipient.bankName, row.amount, row.createdAt.toISOString(), row.status, "EXPORT IS NOT PAYMENT; reconcile request_id before transfer"]);
      }
      const csv = csvDocument(csvRows);
      await this.audit.record(manager, actor, "withdrawal.exported", { id: batchId, name: batchId }, `导出提现批次 ${batchId}（${rows.length} 条），导出不是付款`, null, { batchId, count: rows.length });
      return csv;
    });
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
  private async lockedRequest(manager: EntityManager, id: string, revision?: number) {
    const row = await manager.getRepository(WithdrawalRequestEntity).findOne({ where: { id }, lock: { mode: "pessimistic_write" } });
    if (!row) throw new WalletFailure("NOT_FOUND", "申请不存在", 404);
    if (revision !== undefined && (!Number.isInteger(revision) || revision < 0 || row.revision !== revision)) throw new WalletFailure("STATE_CONFLICT", "申请版本已变化，请刷新", 409);
    return row;
  }
  private state(row: WithdrawalRequestEntity, allowed: WithdrawalStatus[]) {
    if (!allowed.includes(row.status)) throw new WalletFailure("STATE_CONFLICT", "申请状态已变化", 409);
  }
  private owner(actor: PublicUser, row: WithdrawalRequestEntity) {
    if (row.assigneeId !== actor.id) throw new WalletFailure("FORBIDDEN", "仅当前经办人可操作", 403);
  }
  private async reviewPolicy(manager: EntityManager, actor: PublicUser, row: WithdrawalRequestEntity, mode: "independent" | "single") {
    // Stabilize active-admin membership while deciding the explicitly weaker single-admin policy.
    await manager.query("LOCK TABLE users IN SHARE MODE");
    const admins = await manager.getRepository(UserEntity).findBy({ role: "admin", status: "active" });
    if (mode === "single") {
      if (admins.length !== 1 || admins[0]?.id !== actor.id) throw new WalletFailure("FORBIDDEN", "单人确认仅限恰有一名有效管理员", 403);
    } else {
      const previouslyRegistered = await manager.getRepository(WithdrawalRegistrationEntity).existsBy({ requestId: row.id, registeredById: actor.id });
      if (mode !== "independent" || actor.id === row.registeredById || actor.id === row.assigneeId || previouslyRegistered) {
        throw new WalletFailure("FORBIDDEN", "独立复核人不得为当前经办人或任何历史登记人", 403);
      }
    }
  }
  private async save(manager: EntityManager, actor: PublicUser, row: WithdrawalRequestEntity, action: string) {
    row.revision++;
    await manager.getRepository(WithdrawalRequestEntity).save(row);
    await this.auditState(manager, actor, action, row);
    return this.view(manager, row);
  }
  async detail(actor: PublicUser, id: string) {
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor);
      const row = await this.lockedRequest(manager, id);
      const registrations = await manager.getRepository(WithdrawalRegistrationEntity).find({ where: { requestId: id }, order: { requestRevision: "ASC" } });
      const events = await manager.getRepository(WithdrawalEventEntity).find({ where: { requestId: id }, order: { sequence: "ASC" } });
      const admins = await manager.getRepository(UserEntity).find({ where: { role: "admin", status: "active" }, order: { id: "ASC" } });
      return { request: await this.view(manager, row),
        registrations: registrations.map(r => ({ id: r.id, registeredById: r.registeredById, registeredByName: r.registeredByName, transferReference: r.transferReference, paidAt: r.paidAt.toISOString(), evidenceIds: r.evidenceIds, note: r.note, createdAt: r.createdAt.toISOString() })),
        evidence: await this.evidence.listForRequest(manager, id),
        timeline: events.map(e => ({ id: e.id, action: e.action, actorId: e.actorId, actorName: e.actorName, reason: e.reason, registrationId: e.registrationId, createdAt: e.createdAt.toISOString(),
          evidenceIds: Array.isArray(e.details.evidenceIds) ? e.details.evidenceIds.filter((id): id is string => typeof id === "string") : [],
          assignment: e.action === "withdrawal.assigned" && typeof e.details.newAssigneeId === "string" ? {
            fromId: typeof e.details.oldAssigneeId === "string" ? e.details.oldAssigneeId : null,
            fromName: typeof e.details.oldAssigneeName === "string" ? e.details.oldAssigneeName : null,
            toId: e.details.newAssigneeId, toName: typeof e.details.newAssigneeName === "string" ? e.details.newAssigneeName : null,
          } : null })),
        admins: admins.map(a => ({ id: a.id, displayName: a.displayName })), singleConfirmationAllowed: admins.length === 1 && admins[0]?.id === actor.id };
    });
  }
  async summary(actor: PublicUser) {
    await this.activeAdmin(this.dataSource.manager, actor);
    const rows: { status: WithdrawalStatus; count: string; amount: string; overdue_count: string; overdue_amount: string }[] = await this.dataSource.query(
      `SELECT status,count(*)::text count,coalesce(sum(amount),0)::text amount,
       count(*) FILTER(WHERE created_at <= $1)::text overdue_count,
       coalesce(sum(amount) FILTER(WHERE created_at <= $1),0)::text overdue_amount
       FROM withdrawal_requests WHERE status IN ('pending','processing','review_pending','investigating') GROUP BY status`, [new Date(Date.now() - 86_400_000)]);
    const result = { pending: { count: 0, amount: 0 }, processing: { count: 0, amount: 0 }, reviewPending: { count: 0, amount: 0 }, investigating: { count: 0, amount: 0 }, overdue: { count: 0, amount: 0 } };
    let overdueCents = 0;
    for (const row of rows) {
      const key = row.status === "review_pending" ? "reviewPending" : row.status as "pending" | "processing" | "investigating";
      result[key] = { count: Number(row.count), amount: Number(row.amount) };
      result.overdue.count += Number(row.overdue_count); overdueCents += moneyCents(row.overdue_amount);
    }
    result.overdue.amount = Number(centsMoney(overdueCents)); return result;
  }
  async recipient(actor: PublicUser, id: string) {
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor);
      const row = await this.lockedRequest(manager, id);
      if (row.status === "pending") throw new WalletFailure("STATE_CONFLICT", "请先领取申请", 409);
      if (row.status === "processing") this.owner(actor, row);
      const encrypted = await manager.getRepository(WithdrawalRequestEntity).createQueryBuilder("r").addSelect("r.recipientEncrypted").where("r.id=:id", { id }).getOneOrFail();
      const recipient = decryptRecipient(encrypted.recipientEncrypted, id, payoutKey());
      await this.auditState(manager, actor, "withdrawal.recipient_revealed", row);
      return { recipient };
    });
  }
  async assign(actor: PublicUser, id: string, input: { assigneeId: string; reason: string; revision: number }) {
    const reason = requiredText(input.reason, 500);
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor);
      const row = await this.lockedRequest(manager, id, input.revision);
      this.state(row, ["pending", "processing", "review_pending", "investigating"]);
      const target = await manager.getRepository(UserEntity).findOne({ where: { id: input.assigneeId, role: "admin", status: "active" }, lock: { mode: "pessimistic_read" } });
      if (!target) throw new WalletFailure("VALIDATION", "请选择有效管理员", 400);
      if (row.assigneeId === target.id) throw new WalletFailure("STATE_CONFLICT", "已经由此管理员经办", 409);
      const oldAssigneeId = row.assigneeId;
      const oldAssignee = oldAssigneeId ? await manager.getRepository(UserEntity).findOneBy({ id: oldAssigneeId }) : null;
      if (row.status === "pending") {
        const batch = await manager.getRepository(WithdrawalBatchEntity).save({ id: `WB-${randomUUID()}`, createdBy: actor.id });
        row.batchId = batch.id; row.status = "processing";
      }
      row.assigneeId = target.id; row.assignedAt = new Date(); row.revision++;
      await manager.getRepository(WithdrawalRequestEntity).save(row);
      const details = { oldAssigneeId, oldAssigneeName: oldAssignee?.displayName ?? null, newAssigneeId: target.id, newAssigneeName: target.displayName, revision: row.revision, amount: row.amount };
      await manager.getRepository(WithdrawalEventEntity).insert({ id: `WE-${randomUUID()}`, requestId: id, actorId: actor.id, actorName: actor.displayName, action: "withdrawal.assigned", reason, registrationId: row.latestRegistrationId, details });
      await this.audit.record(manager, actor, "withdrawal.assigned", { id, name: id }, reason, { assigneeId: oldAssigneeId }, details);
      return this.view(manager, row);
    });
  }
  async register(actor: PublicUser, id: string, input: { transferReference: string; paidAt: string; evidenceIds: string[]; note?: string; revision: number }) {
    const reference = requiredText(input.transferReference, 120), note = input.note ? requiredText(input.note, 500) : null;
    const paidAt = new Date(input.paidAt);
    if (!Number.isFinite(paidAt.getTime()) || paidAt.getTime() > Date.now()) throw new WalletFailure("VALIDATION", "请提供非未来实际转账时间", 400);
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor);
      const row = await this.lockedRequest(manager, id, input.revision);
      this.state(row, ["processing", "investigating"]); this.owner(actor, row);
      if (paidAt < row.createdAt) throw new WalletFailure("VALIDATION", "转账时间早于申请", 400);
      await this.evidence.validateForRegistration(manager, actor, row, input.evidenceIds);
      await manager.query(`INSERT INTO withdrawal_payment_references(method,transfer_reference,request_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [row.method, reference, id]);
      const refs: { request_id: string }[] = await manager.query(`SELECT request_id FROM withdrawal_payment_references WHERE method=$1 AND transfer_reference=$2`, [row.method, reference]);
      if (refs[0]?.request_id !== id) throw new WalletFailure("DUPLICATE_REFERENCE", "同渠道参考号已用于另一申请，存在重复付款风险", 409);
      const registration = manager.getRepository(WithdrawalRegistrationEntity).create({ id: `PR-${randomUUID()}`, requestId: id, requestRevision: row.revision,
        registeredById: actor.id, registeredByName: actor.displayName, transferReference: reference, paidAt, evidenceIds: input.evidenceIds, note });
      await manager.getRepository(WithdrawalRegistrationEntity).insert(registration);
      row.latestRegistrationId = registration.id; row.registeredById = actor.id; row.transferReference = reference; row.paidAt = paidAt;
      row.status = "review_pending"; row.reason = null; row.reviewedById = null; row.reviewedAt = null; row.reviewMode = null;
      return this.save(manager, actor, row, "withdrawal.registered");
    });
  }
  async review(actor: PublicUser, id: string, input: { decision: "approve" | "return"; mode: "independent" | "single"; reason?: string; revision: number }) {
    if (!["approve", "return"].includes(input.decision)) throw new WalletFailure("VALIDATION", "复核决定无效", 400);
    const reason = input.decision === "return" ? requiredText(input.reason, 500) : input.reason ? requiredText(input.reason, 500) : null;
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor);
      const row = await this.lockedRequest(manager, id, input.revision); this.state(row, ["review_pending"]);
      await this.reviewPolicy(manager, actor, row, input.mode);
      if (!row.latestRegistrationId) throw new WalletFailure("STATE_CONFLICT", "缺少付款登记", 409);
      const registration = await manager.getRepository(WithdrawalRegistrationEntity).findOneByOrFail({ id: row.latestRegistrationId, requestId: id });
      if (!registration.evidenceIds.length || registration.registeredById !== row.registeredById) throw new WalletFailure("STATE_CONFLICT", "付款登记不匹配", 409);
      row.reason = reason; row.reviewedById = actor.id; row.reviewedAt = new Date(); row.reviewMode = input.mode;
      if (input.decision === "approve") { await this.moveReserve(manager, actor, row, true); row.status = "paid"; }
      else row.status = "investigating";
      return this.save(manager, actor, row, `withdrawal.${input.decision === "approve" ? "paid" : "returned"}`);
    });
  }
  async investigate(actor: PublicUser, id: string, input: { reason: string; revision: number }) {
    const reason = requiredText(input.reason, 500);
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor); const row = await this.lockedRequest(manager, id, input.revision);
      this.state(row, ["processing", "review_pending"]); if (row.status === "processing") this.owner(actor, row);
      row.status = "investigating"; row.reason = reason; return this.save(manager, actor, row, "withdrawal.investigating");
    });
  }
  async resolveUnpaid(actor: PublicUser, id: string, input: { reason: string; fundsNotTransferred: boolean; evidenceIds: string[]; revision: number; mode?: "independent" | "single" }) {
    const reason = requiredText(input.reason, 500);
    if (input.fundsNotTransferred !== true) throw new WalletFailure("VALIDATION", "必须明确确认未转账或资金已退回", 400);
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor); const row = await this.lockedRequest(manager, id, input.revision); this.state(row, ["investigating"]);
      if (row.latestRegistrationId) await this.reviewPolicy(manager, actor, row, input.mode ?? "independent");
      else this.owner(actor, row);
      await this.evidence.validateForRegistration(manager, actor, row, input.evidenceIds);
      await this.moveReserve(manager, actor, row, false); row.status = "failed"; row.reason = reason;
      row.reviewedById = actor.id; row.reviewedAt = new Date(); row.reviewMode = row.latestRegistrationId ? input.mode ?? "independent" : null;
      await manager.getRepository(WithdrawalEventEntity).insert({ id: `WE-${randomUUID()}`, requestId: id, actorId: actor.id, actorName: actor.displayName,
        action: "withdrawal.unpaid_evidence", reason, registrationId: row.latestRegistrationId, details: { evidenceIds: input.evidenceIds, fundsNotTransferred: true, revision: row.revision, reviewMode: row.reviewMode } });
      return this.save(manager, actor, row, "withdrawal.failed");
    });
  }
  private async moveReserve(manager: EntityManager, actor: PublicUser, row: WithdrawalRequestEntity, paid: boolean) {
    const balance = await this.lockedBalance(manager, row.ownerId), cents = moneyCents(row.amount);
    if (moneyCents(balance.reservedBalance) < cents) throw new WalletFailure("BALANCE_CONFLICT", "预留余额异常，请核对", 409);
    const before = { reservedBalance: balance.reservedBalance, availableBalance: balance.availableBalance, withdrawnBalance: balance.withdrawnBalance };
    balance.reservedBalance = centsMoney(moneyCents(balance.reservedBalance) - cents);
    if (paid) {
      balance.withdrawnBalance = centsMoney(moneyCents(balance.withdrawnBalance) + cents);
      balance.cumulativeWithdrawn = centsMoney(moneyCents(balance.cumulativeWithdrawn) + cents);
      await manager.getRepository(WalletTransactionEntity).insert({ id: `WT-${randomUUID()}`, ownerId: row.ownerId, type: "withdraw", amount: `-${row.amount}`, balanceAfter: balance.totalBalance, remark: `人工付款确认：${row.id}`, createdByAccountId: actor.id });
    } else balance.availableBalance = centsMoney(moneyCents(balance.availableBalance) + cents);
    await manager.getRepository(WalletBalanceEntity).save(balance);
    await this.audit.record(manager, actor, paid ? "withdrawal.reserve_paid" : "withdrawal.reserve_released", { id: row.id, name: row.id }, `提现 ${row.id}`, before,
      { reservedBalance: balance.reservedBalance, availableBalance: balance.availableBalance, withdrawnBalance: balance.withdrawnBalance, requestId: row.id, registrationId: row.latestRegistrationId, revision: row.revision, reviewMode: row.reviewMode });
  }
  async transition(actor: PublicUser, id: string, input: { status: "rejected"; reason?: string }) {
    this.admin(actor);
    if (input.status !== "rejected") throw new WalletFailure("VALIDATION", "直接付款或失败入口已停用", 400);
    const reason = requiredText(input.reason, 500);
    return this.dataSource.transaction(async manager => {
      await this.activeAdmin(manager, actor); const row = await this.lockedRequest(manager, id);
      if (row.status === "rejected" && row.reason === reason) return this.view(manager, row);
      this.state(row, ["pending"]); await this.moveReserve(manager, actor, row, false);
      row.status = "rejected"; row.reason = reason; return this.save(manager, actor, row, "withdrawal.rejected");
    });
  }
}
