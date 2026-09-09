import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Inject, Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import type { PublicUser } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { WithdrawalEvidenceEntity } from "../database/entities/withdrawal-evidence.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { WithdrawalEventEntity, WithdrawalRequestEntity } from "../database/entities/withdrawal.entity.js";
import { OBJECT_STORAGE, type ObjectStoragePort } from "../storage/object-storage.port.js";
import { payoutKey } from "./payout-recipient.js";
import { WalletFailure } from "./wallet.failure.js";

const MAX_PAYOUT_EVIDENCE_BYTES = 5 * 1024 * 1024;
// Version byte + 12-byte nonce + 16-byte GCM tag; ciphertext length equals plaintext length.
const ENVELOPE_BYTES = 29;

function metadata(row: WithdrawalEvidenceEntity) {
  return { id: row.id, originalFileName: row.originalFileName, contentType: row.contentType,
    sizeBytes: Number(row.sizeBytes), sha256: row.sha256, uploadedById: row.uploadedById, createdAt: row.createdAt.toISOString() };
}
function admin(actor: PublicUser) {
  if (actor.role !== "admin" || actor.status !== "active") throw new WalletFailure("FORBIDDEN", "仅有效管理员可访问提现凭证", 403);
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

  async listForRequest(manager: EntityManager, requestId: string) {
    const rows = await manager.getRepository(WithdrawalEvidenceEntity).find({ where: { requestId }, order: { createdAt: "ASC", id: "ASC" } });
    return rows.map(metadata);
  }

  async download(actor: PublicUser, requestId: string, evidenceId: string) {
    admin(actor);
    return this.dataSource.transaction(async manager => {
      const user = await manager.getRepository(UserEntity).findOneBy({ id: actor.id, role: "admin", status: "active" });
      if (!user) throw new WalletFailure("FORBIDDEN", "需要有效管理员身份", 403);
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
