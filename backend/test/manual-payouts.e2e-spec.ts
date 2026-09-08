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
import { WithdrawalEvidenceEntity } from "../src/database/entities/withdrawal-evidence.entity.js";

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
  async function proof(requestId: string, uploader = admin) {
    const id = `PE-${randomBytes(12).toString("hex")}`;
    await db.getRepository(WithdrawalEvidenceEntity).insert({ id, requestId, originalFileName: "receipt.png", contentType: "image/png", sizeBytes: "8", sha256: "a".repeat(64), uploadedById: uploader.id, objectKey: `private-test/${id}` });
    return id;
  }

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
    await request(app.getHttpServer()).post(`/api/v1/wallet/withdrawals/${row.id}/status`).set("Origin", origin).set("x-test-actor", "admin").send({ status: "paid", transferReference: "ref", paidAt: new Date().toISOString() }).expect(400);
    const batch = await payouts.claim(admin, [row.id]);
    await expect(payouts.claim(admin, [row.id])).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    await expect(db.getRepository(WithdrawalRequestEntity).update(row.id, { batchId: null })).rejects.toThrow("immutable");
    await payouts.exportBatch(admin, batch.batchId);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ reservedBalance: 8, withdrawnBalance: 0 });
    const registration = { transferReference: "bank-ref-001", paidAt: new Date().toISOString(), evidenceIds: [await proof(row.id)], revision: 1 };
    const attempts = await Promise.allSettled([payouts.register(admin, row.id, registration), payouts.register(admin, row.id, registration)]);
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
    await expect(payouts.review(admin, row.id, { decision: "approve", mode: "independent", revision: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const confirmations = await Promise.allSettled([payouts.review(reviewer, row.id, { decision: "approve", mode: "independent", revision: 2 }), payouts.review(reviewer, row.id, { decision: "approve", mode: "independent", revision: 2 })]);
    expect(confirmations.filter(r => r.status === "fulfilled")).toHaveLength(1);
    await expect(payouts.investigate(admin, row.id, { reason: "ambiguous", revision: 3 })).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    await expect(db.getRepository(WithdrawalRequestEntity).update(row.id, { status: "investigating" })).rejects.toThrow("immutable");
    expect(await wallet.getWallet(collector.id)).toMatchObject({ totalBalance: 13, availableBalance: 5, reservedBalance: 2, withdrawnBalance: 6, cumulativeWithdrawn: 6 });
    expect((await wallet.listTransactions(collector, collector.id)).filter(tx => tx.type === "withdraw").map(tx => tx.amount)).toEqual([-6]);
  });

  it("rejects pending or definitively fails processing and releases only once", async () => {
    const pending = await payouts.submit(collector, input("rejected"));
    const rejection = { status: "rejected" as const, reason: "recipient could not be verified" };
    await Promise.all([payouts.transition(admin, pending.id, rejection), payouts.transition(admin, pending.id, rejection)]);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ availableBalance: 10, reservedBalance: 0 });
    const processing = await payouts.submit(collector, input("failed"));
    await payouts.claim(admin, [processing.id]);
    await expect(payouts.transition(admin, processing.id, rejection)).rejects.toMatchObject({ code: "STATE_CONFLICT" });
    await request(app.getHttpServer()).post(`/api/v1/wallet/withdrawals/${processing.id}/status`).set("Origin", origin).set("x-test-actor", "admin").send({ status: "failed", reason: "bank result unknown" }).expect(400);
    const unknown = await payouts.investigate(admin, processing.id, { reason: "bank result unknown", revision: 1 });
    expect(await wallet.getWallet(collector.id)).toMatchObject({ availableBalance: 4, reservedBalance: 6 });
    const failure = { reason: "finance verified bank returned the transfer", fundsNotTransferred: true, evidenceIds: [await proof(processing.id)], revision: unknown.revision };
    const releases = await Promise.allSettled([payouts.resolveUnpaid(admin, processing.id, failure), payouts.resolveUnpaid(admin, processing.id, failure)]);
    expect(releases.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ availableBalance: 10, reservedBalance: 0, withdrawnBalance: 0 });
    expect(await db.getRepository(WalletTransactionEntity).count()).toBe(0);
    const resolutionTimeline = (await payouts.detail(admin, processing.id)).timeline;
    expect(resolutionTimeline.find(event => event.action === "withdrawal.unpaid_evidence")).toMatchObject({ evidenceIds: failure.evidenceIds, assignment: null });
    expect(resolutionTimeline.every(event => !("details" in event))).toBe(true);
  });

  it("encrypts snapshots, masks ordinary responses, protects cross-user/team reads and explicit exports", async () => {
    const row = await payouts.submit(collector, input("privacy"));
    expect(JSON.stringify(row)).not.toContain(input("privacy").account);
    expect(JSON.stringify(await payouts.list(admin))).not.toContain(input("privacy").name);
    expect((await payouts.list(other)).requests).toEqual([]);
    await expect(payouts.list(other, { ownerId: collector.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(payouts.list(leader)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(wallet.listTransactions(leader, other.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(wallet.listTransactions(other, collector.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await wallet.listTransactions(leader, collector.id)).toEqual([]);
    expect(await wallet.listWallets({ ...leader, teamId: undefined })).toEqual([]);
    const batch = await payouts.claim(admin, [row.id]);
    await expect(payouts.exportBatch(collector, batch.batchId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(payouts.claim(collector, [row.id])).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(payouts.investigate(collector, row.id, { reason: "cancel", revision: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ciphertext = (await db.query("SELECT recipient_encrypted FROM withdrawal_requests WHERE id = $1", [row.id]))[0].recipient_encrypted as string;
    expect(ciphertext).not.toContain(input("privacy").account);
    expect(JSON.stringify(await db.getRepository(AuditLogEntity).find())).not.toContain(input("privacy").account);
    await request(app.getHttpServer()).post(`/api/v1/wallet/withdrawal-batches/${batch.batchId}/export`).set("Origin", origin).set("x-test-actor", "collector").expect(403);
    await request(app.getHttpServer()).get(`/api/v1/wallet/transactions?ownerId=${other.id}`).set("x-test-actor", "leader").expect(403);
  });

  it("preserves return history and reserve, requires evidence, handover ownership and independent resolution", async () => {
    const row = await payouts.submit(collector, input("returned"));
    await payouts.claim(admin, [row.id]);
    await expect(payouts.register(admin, row.id, { transferReference: "return-ref", paidAt: new Date().toISOString(), evidenceIds: [], revision: 1 })).rejects.toThrow();
    await payouts.register(admin, row.id, { transferReference: "return-ref", paidAt: new Date().toISOString(), evidenceIds: [await proof(row.id)], revision: 1 });
    await payouts.review(reviewer, row.id, { decision: "return", mode: "independent", reason: "bank result needs reconciliation", revision: 2 });
    expect(await wallet.getWallet(collector.id)).toMatchObject({ availableBalance: 4, reservedBalance: 6, withdrawnBalance: 0 });
    await expect(payouts.resolveUnpaid(admin, row.id, { reason: "returned", fundsNotTransferred: true, evidenceIds: [await proof(row.id)], revision: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await payouts.assign(reviewer, row.id, { assigneeId: reviewer.id, reason: "explicit handover", revision: 3 });
    await expect(payouts.register(admin, row.id, { transferReference: "return-ref", paidAt: new Date().toISOString(), evidenceIds: [await proof(row.id)], revision: 4 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await payouts.detail(reviewer, row.id)).registrations).toHaveLength(1);
    await db.getRepository(UserEntity).update(reviewer.id, { displayName: "Renamed after handover" });
    try {
      const detail = await payouts.detail(admin, row.id);
      expect(detail.timeline.find(event => event.action === "withdrawal.assigned")).toMatchObject({
        evidenceIds: [], assignment: { fromId: admin.id, fromName: admin.displayName, toId: reviewer.id, toName: reviewer.displayName },
      });
      expect(detail.timeline.find(event => event.action === "withdrawal.returned")).toMatchObject({ evidenceIds: [], assignment: null });
    } finally { await db.getRepository(UserEntity).update(reviewer.id, { displayName: reviewer.displayName }); }
    const retainedProof = (await payouts.detail(reviewer, row.id)).evidence[0]!;
    await payouts.register(reviewer, row.id, { transferReference: "return-ref", paidAt: new Date().toISOString(), evidenceIds: [retainedProof.id], revision: 4 });
    await expect(payouts.review(admin, row.id, { decision: "approve", mode: "independent", revision: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await wallet.getWallet(collector.id)).toMatchObject({ reservedBalance: 6, withdrawnBalance: 0 });
    await request(app.getHttpServer()).get(`/api/v1/wallet/withdrawals/${row.id}`).set("x-test-actor", "collector").expect(403);
    await request(app.getHttpServer()).post(`/api/v1/wallet/withdrawals/${row.id}/recipient`).set("Origin", "https://evil.invalid").set("x-test-actor", "admin").send({}).expect(403);
  });

  it("permits explicit single confirmation only with exactly one active admin", async () => {
    const row = await payouts.submit(collector, input("single"));
    await payouts.claim(admin, [row.id]);
    await payouts.register(admin, row.id, { transferReference: "single-ref", paidAt: new Date().toISOString(), evidenceIds: [await proof(row.id)], revision: 1 });
    await expect(payouts.review(admin, row.id, { decision: "approve", mode: "single", revision: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await db.getRepository(UserEntity).update(reviewer.id, { status: "disabled" });
    expect(await payouts.review(admin, row.id, { decision: "approve", mode: "single", revision: 2 })).toMatchObject({ status: "paid", reviewMode: "single", reviewedById: admin.id });
  });

  it("serializes cross-request reference uniqueness and rejects foreign evidence", async () => {
    const a = await payouts.submit(collector, input("duplicate-a", 3));
    const b = await payouts.submit(collector, input("duplicate-b", 3));
    await payouts.claim(admin, [b.id, a.id]);
    const evidenceA = await proof(a.id), evidenceB = await proof(b.id);
    await expect(payouts.register(admin, b.id, { transferReference: "foreign", paidAt: new Date().toISOString(), evidenceIds: [evidenceA], revision: 1 })).rejects.toThrow();
    const attempts = await Promise.allSettled([
      payouts.register(admin, a.id, { transferReference: "same-bank-reference", paidAt: new Date().toISOString(), evidenceIds: [evidenceA], revision: 1 }),
      payouts.register(admin, b.id, { transferReference: "same-bank-reference", paidAt: new Date().toISOString(), evidenceIds: [evidenceB], revision: 1 }),
    ]);
    expect(attempts.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(r => r.status === "rejected").map(r => r.reason.code)).toEqual(["DUPLICATE_REFERENCE"]);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ reservedBalance: 6, withdrawnBalance: 0 });
  });

  it("exports immutable membership, preserves all long account digits as text and neutralizes formulas", async () => {
    const first = await payouts.submit(collector, input("csv", 3));
    const batch = await payouts.claim(admin, [first.id]);
    await payouts.submit(collector, { ...input("later", 2), account: "+formula()", name: "Other recipient" });
    const csv = await payouts.exportBatch(admin, batch.batchId);
    expect(csv).toContain(",'00123456789012345678901234567890,");
    expect(csv).toContain(",'=malicious(),");
    expect(csv).toContain(",'@bank,");
    expect(csv).not.toContain("+formula()");
    expect(await payouts.exportBatch(admin, batch.batchId)).toBe(csv);
    expect((await payouts.list(admin, { batchId: batch.batchId })).requests.map(row => row.id)).toEqual([first.id]);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ reservedBalance: 5, withdrawnBalance: 0 });
    const key = process.env.PAYOUT_RECIPIENT_KEY!;
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", "");
    await expect(payouts.submit(collector, input("missing", 1))).rejects.toMatchObject({ code: "PAYOUT_UNAVAILABLE" });
    await expect(payouts.exportBatch(admin, batch.batchId)).rejects.toMatchObject({ code: "PAYOUT_UNAVAILABLE" });
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", randomBytes(32).toString("hex"));
    await expect(payouts.exportBatch(admin, batch.batchId)).rejects.toMatchObject({ code: "PAYOUT_UNAVAILABLE" });
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", key);
    expect(await wallet.getWallet(collector.id)).toMatchObject({ availableBalance: 5, reservedBalance: 5 });
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
    db.migrations.splice(0, db.migrations.length, ...allMigrations); await db.runMigrations();
    expect(await db.getRepository(WalletBalanceEntity).findOneByOrFail({ ownerId: collector.id })).toEqual(balanceBefore);
    expect(await db.getRepository(WithdrawalRequestEntity).findOneByOrFail({ id: "WR-LEGACY-A" })).toMatchObject({ status: "processing", amount: "8.00", assigneeId: admin.id, latestRegistrationId: null, reviewMode: null });
    expect(await db.getRepository(WithdrawalRequestEntity).findOneByOrFail({ id: "WR-LEGACY-PAID" })).toMatchObject({ status: "paid", reviewMode: "legacy", reviewedById: null, reviewedAt: null });
    expect(await db.query("SELECT * FROM withdrawal_registrations")).toEqual([]);
    expect(await db.query("SELECT action,details->>'legacyAuditId' AS source FROM withdrawal_events WHERE request_id='WR-LEGACY-A'")).toEqual([{ action: "withdrawal.claimed", source: "AUD-LEGACY" }]);
  } finally { await db.destroy(); }
});
