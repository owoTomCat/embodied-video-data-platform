import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "../auth/auth.module.js";
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
  ],
  controllers: [WalletController],
  providers: [WalletService, WalletFailureFilter, AllowedOriginGuard],
  exports: [WalletService],
})
export class WalletModule {}
