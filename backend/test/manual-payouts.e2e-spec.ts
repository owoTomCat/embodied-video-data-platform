import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import request from "supertest";
import { createDataSource, identityEntities } from "../src/database/data-source.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { WalletBalanceEntity, WalletTransactionEntity } from "../src/database/entities/wallet.entity.js";
import { WithdrawalRequestEntity } from "../src/database/entities/withdrawal.entity.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { WalletModule } from "../src/wallet/wallet.module.js";
import { WalletService } from "../src/wallet/wallet.service.js";
import { PayoutService } from "../src/wallet/payout.service.js";
import { SessionGuard } from "../src/auth/session.guard.js";
import type { PublicUser } from "../src/auth/auth.types.js";
import { configureApplication } from "../src/http/configure-application.js";
import { OBJECT_STORAGE } from "../src/storage/object-storage.port.js";

const origin = "http://localhost:3000";
const actor = (id: string, role: PublicUser["role"], teamId?: string): PublicUser => ({ id, role, teamId, displayName: id, username: id, status: "active", updatedAt: 0 });
const admin = actor("payout-admin", "admin");
const reviewer = actor("payout-reviewer", "admin");
const collector = actor("payout-collector", "collector", "payout-team-a");
const other = actor("payout-other", "collector", "payout-team-b");
const leader = actor("payout-leader", "leader", "payout-team-a");
const input = (idempotencyKey: string, amount = 6) => ({ idempotencyKey, amount, method: "bank" as const, account: "00123456789012345678901234567890", name: "=malicious()", bankName: "@bank" });

