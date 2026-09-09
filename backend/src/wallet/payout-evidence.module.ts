import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { WithdrawalEvidenceEntity } from "../database/entities/withdrawal-evidence.entity.js";
import { WithdrawalRequestEntity } from "../database/entities/withdrawal.entity.js";
import { StorageModule } from "../storage/storage.module.js";
import { PayoutEvidenceAdminGuard, PayoutEvidenceController } from "./payout-evidence.controller.js";
import { PayoutEvidenceService } from "./payout-evidence.service.js";

@Module({
  imports: [TypeOrmModule.forFeature([WithdrawalEvidenceEntity, WithdrawalRequestEntity]), AuthModule, AuditModule, StorageModule],
  controllers: [PayoutEvidenceController],
  providers: [PayoutEvidenceService, PayoutEvidenceAdminGuard],
  exports: [PayoutEvidenceService],
})
export class PayoutEvidenceModule {}
