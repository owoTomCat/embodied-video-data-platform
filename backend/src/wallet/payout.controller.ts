import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, UseFilters, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import type { WithdrawalStatus } from "../database/entities/withdrawal.entity.js";
import { WalletFailureFilter } from "./wallet-failure.filter.js";
import { PayoutService } from "./payout.service.js";

export class SubmitWithdrawalDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(10_000_000) amount!: number;
  @IsString() @MaxLength(64) idempotencyKey!: string;
  @IsIn(["alipay", "bank"]) method!: "alipay" | "bank";
  @IsString() @MaxLength(200) account!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
}
export class WithdrawalQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsIn(["pending", "processing", "review_pending", "investigating", "paid", "rejected", "failed"]) status?: WithdrawalStatus;
  @IsOptional() @IsString() @MaxLength(64) ownerId?: string;
  @IsOptional() @IsString() @MaxLength(64) batchId?: string;
  @IsOptional() @IsIn(["mine"]) scope?: "mine";
  @IsOptional() @IsIn(["true", "false"]) overdue?: "true" | "false";
}
export class PayoutQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  @IsOptional() @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsIn(["unpaid", "paid", "all"]) status?: "unpaid" | "paid" | "all";
}
@Controller("wallet")
@UseGuards(SessionGuard)
@UseFilters(WalletFailureFilter)
export class PayoutController {
  constructor(private readonly payouts: PayoutService) {}
  @Post("withdraw") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  async submit(@CurrentUser() actor: PublicUser, @Body() input: SubmitWithdrawalDto) {
    return { request: await this.payouts.submit(actor, input) };
  }
  @Get("withdrawals") @Header("Cache-Control", "no-store")
  list(@CurrentUser() actor: PublicUser, @Query() query: WithdrawalQueryDto) { return this.payouts.list(actor, query); }
  @Get("withdrawals/:id") @Header("Cache-Control", "no-store")
  detail(@CurrentUser() actor: PublicUser, @Param("id") id: string) { return this.payouts.detail(actor, id); }
  @Get("payouts") @Header("Cache-Control", "no-store")
  payoutsTable(@CurrentUser() actor: PublicUser, @Query() query: PayoutQueryDto) { return this.payouts.listPayouts(actor, query); }
  @Post("payouts/:id/confirm") @HttpCode(200) @UseGuards(AllowedOriginGuard) @Header("Cache-Control", "no-store")
  async confirm(@CurrentUser() actor: PublicUser, @Param("id") id: string) { return { request: await this.payouts.confirm(actor, id) }; }
}