describe("manual payouts", () => {
  let db: DataSource;
  let app: INestApplication;
  let payouts: PayoutService;
  let wallet: WalletService;
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error("Explicit disposable TEST_DATABASE_URL required for manual payout regressions");
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", randomBytes(32).toString("hex"));
    db = createDataSource(url);
    await db.initialize();
    await db.dropDatabase();
    await db.runMigrations();
    await db.getRepository(TeamEntity).save([{ id: "payout-team-a", name: "A" }, { id: "payout-team-b", name: "B" }]);
    await db.getRepository(UserEntity).save([admin, reviewer, collector, other, leader].map(user => ({ id: user.id, displayName: user.displayName, username: user.username, usernameNormalized: user.username, role: user.role, teamId: user.teamId ?? null, status: "active" as const, passwordHash: "not-used-by-this-guard-test" })));
    const module = await Test.createTestingModule({ imports: [TypeOrmModule.forRoot({ type: "postgres", url, entities: identityEntities, synchronize: false }), WalletModule] })
      .overrideProvider(OBJECT_STORAGE).useValue({})
      .overrideGuard(SessionGuard).useValue({ canActivate(context: { switchToHttp(): { getRequest(): { user?: PublicUser; headers: Record<string, string> } } }) {
        const req = context.switchToHttp().getRequest();
        const users: Record<string, PublicUser> = { admin, reviewer, collector, other, leader };
        req.user = users[req.headers["x-test-actor"] ?? "collector"];
        return true;
      } }).compile();
    app = module.createNestApplication(); configureApplication(app); await app.init();
    payouts = module.get(PayoutService); wallet = module.get(WalletService);
  });
  beforeEach(async () => {
    await db.query("TRUNCATE withdrawal_requests, withdrawal_batches, wallet_transactions, wallet_balances, audit_logs CASCADE");
    await db.getRepository(UserEntity).update(reviewer.id, { status: "active" });
    await db.getRepository(WalletBalanceEntity).save({ ownerId: collector.id, totalBalance: "10.00", availableBalance: "10.00" });
  });
  afterAll(async () => { await app?.close(); if (db?.isInitialized) await db.destroy(); vi.unstubAllEnvs(); });

  it("serializes competing requests and retries without double spending or changing snapshots", async () => {
    const results = await Promise.allSettled([payouts.submit(collector, input("first")), payouts.submit(collector, input("second"))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected").map(result => result.reason.code)).toEqual(["INSUFFICIENT_BALANCE"]);
    const stored = await db.getRepository(WithdrawalRequestEntity).findOneByOrFail({ ownerId: collector.id });
    const retries = await Promise.all([payouts.submit(collector, input(stored.idempotencyKey)), payouts.submit(collector, input(stored.idempotencyKey))]);
    expect(retries.map(row => row.id)).toEqual([stored.id, stored.id]);
    await expect(payouts.submit(collector, { ...input(stored.idempotencyKey), account: "different" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await wallet.getWallet(collector.id)).toMatchObject({ totalBalance: 10, availableBalance: 4, reservedBalance: 6, withdrawnBalance: 0 });
    expect(await wallet.listTransactions(collector, collector.id)).toEqual([]);
    await expect(db.getRepository(WithdrawalRequestEntity).update(stored.id, { amount: "1.00" })).rejects.toThrow("immutable");
  });

  it("keeps reservations through concurrent credit/settlement and pays exactly once after manual confirmation", async () => {
    const row = await payouts.submit(collector, input("paid"));
    await Promise.all([
      db.transaction(manager => wallet.creditSettling(manager, { ownerId: collector.id, amount: 3, cycleId: "cycle-manual" })),
      payouts.submit(collector, input("more", 2)),
    ]);
    await db.transaction(manager => wallet.settleToAvailable(manager, { ownerId: collector.id, amount: 3, cycleId: "cycle-manual" }));
    expect(await wallet.getWallet(collector.id)).toMatchObject({ totalBalance: 13, availableBalance: 5, reservedBalance: 8 });
    const confirmations = await Promise.all([payouts.confirm(admin, row.id), payouts.confirm(reviewer, row.id)]);
    expect(confirmations[0]).toEqual(confirmations[1]);
    expect(confirmations[0]).toMatchObject({ status: "paid", batchId: null, transferReference: null, paidAt: null });
    expect([admin.id, reviewer.id]).toContain(confirmations[0].confirmedById);
    expect(confirmations[0].confirmedAt).not.toBeNull();
    expect(await payouts.confirm(reviewer, row.id)).toEqual(confirmations[0]);
    await expect(db.getRepository(WithdrawalRequestEntity).update(row.id, { status: "pending" })).rejects.toThrow("immutable");
    const events = await db.query("SELECT actor_id FROM withdrawal_events WHERE request_id=$1 AND action='withdrawal.paid'", [row.id]);
    expect(events).toEqual([{ actor_id: confirmations[0].confirmedById }]);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ totalBalance: 13, availableBalance: 5, reservedBalance: 2, withdrawnBalance: 6, cumulativeWithdrawn: 6 });
    expect((await wallet.listTransactions(collector, collector.id)).filter(tx => tx.type === "withdraw").map(tx => tx.amount)).toEqual([-6]);
  });

  it("exposes full snapshots only to active admins and audits reads without plaintext", async () => {
    const row = await payouts.submit(collector, input("privacy"));
    expect(JSON.stringify(row)).not.toContain(input("privacy").account);
    expect(JSON.stringify(await payouts.list(collector))).not.toContain(input("privacy").account);
    expect((await payouts.list(other)).requests).toEqual([]);
    await expect(payouts.list(other, { ownerId: collector.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const role of ["collector", "leader"]) {
      await request(app.getHttpServer()).get("/api/v1/wallet/payouts").set("x-test-actor", role).expect(403);
      await request(app.getHttpServer()).post(`/api/v1/wallet/payouts/${row.id}/confirm`).set("Origin", origin).set("x-test-actor", role).expect(403);
    }
    await db.getRepository(UserEntity).update(reviewer.id, { status: "disabled" });
    await request(app.getHttpServer()).get("/api/v1/wallet/payouts").set("x-test-actor", "reviewer").expect(403);
    await request(app.getHttpServer()).post(`/api/v1/wallet/payouts/${row.id}/confirm`).set("Origin", origin).set("x-test-actor", "reviewer").expect(403);
    const table = await request(app.getHttpServer()).get("/api/v1/wallet/payouts").set("x-test-actor", "admin").expect(200);
    expect(table.headers["cache-control"]).toBe("no-store");
    expect(table.body.requests[0]).toMatchObject({ id: row.id, recipient: { method: "bank", name: input("privacy").name, account: input("privacy").account, bankName: "@bank" }, confirmedAt: null });
    await request(app.getHttpServer()).post(`/api/v1/wallet/payouts/${row.id}/confirm`).set("Origin", "https://evil.invalid").set("x-test-actor", "admin").expect(403);
    const paid = await request(app.getHttpServer()).post(`/api/v1/wallet/payouts/${row.id}/confirm`).set("Origin", origin).set("x-test-actor", "admin").expect(200);
    expect(paid.body.request).toMatchObject({ status: "paid", confirmedById: admin.id });
    expect(paid.headers["cache-control"]).toBe("no-store");
    const ciphertext = (await db.query("SELECT recipient_encrypted FROM withdrawal_requests WHERE id=$1", [row.id]))[0].recipient_encrypted;
    expect(ciphertext).not.toContain(input("privacy").account);
    const audits = JSON.stringify(await db.getRepository(AuditLogEntity).find());
    expect(audits).not.toContain(input("privacy").account);
    expect(audits).not.toContain(input("privacy").name);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ reservedBalance: 0, withdrawnBalance: 6 });
  });

  it("filters before pagination and includes every historical nonterminal state", async () => {
    const rows = [];
    for (let i = 0; i < 4; i++) rows.push(await payouts.submit(collector, input(`search-${i}`, 1)));
    await db.query("INSERT INTO withdrawal_batches(id,created_by) VALUES('WB-OLD',$1)", [admin.id]);
    for (const [index, status] of ["processing", "review_pending", "investigating"].entries()) {
      await db.query("UPDATE withdrawal_requests SET status=$2,batch_id='WB-OLD',assignee_id=$3 WHERE id=$1", [rows[index + 1]!.id, status, admin.id]);
    }
    expect((await payouts.listPayouts(admin)).pagination.total).toBe(4);
    for (const q of [rows[0]!.id, collector.id, collector.username, "A"]) {
      const result = await payouts.listPayouts(admin, { q, pageSize: 1 });
      expect(result.requests).toHaveLength(1);
      expect(result.pagination.total).toBe(q === rows[0]!.id ? 1 : 4);
    }
    for (const row of rows) expect(await payouts.confirm(reviewer, row.id)).toMatchObject({ status: "paid", confirmedById: reviewer.id });
    expect((await payouts.listPayouts(admin)).requests).toEqual([]);
    expect((await payouts.listPayouts(admin, { status: "paid", pageSize: 2 })).pagination).toMatchObject({ total: 4, totalPages: 2 });
    expect(await wallet.getWallet(collector.id)).toMatchObject({ availableBalance: 6, reservedBalance: 0, withdrawnBalance: 4 });
  });

  it("preserves historical paid confirmation and rejects other terminal states", async () => {
    const legacy = await payouts.submit(collector, input("legacy-paid", 1));
    const rejected = await payouts.submit(collector, input("legacy-rejected", 1));
    await db.query("INSERT INTO withdrawal_batches(id,created_by) VALUES('WB-PAID',$1)", [admin.id]);
    await db.query(`UPDATE withdrawal_requests SET status='paid',batch_id='WB-PAID',transfer_reference='old-ref',paid_at='2026-09-01',
      reviewed_by_id=$2,reviewed_at='2026-09-02',review_mode='independent' WHERE id=$1`, [legacy.id, admin.id]);
    await db.query("UPDATE withdrawal_requests SET status='rejected',reason='historical rejection' WHERE id=$1", [rejected.id]);
    const before = await db.query("SELECT * FROM withdrawal_requests WHERE id=$1", [legacy.id]);
    const balance = await wallet.getWallet(collector.id);
    expect(await payouts.confirm(reviewer, legacy.id)).toMatchObject({ confirmedById: admin.id, confirmedAt: "2026-09-02T00:00:00.000Z", transferReference: "old-ref" });
    expect(await db.query("SELECT * FROM withdrawal_requests WHERE id=$1", [legacy.id])).toEqual(before);
    expect(await wallet.getWallet(collector.id)).toEqual(balance);
    expect(await db.getRepository(WalletTransactionEntity).count()).toBe(0);
    await expect(payouts.confirm(admin, rejected.id)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  });

  it("rolls back confirmation when reserves or decryption are unavailable and removes old write routes", async () => {
    const row = await payouts.submit(collector, input("rollback"));
    const key = process.env.PAYOUT_RECIPIENT_KEY!;
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", randomBytes(32).toString("hex"));
    await expect(payouts.confirm(admin, row.id)).rejects.toMatchObject({ code: "PAYOUT_UNAVAILABLE" });
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", key);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ reservedBalance: 6, withdrawnBalance: 0 });
    await db.getRepository(WalletBalanceEntity).update(collector.id, { reservedBalance: "0.00" });
    await expect(payouts.confirm(admin, row.id)).rejects.toMatchObject({ code: "BALANCE_CONFLICT" });
    expect((await payouts.listPayouts(admin)).requests[0]).toMatchObject({ status: "pending", confirmedAt: null });
    for (const suffix of ["assign", "register", "review", "investigate", "resolve-unpaid", "status", "evidence", "recipient"]) {
      await request(app.getHttpServer()).post(`/api/v1/wallet/withdrawals/${row.id}/${suffix}`).set("Origin", origin).set("x-test-actor", "admin").send({}).expect(404);
    }
    await request(app.getHttpServer()).post("/api/v1/wallet/withdrawal-batches").set("Origin", origin).set("x-test-actor", "admin").send({ ids: [row.id] }).expect(404);
  });
});

it("migrates legacy processing and paid without changing balances or inventing review", async () => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Explicit disposable TEST_DATABASE_URL required");
  const db = createDataSource(url);
  await db.initialize();
  try {
    const allMigrations = [...db.migrations];
    db.migrations.splice(0, db.migrations.length, ...allMigrations.filter(m => Number(m.name!.slice(-13)) <= 2_026_092_100_001));
    await db.dropDatabase(); await db.runMigrations();
    await db.getRepository(TeamEntity).save({ id: collector.teamId!, name: "历史提现测试团队" });
    await db.getRepository(UserEntity).save([admin, collector].map(user => ({ id: user.id, displayName: user.displayName, username: user.username, usernameNormalized: user.username, role: user.role, teamId: user.teamId ?? null, status: "active" as const, passwordHash: "unused" })));
    await db.getRepository(WalletBalanceEntity).save({ ownerId: collector.id, totalBalance: "10.00", availableBalance: "0.90", reservedBalance: "8.10", withdrawnBalance: "1.00", cumulativeWithdrawn: "1.00" });
    await db.query("INSERT INTO withdrawal_batches(id,created_by) VALUES('WB-LEGACY',$1)", [admin.id]);
    for (const [id, amount, status] of [["WR-LEGACY-A", "8.00", "processing"], ["WR-LEGACY-B", "0.10", "processing"], ["WR-LEGACY-PAID", "1.00", "paid"]]) {
      await db.query(`INSERT INTO withdrawal_requests(id,owner_id,idempotency_key,payload_hash,amount,status,method,recipient_encrypted,account_masked,name_masked,batch_id,transfer_reference,paid_at)
        VALUES($1,$2,$1,'hash',$3,$4::varchar,'bank','original-ciphertext','***1234','X***','WB-LEGACY',CASE WHEN $4::varchar='paid' THEN 'legacy-ref' END,CASE WHEN $4::varchar='paid' THEN now() END)`, [id, collector.id, amount, status]);
    }
    await db.getRepository(AuditLogEntity).insert({ id: "AUD-LEGACY", actorAccountId: admin.id, actorName: admin.displayName, action: "withdrawal.claimed", targetAccountId: collector.id, targetName: collector.id, summary: "Legacy claim", afterValue: { requestId: "WR-LEGACY-A", status: "processing" } });
    const balanceBefore = await db.getRepository(WalletBalanceEntity).findOneByOrFail({ ownerId: collector.id });
    db.migrations.splice(0, db.migrations.length, ...allMigrations.filter(m => Number(m.name!.slice(-13)) <= 2_026_092_300_001));
    await db.runMigrations();
    const requestsBefore = await db.query("SELECT * FROM withdrawal_requests ORDER BY id");
    const batchesBefore = await db.query("SELECT * FROM withdrawal_batches ORDER BY id");
    const eventsBefore = await db.query("SELECT * FROM withdrawal_events ORDER BY sequence");
    db.migrations.splice(0, db.migrations.length, ...allMigrations); await db.runMigrations();
    expect(await db.query("SELECT * FROM withdrawal_requests ORDER BY id")).toEqual(requestsBefore);
    expect(await db.query("SELECT * FROM withdrawal_batches ORDER BY id")).toEqual(batchesBefore);
    expect(await db.query("SELECT * FROM withdrawal_events ORDER BY sequence")).toEqual(eventsBefore);
    expect(await db.getRepository(WalletBalanceEntity).findOneByOrFail({ ownerId: collector.id })).toEqual(balanceBefore);
    expect(await db.getRepository(WithdrawalRequestEntity).findOneByOrFail({ id: "WR-LEGACY-A" })).toMatchObject({ status: "processing", amount: "8.00", assigneeId: admin.id, latestRegistrationId: null, reviewMode: null });
    expect(await db.getRepository(WithdrawalRequestEntity).findOneByOrFail({ id: "WR-LEGACY-PAID" })).toMatchObject({ status: "paid", reviewMode: "legacy", reviewedById: null, reviewedAt: null });
    expect(await db.query("SELECT * FROM withdrawal_registrations")).toEqual([]);
    expect(await db.query("SELECT action,details->>'legacyAuditId' AS source FROM withdrawal_events WHERE request_id='WR-LEGACY-A'")).toEqual([{ action: "withdrawal.claimed", source: "AUD-LEGACY" }]);
  } finally { await db.destroy(); }
});
