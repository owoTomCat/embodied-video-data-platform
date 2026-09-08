import "reflect-metadata";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { DataSource, EntityManager, FindOperator } from "typeorm";
import type { PublicUser } from "../src/auth/auth.types.js";
import { SessionGuard } from "../src/auth/session.guard.js";
import type { AuditService } from "../src/audit/audit.service.js";
import { WithdrawalEvidenceEntity } from "../src/database/entities/withdrawal-evidence.entity.js";
import { WithdrawalEventEntity, WithdrawalRequestEntity } from "../src/database/entities/withdrawal.entity.js";
import type { ObjectStoragePort } from "../src/storage/object-storage.port.js";
import { PayoutEvidenceController, PayoutEvidenceAdminGuard } from "../src/wallet/payout-evidence.controller.js";
import { MAX_PAYOUT_EVIDENCE_BYTES, PayoutEvidenceService } from "../src/wallet/payout-evidence.service.js";

const actor = (id: string, role: PublicUser["role"] = "admin"): PublicUser => ({ id, role, status: "active", displayName: id, username: id, updatedAt: 0 });
const admin = actor("assignee"), reviewer = actor("reviewer"), collector = actor("collector", "collector");
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082", "hex");
const file = (buffer = png, mimetype = "image/png") => ({ buffer, size: buffer.length, mimetype, originalname: "proof.png" });

function fixture() {
  const withdrawal: WithdrawalRequestEntity = Object.assign(new WithdrawalRequestEntity(), { id: "WR-one", ownerId: "collector", status: "processing", assigneeId: admin.id, registeredById: null });
  const proofs: WithdrawalEvidenceEntity[] = [];
  const objects = new Map<string, Buffer>();
  const temporaryPaths: string[] = [];
  const audits: string[] = [];
  let failSave = false, failUpload = false;
  const proofRepo = {
    create: (input: Partial<WithdrawalEvidenceEntity>) => Object.assign(new WithdrawalEvidenceEntity(), input),
    async save(row: WithdrawalEvidenceEntity) { if (failSave) throw new Error("simulated database failure"); row.createdAt = new Date("2026-09-01T00:00:00Z"); proofs.push(row); return row; },
    async find(input: { where: { requestId: string; id?: FindOperator<string[]> } }) {
      return proofs.filter(row => row.requestId === input.where.requestId && (!input.where.id || input.where.id.value.includes(row.id)));
    },
    createQueryBuilder() {
      let ids: { evidenceId: string; requestId: string };
      return { addSelect() { return this; }, where(_sql: string, input: typeof ids) { ids = input; return this; },
        async getOne() { return proofs.find(row => row.id === ids.evidenceId && row.requestId === ids.requestId) ?? null; } };
    },
  };
  const requestRepo = {
    async findOne(input: { where: { id: string } }) { return input.where.id === withdrawal.id ? withdrawal : null; },
    async findOneBy(input: { id: string }) { return input.id === withdrawal.id ? withdrawal : null; },
  };
  const manager = { getRepository(entity: unknown) { return entity === WithdrawalRequestEntity ? requestRepo : entity === WithdrawalEventEntity ? { async insert() {} } : proofRepo; } } as unknown as EntityManager;
  const db = { async transaction<T>(callback: (manager: EntityManager) => Promise<T>) {
    const count = proofs.length;
    try { return await callback(manager); } catch (error) { proofs.splice(count); throw error; }
  } } as DataSource;
  const storage = {
    async uploadObject(input: { objectKey: string; sourcePath: string }) {
      temporaryPaths.push(input.sourcePath);
      objects.set(input.objectKey, await readFile(input.sourcePath));
      if (failUpload) throw new Error("simulated partial upload failure");
    },
    async deleteObject(input: { objectKey: string }) { objects.delete(input.objectKey); },
    async headObject(input: { objectKey: string }) { return { sizeBytes: String(objects.get(input.objectKey)!.length) }; },
    async readObject(input: { objectKey: string }) { return Readable.from([objects.get(input.objectKey)!]); },
  } as unknown as ObjectStoragePort;
  const audit = { async record(_manager: EntityManager, _actor: PublicUser, action: string) { audits.push(action); } } as unknown as AuditService;
  const service = new PayoutEvidenceService(db, storage, audit);
  return { service, manager, storage, withdrawal, proofs, objects, temporaryPaths, audits,
    failDatabase() { failSave = true; }, failStorage() { failUpload = true; } };
}

