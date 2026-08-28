import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { WalletFailureFilter } from "./wallet-failure.filter.js";
import { WalletService } from "./wallet.service.js";

export class WithdrawWalletDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(10_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  remark?: string;
}

@Controller("wallet")
@UseGuards(SessionGuard)
@UseFilters(WalletFailureFilter)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /** 当前登录人自己的钱包 */
  @Get("me")
  async me(@CurrentUser() actor: PublicUser) {
    const balance = await this.wallet.getWallet(actor.id);
    const transactions = await this.wallet.listTransactions(actor.id);
    return { balance, transactions };
  }

  /** 钱包列表：管理员全平台 / 团长本队 / 数采本人 */
  @Get()
  async list(@CurrentUser() actor: PublicUser) {
    return { wallets: await this.wallet.listWallets(actor) };
  }

  /** 指定用户的钱包流水（仅管理员 / 团长查看本队成员） */
  @Get("transactions")
  async transactions(
    @CurrentUser() actor: PublicUser,
    @Query("ownerId") ownerId?: string,
  ) {
    const target =
      ownerId && (actor.role === "admin" || (actor.role === "leader" && actor.teamId))
        ? ownerId
        : actor.id;
    return { transactions: await this.wallet.listTransactions(target) };
  }

  /** 提现：从可提现余额转出，记录已提现与累计提现 */
  @Post("withdraw")
  @HttpCode(200)
  @UseGuards(AllowedOriginGuard)
  async withdraw(
    @CurrentUser() actor: PublicUser,
    @Body() input: WithdrawWalletDto,
  ) {
    const amount = Number(input.amount);
    return {
      balance: await this.wallet.withdraw(actor, {
        ownerId: actor.id,
        amount,
        remark: typeof input.remark === "string" ? input.remark.trim() : undefined,
      }),
    };
  }
}
