import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, UseFilters, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
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
export class ClaimWithdrawalsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(64, { each: true }) ids!: string[];
}
export class TransitionWithdrawalDto {
  @IsIn(["rejected"]) status!: "rejected";
  @IsString() @MaxLength(500) reason!: string;
}
export class RevisionDto {
  @IsInt() @Min(0) revision!: number;
}
export class AssignWithdrawalDto extends RevisionDto {
  @IsString() @MaxLength(64) assigneeId!: string;
  @IsString() @MaxLength(500) reason!: string;
}
export class RegisterWithdrawalDto extends RevisionDto {
  @IsString() @MaxLength(120) transferReference!: string;
  @IsDateString() paidAt!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ArrayUnique() @IsString({ each: true }) @MaxLength(64, { each: true }) evidenceIds!: string[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}
export class ReviewWithdrawalDto extends RevisionDto {
  @IsIn(["approve", "return"]) decision!: "approve" | "return";
  @IsIn(["independent", "single"]) mode!: "independent" | "single";
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class InvestigateWithdrawalDto extends RevisionDto {
  @IsString() @MaxLength(500) reason!: string;
}
export class ResolveUnpaidDto extends InvestigateWithdrawalDto {
  @IsBoolean() fundsNotTransferred!: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ArrayUnique() @IsString({ each: true }) @MaxLength(64, { each: true }) evidenceIds!: string[];
  @IsOptional() @IsIn(["independent", "single"]) mode?: "independent" | "single";
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
  @Get("withdrawals/summary") @Header("Cache-Control", "no-store")
  summary(@CurrentUser() actor: PublicUser) { return this.payouts.summary(actor); }
  @Get("withdrawals/:id") @Header("Cache-Control", "no-store")
  detail(@CurrentUser() actor: PublicUser, @Param("id") id: string) { return this.payouts.detail(actor, id); }
  @Post("withdrawals/:id/recipient") @HttpCode(200) @UseGuards(AllowedOriginGuard) @Header("Cache-Control", "no-store")
  recipient(@CurrentUser() actor: PublicUser, @Param("id") id: string) { return this.payouts.recipient(actor, id); }
  @Post("withdrawals/:id/assign") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  async assign(@CurrentUser() actor: PublicUser, @Param("id") id: string, @Body() input: AssignWithdrawalDto) { return { request: await this.payouts.assign(actor, id, input) }; }
  @Post("withdrawals/:id/register") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  async register(@CurrentUser() actor: PublicUser, @Param("id") id: string, @Body() input: RegisterWithdrawalDto) { return { request: await this.payouts.register(actor, id, input) }; }
  @Post("withdrawals/:id/review") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  async review(@CurrentUser() actor: PublicUser, @Param("id") id: string, @Body() input: ReviewWithdrawalDto) { return { request: await this.payouts.review(actor, id, input) }; }
  @Post("withdrawals/:id/investigate") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  async investigate(@CurrentUser() actor: PublicUser, @Param("id") id: string, @Body() input: InvestigateWithdrawalDto) { return { request: await this.payouts.investigate(actor, id, input) }; }
  @Post("withdrawals/:id/resolve-unpaid") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  async resolveUnpaid(@CurrentUser() actor: PublicUser, @Param("id") id: string, @Body() input: ResolveUnpaidDto) { return { request: await this.payouts.resolveUnpaid(actor, id, input) }; }
  @Post("withdrawal-batches") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  claim(@CurrentUser() actor: PublicUser, @Body() input: ClaimWithdrawalsDto) { return this.payouts.claim(actor, input.ids); }
  // Explicit POST export: authenticated, origin checked and audited every time, including re-downloads.
  @Post("withdrawal-batches/:id/export") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  @Header("Content-Type", "text/csv; charset=utf-8") @Header("Content-Disposition", 'attachment; filename="manual-payouts.csv"') @Header("Cache-Control", "no-store")
  export(@CurrentUser() actor: PublicUser, @Param("id") id: string) { return this.payouts.exportBatch(actor, id); }
  @Post("withdrawals/:id/status") @HttpCode(200) @UseGuards(AllowedOriginGuard)
  async transition(@CurrentUser() actor: PublicUser, @Param("id") id: string, @Body() input: TransitionWithdrawalDto) {
    return { request: await this.payouts.transition(actor, id, input) };
  }
}
