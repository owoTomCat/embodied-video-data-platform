import "reflect-metadata";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { INestApplication } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { DataSource, EntityManager } from "typeorm";
import type { PublicUser } from "../src/auth/auth.types.js";
import { SessionGuard } from "../src/auth/session.guard.js";
import type { AuditService } from "../src/audit/audit.service.js";
import { WithdrawalEvidenceEntity } from "../src/database/entities/withdrawal-evidence.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { WithdrawalEventEntity, WithdrawalRequestEntity } from "../src/database/entities/withdrawal.entity.js";
import type { ObjectStoragePort } from "../src/storage/object-storage.port.js";
import { PayoutEvidenceController, PayoutEvidenceAdminGuard } from "../src/wallet/payout-evidence.controller.js";
import { PayoutEvidenceService } from "../src/wallet/payout-evidence.service.js";

const actor = (id: string, role: PublicUser["role"] = "admin"): PublicUser => ({ id, role, status: "active", displayName: id, username: id, updatedAt: 0 });
const admin = actor("assignee"), reviewer = actor("reviewer"), collector = actor("collector", "collector");
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082", "hex");

function fixture() {
  const withdrawal: WithdrawalRequestEntity = Object.assign(new WithdrawalRequestEntity(), { id: "WR-one", ownerId: "collector", status: "paid" });
  const proofs: WithdrawalEvidenceEntity[] = [];
  const objects = new Map<string, Buffer>();
  const audits: string[] = [];
  const proofRepo = {
    async find(input: { where: { requestId: string } }) { return proofs.filter(row => row.requestId === input.where.requestId); },
    createQueryBuilder() {
      let ids: { evidenceId: string; requestId: string };
      return { addSelect() { return this; }, where(_sql: string, input: typeof ids) { ids = input; return this; },
        async getOne() { return proofs.find(row => row.id === ids.evidenceId && row.requestId === ids.requestId) ?? null; } };
    },
  };
  let disabled = false;
  const manager = { getRepository(entity: unknown) {
    if (entity === WithdrawalRequestEntity) return { async findOneBy(input: { id: string }) { return input.id === withdrawal.id ? withdrawal : null; } };
    if (entity === UserEntity) return { async findOneBy() { return disabled ? null : admin; } };
    if (entity === WithdrawalEventEntity) return { async insert() {} };
    return proofRepo;
  } } as unknown as EntityManager;
  const db = { async transaction<T>(callback: (manager: EntityManager) => Promise<T>) { return callback(manager); } } as DataSource;
  const storage = {
    async headObject(input: { objectKey: string }) { return { sizeBytes: String(objects.get(input.objectKey)!.length) }; },
    async readObject(input: { objectKey: string }) { return Readable.from([objects.get(input.objectKey)!]); },
  } as unknown as ObjectStoragePort;
  const audit = { async record(_manager: EntityManager, _actor: PublicUser, action: string) { audits.push(action); } } as unknown as AuditService;
  const service = new PayoutEvidenceService(db, storage, audit);
  function seed() {
    const id = `PE-${proofs.length}`;
    const row = Object.assign(new WithdrawalEvidenceEntity(), { id, requestId: withdrawal.id, originalFileName: "proof.png",
      contentType: "image/png", sizeBytes: String(png.length), sha256: createHash("sha256").update(png).digest("hex"),
      uploadedById: admin.id, objectKey: `private/${id}`, createdAt: new Date("2026-09-01T00:00:00Z") });
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from("ab".repeat(32), "hex"), iv);
    cipher.setAAD(Buffer.from(JSON.stringify(["payout-evidence-v1", row.requestId, row.id])));
    const encrypted = Buffer.concat([cipher.update(png), cipher.final()]);
    objects.set(row.objectKey, Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]));
    proofs.push(row);
    return row;
  }
  return { service, manager, storage, withdrawal, proofs, objects, audits, seed, disable() { disabled = true; } };
}

describe("private payout evidence", () => {
  beforeEach(() => { vi.stubEnv("PAYOUT_RECIPIENT_KEY", "ab".repeat(32)); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("downloads original historical bytes, audits every read and hides private object keys", async () => {
    const f = fixture();
    const proof = f.seed();
    expect((await f.service.download(reviewer, f.withdrawal.id, proof.id)).bytes).toEqual(png);
    expect((await f.service.download(admin, f.withdrawal.id, proof.id)).bytes).toEqual(png);
    expect(f.audits.filter(action => action === "withdrawal.evidence_downloaded")).toHaveLength(2);
    expect(JSON.stringify(await f.service.listForRequest(f.manager, f.withdrawal.id))).not.toContain(f.proofs[0]!.objectKey);
  });

  it("rejects unauthorized reads and other-request IDs", async () => {
    const f = fixture();
    const proof = f.seed();
    await expect(f.service.download(collector, f.withdrawal.id, proof.id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(f.service.download(admin, "WR-other", proof.id)).rejects.toMatchObject({ statusCode: 404 });
    f.withdrawal.id = "WR-other";
    await expect(f.service.download(admin, "WR-other", proof.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(f.audits).not.toContain("withdrawal.evidence_downloaded");
  });

  it("rejects a disabled database administrator even with a stale active session", async () => {
    const f = fixture(), proof = f.seed();
    f.disable();
    await expect(f.service.download(admin, f.withdrawal.id, proof.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(f.audits).not.toContain("withdrawal.evidence_downloaded");
  });

  it("rejects corrupted tags, cross-file encrypted substitution and mismatched recorded digest", async () => {
    const f = fixture();
    const first = f.seed();
    const second = f.seed();
    const [a, b] = f.proofs;
    if (!a || !b) throw new Error("Two historical evidence records required");
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
    const proof = f.seed();
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

  it("removes uploads and serves historical attachments only to authenticated admins", async () => {
    const endpoint = `/wallet/withdrawals/${f.withdrawal.id}/evidence`;
    await request(app.getHttpServer()).post(endpoint).set("x-actor", "admin").attach("file", png, "proof.png").expect(404);
    const proof = f.seed();
    const url = `${endpoint}/${proof.id}/content`;
    await request(app.getHttpServer()).get(url).expect(401);
    await request(app.getHttpServer()).get(url).set("x-actor", "collector").expect(403);
    const result = await request(app.getHttpServer()).get(url).set("x-actor", "admin").expect(200);
    expect(result.body).toEqual(png);
    expect(result.headers["content-disposition"]).toMatch(/^attachment;/u);
    expect(result.headers["x-content-type-options"]).toBe("nosniff");
    expect(result.headers["cache-control"]).toBe("no-store");
  });
});