describe("private payout evidence", () => {
  beforeEach(() => { vi.stubEnv("PAYOUT_RECIPIENT_KEY", "ab".repeat(32)); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("stores only ciphertext, downloads original bytes, audits every read and cleans encrypted temp files", async () => {
    const f = fixture();
    const proof = await f.service.upload(admin, f.withdrawal.id, { ...file(), originalname: '../bad\r\n"name.png' });
    expect(JSON.stringify(proof)).not.toContain("objectKey");
    expect(proof.originalFileName).not.toMatch(/[\r\n"/\\]/u);
    const stored = [...f.objects.values()][0]!;
    expect(stored.equals(png)).toBe(false);
    expect(stored.includes(png)).toBe(false);
    expect((await f.service.download(reviewer, f.withdrawal.id, proof.id)).bytes).toEqual(png);
    expect((await f.service.download(admin, f.withdrawal.id, proof.id)).bytes).toEqual(png);
    expect(f.audits.filter(action => action === "withdrawal.evidence_downloaded")).toHaveLength(2);
    await expect(stat(f.temporaryPaths[0]!)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.stringify(await f.service.listForRequest(f.manager, f.withdrawal.id))).not.toContain(f.proofs[0]!.objectKey);
  });

  it("rejects unauthorized reads, other-request IDs and upload attempts after handover or finalization", async () => {
    const f = fixture();
    const proof = await f.service.upload(admin, f.withdrawal.id, file());
    await expect(f.service.download(collector, f.withdrawal.id, proof.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(f.service.download(admin, "WR-other", proof.id)).rejects.toMatchObject({ statusCode: 404 });
    f.withdrawal.id = "WR-other";
    await expect(f.service.download(admin, "WR-other", proof.id)).rejects.toMatchObject({ statusCode: 404 });
    f.withdrawal.assigneeId = reviewer.id;
    await expect(f.service.upload(admin, f.withdrawal.id, file())).rejects.toMatchObject({ statusCode: 403 });
    f.withdrawal.status = "paid";
    await expect(f.service.upload(reviewer, f.withdrawal.id, file())).rejects.toMatchObject({ statusCode: 409 });
    expect(f.audits).not.toContain("withdrawal.evidence_downloaded");
  });

  it("requires bound existing proofs and preserves historical uploader identity across handover and independent resolution", async () => {
    const f = fixture();
    const proof = await f.service.upload(admin, f.withdrawal.id, file());
    await f.service.validateForRegistration(f.manager, admin, f.withdrawal, [proof.id]);
    for (const ids of [[], [proof.id, proof.id], ["missing"]]) {
      await expect(f.service.validateForRegistration(f.manager, admin, f.withdrawal, ids)).rejects.toMatchObject({ statusCode: 400 });
    }
    f.withdrawal.id = "WR-other";
    await expect(f.service.validateForRegistration(f.manager, admin, f.withdrawal, [proof.id])).rejects.toMatchObject({ statusCode: 400 });
    f.withdrawal.id = "WR-one";
    f.withdrawal.assigneeId = reviewer.id;
    await f.service.validateForRegistration(f.manager, reviewer, f.withdrawal, [proof.id]);
    await expect(f.service.validateForRegistration(f.manager, admin, f.withdrawal, [proof.id])).rejects.toMatchObject({ statusCode: 403 });
    expect((await f.service.listForRequest(f.manager, f.withdrawal.id))[0]!.uploadedById).toBe(admin.id);
    f.withdrawal.assigneeId = admin.id;
    f.withdrawal.status = "investigating";
    f.withdrawal.registeredById = admin.id;
    const returnedFunds = await f.service.upload(reviewer, f.withdrawal.id, file());
    await f.service.validateForRegistration(f.manager, reviewer, f.withdrawal, [returnedFunds.id]);
    await f.service.validateForRegistration(f.manager, reviewer, f.withdrawal, [proof.id]);
    f.withdrawal.assigneeId = "new-assignee";
    await expect(f.service.upload(admin, f.withdrawal.id, file())).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects oversized files, spoofed signatures and MIME mismatches before storing anything", async () => {
    const f = fixture();
    await expect(f.service.upload(admin, f.withdrawal.id, file(Buffer.alloc(MAX_PAYOUT_EVIDENCE_BYTES + 1)))).rejects.toMatchObject({ statusCode: 413 });
    await expect(f.service.upload(admin, f.withdrawal.id, file(Buffer.from("<script>not an image</script>")))).rejects.toMatchObject({ statusCode: 400 });
    await expect(f.service.upload(admin, f.withdrawal.id, file(png, "application/pdf"))).rejects.toMatchObject({ statusCode: 400 });
    await expect(f.service.upload(admin, f.withdrawal.id)).rejects.toMatchObject({ statusCode: 400 });
    expect(f.objects.size).toBe(0);
  });

  it.each(["database", "storage"])("compensates %s failure without deleting old proof and cleans temp files", async failure => {
    const f = fixture();
    const previous = await f.service.upload(admin, f.withdrawal.id, file());
    if (failure === "database") f.failDatabase(); else f.failStorage();
    await expect(f.service.upload(admin, f.withdrawal.id, file())).rejects.toMatchObject({ statusCode: 503 });
    expect(f.objects.size).toBe(1);
    expect((await f.service.download(admin, f.withdrawal.id, previous.id)).bytes).toEqual(png);
    for (const path of f.temporaryPaths) await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects corrupted tags, cross-file encrypted substitution and mismatched recorded digest", async () => {
    const f = fixture();
    const first = await f.service.upload(admin, f.withdrawal.id, file());
    const second = await f.service.upload(admin, f.withdrawal.id, file());
    const [a, b] = f.proofs;
    if (!a || !b) throw new Error("Two uploaded evidence records required");
    const original = Buffer.from(f.objects.get(a.objectKey)!);
    f.objects.set(a.objectKey, f.objects.get(b.objectKey)!);
    await expect(f.service.download(admin, f.withdrawal.id, first.id)).rejects.toMatchObject({ statusCode: 503 });
    const damaged = Buffer.from(original); damaged[13] = damaged[13]! ^ 1;
    f.objects.set(a.objectKey, damaged);
    await expect(f.service.download(admin, f.withdrawal.id, first.id)).rejects.toMatchObject({ statusCode: 503 });
    f.objects.set(a.objectKey, original); a.sha256 = "0".repeat(64);
    await expect(f.service.download(admin, f.withdrawal.id, first.id)).rejects.toMatchObject({ statusCode: 503 });
    expect((await f.service.download(admin, f.withdrawal.id, second.id)).bytes).toEqual(png);
  });

  it("bounds the actual stream even if object metadata lies and rejects truncation/version errors", async () => {
    const f = fixture();
    const proof = await f.service.upload(admin, f.withdrawal.id, file());
    const original = f.objects.get(f.proofs[0]!.objectKey)!;
    for (const corrupt of [original.subarray(0, 20), Buffer.concat([original, Buffer.alloc(1)]), Buffer.concat([Buffer.from([2]), original.subarray(1)])]) {
      const stream = Readable.from([corrupt]);
      f.storage.readObject = async () => stream;
      await expect(f.service.download(admin, f.withdrawal.id, proof.id)).rejects.toMatchObject({ statusCode: 503 });
      expect(stream.destroyed).toBe(true);
    }
    expect(f.audits).not.toContain("withdrawal.evidence_downloaded");
  });
});

describe("payout evidence HTTP boundary", () => {
  let app: INestApplication;
  const f = fixture();
  beforeAll(async () => {
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", "ab".repeat(32));
    vi.stubEnv("WEB_ORIGIN", "http://localhost:3000");
    const module = await Test.createTestingModule({ controllers: [PayoutEvidenceController], providers: [PayoutEvidenceAdminGuard,
      { provide: PayoutEvidenceService, useValue: f.service }] })
      .overrideGuard(SessionGuard).useValue({ canActivate(context: { switchToHttp(): { getRequest(): { user?: PublicUser; headers: Record<string, string> } } }) {
        const req = context.switchToHttp().getRequest();
        if (!req.headers["x-actor"]) throw new UnauthorizedException();
        req.user = req.headers["x-actor"] === "admin" ? admin : collector;
        return true;
      } }).compile();
    app = module.createNestApplication(); await app.init();
  });
  afterAll(async () => { await app?.close(); vi.unstubAllEnvs(); });

  it("requires session/admin/origin and serves attachment with private headers, never a public URL", async () => {
    const endpoint = `/wallet/withdrawals/${f.withdrawal.id}/evidence`;
    await request(app.getHttpServer()).post(endpoint).attach("file", png, "proof.png").expect(401);
    await request(app.getHttpServer()).post(endpoint).set("x-actor", "collector").set("Origin", "http://localhost:3000").attach("file", png, "proof.png").expect(403);
    await request(app.getHttpServer()).post(endpoint).set("x-actor", "admin").set("Origin", "https://evil.invalid").attach("file", png, "proof.png").expect(403);
    await request(app.getHttpServer()).post(endpoint).set("x-actor", "admin").set("Origin", "http://localhost:3000").attach("file", Buffer.alloc(MAX_PAYOUT_EVIDENCE_BYTES + 1), "proof.png").expect(413);
    const exactLimit = Buffer.alloc(MAX_PAYOUT_EVIDENCE_BYTES); png.copy(exactLimit);
    const boundary = await request(app.getHttpServer()).post(endpoint).set("x-actor", "admin").set("Origin", "http://localhost:3000").attach("file", exactLimit, "proof.png").expect(200);
    expect(boundary.body.evidence.sizeBytes).toBe(MAX_PAYOUT_EVIDENCE_BYTES);
    const uploaded = await request(app.getHttpServer()).post(endpoint).set("x-actor", "admin").set("Origin", "http://localhost:3000").attach("file", png, "proof.png").expect(200);
    expect(uploaded.body.evidence.objectKey).toBeUndefined();
    const url = `${endpoint}/${uploaded.body.evidence.id}/content`;
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer()).get(url).set("x-actor", "collector").expect(403);
    const result = await request(app.getHttpServer()).get(url).set("x-actor", "admin").expect(200);
    expect(result.body).toEqual(png);
    expect(result.headers["content-disposition"]).toMatch(/^attachment;/u);
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(result.headers["cache-control"]).toBe("no-store");
  });
});
