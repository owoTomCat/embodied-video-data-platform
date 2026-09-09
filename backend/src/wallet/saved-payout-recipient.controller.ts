import { Body, Controller, Delete, Get, Param, Put, UseFilters, UseGuards } from "@nestjs/common";
import { IsOptional, IsString, MaxLength } from "class-validator";
import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { WalletFailureFilter } from "./wallet-failure.filter.js";
import { SavedPayoutRecipientService } from "./saved-payout-recipient.service.js";

export class SavePayoutRecipientDto {
  @IsString() @MaxLength(120) name!: string;
  @IsString() @MaxLength(200) account!: string;
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
}

@Controller("wallet/recipients")
@UseGuards(SessionGuard)
@UseFilters(WalletFailureFilter)
export class SavedPayoutRecipientController {
  constructor(private readonly recipients: SavedPayoutRecipientService) {}

  @Get()
  async list(@CurrentUser() actor: PublicUser) {
    return { recipients: await this.recipients.list(actor) };
  }
  @Put(":method") @UseGuards(AllowedOriginGuard)
  async save(@CurrentUser() actor: PublicUser, @Param("method") method: string, @Body() input: SavePayoutRecipientDto) {
    return { recipient: await this.recipients.save(actor, method, input) };
  }
  @Delete(":method") @UseGuards(AllowedOriginGuard)
  async remove(@CurrentUser() actor: PublicUser, @Param("method") method: string) {
    await this.recipients.remove(actor, method);
    return { ok: true };
  }
}
