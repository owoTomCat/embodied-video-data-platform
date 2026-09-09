import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import type { PublicUser } from "../auth/auth.types.js";
import { AuditService } from "../audit/audit.service.js";
import { SavedPayoutRecipientEntity } from "../database/entities/saved-payout-recipient.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { decryptRecipient, encryptRecipient, payoutKey, requiredText, type PayoutRecipient } from "./payout-recipient.js";
import { WalletFailure } from "./wallet.failure.js";

@Injectable()
export class SavedPayoutRecipientService {
  constructor(private readonly dataSource: DataSource, private readonly audit: AuditService) {}

  private method(value: string): PayoutRecipient["method"] {
    if (value !== "alipay" && value !== "bank") throw new WalletFailure("VALIDATION", "不支持的收款方式", 400);
    return value;
  }
  private async active(manager: EntityManager, actor: PublicUser) {
    if (actor.status !== "active" || !await manager.getRepository(UserEntity).existsBy({ id: actor.id, status: "active" })) {
      throw new WalletFailure("FORBIDDEN", "需要有效用户身份", 403);
    }
  }
  async list(actor: PublicUser): Promise<PayoutRecipient[]> {
    return this.dataSource.transaction(async manager => {
      await this.active(manager, actor);
      const rows = await manager.getRepository(SavedPayoutRecipientEntity).createQueryBuilder("recipient")
        .addSelect("recipient.recipientEncrypted").where("recipient.ownerId = :ownerId", { ownerId: actor.id }).orderBy("recipient.method", "ASC").getMany();
      const key = rows.length ? payoutKey() : null;
      const recipients = rows.map(row => decryptRecipient(row.recipientEncrypted, `saved-recipient:${actor.id}:${row.method}`, key!));
      await this.audit.record(manager, actor, "wallet.recipient_read", { id: actor.id, name: actor.id }, "读取本人常用收款信息", null,
        { methods: rows.map(row => row.method) });
      return recipients;
    });
  }
  async save(actor: PublicUser, value: string, input: { name: string; account: string; bankName?: string }): Promise<PayoutRecipient> {
    const method = this.method(value);
    const recipient: PayoutRecipient = { method, name: requiredText(input.name, 120), account: requiredText(input.account, 200),
      bankName: method === "bank" ? requiredText(input.bankName, 120) : "" };
    const encrypted = encryptRecipient(recipient, `saved-recipient:${actor.id}:${method}`, payoutKey());
    return this.dataSource.transaction(async manager => {
      await this.active(manager, actor);
      await manager.getRepository(SavedPayoutRecipientEntity).upsert({ ownerId: actor.id, method, recipientEncrypted: encrypted }, ["ownerId", "method"]);
      await this.audit.record(manager, actor, "wallet.recipient_saved", { id: actor.id, name: actor.id }, "保存本人常用收款信息", null, { method });
      return recipient;
    });
  }
  async remove(actor: PublicUser, value: string): Promise<void> {
    const method = this.method(value);
    await this.dataSource.transaction(async manager => {
      await this.active(manager, actor);
      await manager.getRepository(SavedPayoutRecipientEntity).delete({ ownerId: actor.id, method });
      await this.audit.record(manager, actor, "wallet.recipient_deleted", { id: actor.id, name: actor.id }, "删除本人常用收款信息", null, { method });
    });
  }
}
