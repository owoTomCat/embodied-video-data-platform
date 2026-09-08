import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { Inject, Injectable } from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import type { PublicUser } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { WithdrawalEvidenceEntity } from "../database/entities/withdrawal-evidence.entity.js";
import { WithdrawalEventEntity, WithdrawalRequestEntity } from "../database/entities/withdrawal.entity.js";
import { OBJECT_STORAGE, type ObjectStoragePort } from "../storage/object-storage.port.js";
import { payoutKey } from "./payout-recipient.js";
import { WalletFailure } from "./wallet.failure.js";

export const MAX_PAYOUT_EVIDENCE_BYTES = 5 * 1024 * 1024;
// Version byte + 12-byte nonce + 16-byte GCM tag; ciphertext length equals plaintext length.
const ENVELOPE_BYTES = 29;
type EvidenceUpload = Pick<Express.Multer.File, "buffer" | "size" | "mimetype" | "originalname">;

function metadata(row: WithdrawalEvidenceEntity) {
  return { id: row.id, originalFileName: row.originalFileName, contentType: row.contentType,
    sizeBytes: Number(row.sizeBytes), sha256: row.sha256, uploadedById: row.uploadedById, createdAt: row.createdAt.toISOString() };
}
function admin(actor: PublicUser) {
  if (actor.role !== "admin" || actor.status !== "active") throw new WalletFailure("FORBIDDEN", "仅有效管理员可访问提现凭证", 403);
}
function uploader(actor: PublicUser, request: WithdrawalRequestEntity) {
  admin(actor);
  if (request.status !== "processing" && request.status !== "investigating") throw new WalletFailure("STATE_CONFLICT", "当前状态不可上传或使用新凭证", 409);
  const independentResolver = request.status === "investigating" && actor.id !== request.assigneeId && actor.id !== request.registeredById;
  if (actor.id !== request.assigneeId && !independentResolver) throw new WalletFailure("FORBIDDEN", "仅当前经办人或独立核查人可提供凭证", 403);
}
function contentType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return null;
}
function safeFilename(name: string): string {
  return name.normalize("NFKC").replace(/[\\/]/gu, "_").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069"<>:|?*]/gu, "_").replace(/^\.+/u, "_").trim().slice(0, 180).replace(/[\ud800-\udfff]/gu, "_") || "evidence";
}
function aad(row: Pick<WithdrawalEvidenceEntity, "requestId" | "id">): Buffer {
  return Buffer.from(JSON.stringify(["payout-evidence-v1", row.requestId, row.id]));
}

@Injectable()
export class PayoutEvidenceService {
  constructor(private readonly dataSource: DataSource, @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    private readonly audit: AuditService) {}

  async upload(actor: PublicUser, requestId: string, file?: EvidenceUpload) {
    admin(actor);
    if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) throw new WalletFailure("VALIDATION", "请选择凭证文件", 400);
    if (file.buffer.length > MAX_PAYOUT_EVIDENCE_BYTES || file.size > MAX_PAYOUT_EVIDENCE_BYTES) throw new WalletFailure("VALIDATION", "凭证不可超过 5MiB", 413);
    const mime = contentType(file.buffer);
    if (!mime || mime !== file.mimetype || file.size !== file.buffer.length) throw new WalletFailure("VALIDATION", "凭证必须为真实 JPEG、PNG 或 PDF，且类型与内容一致", 400);
    const key = payoutKey();
    const id = `WE-${randomUUID()}`;
    const objectKey = `private/payout-evidence/${randomUUID()}/${id}.enc`;
    let directory: string | undefined;
    let objectAttempted = false;
    try {
      return await this.dataSource.transaction(async manager => {
        const request = await manager.getRepository(WithdrawalRequestEntity).findOne({ where: { id: requestId }, lock: { mode: "pessimistic_write" } });
        if (!request) throw new WalletFailure("NOT_FOUND", "提现申请不存在", 404);
        uploader(actor, request);
        const repo = manager.getRepository(WithdrawalEvidenceEntity);
        const row = repo.create({ id, requestId, originalFileName: safeFilename(file.originalname), contentType: mime,
          sizeBytes: String(file.buffer.length), sha256: createHash("sha256").update(file.buffer).digest("hex"), uploadedById: actor.id, objectKey });
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(aad(row));
        const ciphertext = Buffer.concat([cipher.update(file.buffer), cipher.final()]);
        const encrypted = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
        directory = await mkdtemp(join(tmpdir(), "payout-evidence-"));
        const sourcePath = join(directory, "encrypted.bin");
        await writeFile(sourcePath, encrypted, { mode: 0o600, flag: "wx" });
        objectAttempted = true;
        await this.storage.uploadObject({ objectKey, sourcePath, contentType: "application/octet-stream" });
        await repo.save(row);
        await this.audit.record(manager, actor, "withdrawal.evidence_uploaded", { id: request.ownerId, name: request.ownerId },
          "上传提现凭证", null, { requestId, evidenceId: id });
        await manager.getRepository(WithdrawalEventEntity).insert({
          id: `WPE-${randomUUID()}`, requestId, actorId: actor.id, actorName: actor.displayName,
          action: "withdrawal.evidence_uploaded", reason: null, registrationId: null, details: { evidenceIds: [id] },
        });
        return metadata(row);
      });
    } catch (error) {
      if (objectAttempted) {
        try { await this.storage.deleteObject({ objectKey }); }
        catch { throw new WalletFailure("PAYOUT_UNAVAILABLE", "凭证上传未完成且存储清理失败，请联系管理员", 503); }
      }
      if (error instanceof WalletFailure) throw error;
      throw new WalletFailure("PAYOUT_UNAVAILABLE", "凭证上传失败，请重试", 503);
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
  }

