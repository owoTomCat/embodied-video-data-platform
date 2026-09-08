import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "../auth/auth.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { PayoutService } from "./payout.service.js";
import { PayoutController } from "./payout.controller.js";
import { PayoutEvidenceModule } from "./payout-evidence.module.js";
import { UserEntity } from "../database/entities/user.entity.js";
import {
  WalletBalanceEntity,
  WalletTransactionEntity,
} from "../database/entities/wallet.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { WalletController } from "./wallet.controller.js";
import { WalletFailureFilter } from "./wallet-failure.filter.js";
import { WalletService } from "./wallet.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WalletBalanceEntity,
      WalletTransactionEntity,
      UserEntity,
    ]),
    AuthModule,
    AuditModule,
    PayoutEvidenceModule,
  ],
  controllers: [WalletController, PayoutController],
  providers: [WalletService, PayoutService, WalletFailureFilter, AllowedOriginGuard],
  exports: [WalletService],
})
export class WalletModule {}