  async validateForRegistration(manager: EntityManager, actor: PublicUser, request: WithdrawalRequestEntity, evidenceIds: string[]): Promise<void> {
    uploader(actor, request);
    if (!Array.isArray(evidenceIds) || evidenceIds.length < 1 || evidenceIds.length > 5 || new Set(evidenceIds).size !== evidenceIds.length ||
      evidenceIds.some(id => typeof id !== "string" || !id.length || id.length > 64)) throw new WalletFailure("VALIDATION", "请选择 1 至 5 个不同凭证", 400);
    const rows = await manager.getRepository(WithdrawalEvidenceEntity).find({ where: { id: In(evidenceIds), requestId: request.id } });
    if (rows.length !== evidenceIds.length) throw new WalletFailure("VALIDATION", "凭证必须存在且属于此申请", 400);
  }

  async listForRequest(manager: EntityManager, requestId: string) {
    const rows = await manager.getRepository(WithdrawalEvidenceEntity).find({ where: { requestId }, order: { createdAt: "ASC", id: "ASC" } });
    return rows.map(metadata);
  }

  async download(actor: PublicUser, requestId: string, evidenceId: string) {
    admin(actor);
    return this.dataSource.transaction(async manager => {
      const request = await manager.getRepository(WithdrawalRequestEntity).findOneBy({ id: requestId });
      if (!request) throw new WalletFailure("NOT_FOUND", "提现申请不存在", 404);
      const row = await manager.getRepository(WithdrawalEvidenceEntity).createQueryBuilder("evidence").addSelect("evidence.objectKey")
        .where("evidence.id = :evidenceId AND evidence.requestId = :requestId", { evidenceId, requestId }).getOne();
      if (!row) throw new WalletFailure("NOT_FOUND", "凭证不存在", 404);
      const key = payoutKey();
      let bytes: Buffer;
      try {
        const size = Number(row.sizeBytes);
        if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PAYOUT_EVIDENCE_BYTES) throw new Error();
        const expected = size + ENVELOPE_BYTES;
        const head = await this.storage.headObject({ objectKey: row.objectKey });
        if (Number(head.sizeBytes) !== expected) throw new Error();
        const stream = await this.storage.readObject({ objectKey: row.objectKey }) as Readable;
        const chunks: Buffer[] = [];
        let length = 0;
        try {
          for await (const chunk of stream) {
            if (!(chunk instanceof Uint8Array) || length + chunk.byteLength > expected) throw new Error();
            length += chunk.byteLength;
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
        } finally { stream.destroy(); }
        if (length !== expected) throw new Error();
        const encrypted = Buffer.concat(chunks, length);
        if (encrypted[0] !== 1) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, encrypted.subarray(1, 13));
        decipher.setAAD(aad(row));
        decipher.setAuthTag(encrypted.subarray(13, 29));
        bytes = Buffer.concat([decipher.update(encrypted.subarray(29)), decipher.final()]);
        if (bytes.length !== size || createHash("sha256").update(bytes).digest("hex") !== row.sha256 || contentType(bytes) !== row.contentType) throw new Error();
      } catch { throw new WalletFailure("PAYOUT_UNAVAILABLE", "凭证无法安全读取，请联系管理员", 503); }
      await this.audit.record(manager, actor, "withdrawal.evidence_downloaded", { id: request.ownerId, name: request.ownerId },
        "读取提现凭证", null, { requestId, evidenceId });
      await manager.getRepository(WithdrawalEventEntity).insert({
        id: `WPE-${randomUUID()}`, requestId, actorId: actor.id, actorName: actor.displayName,
        action: "withdrawal.evidence_downloaded", reason: null, registrationId: null, details: { evidenceIds: [evidenceId] },
      });
      return { bytes, contentType: row.contentType, originalFileName: safeFilename(row.originalFileName) };
    });
  }
}
