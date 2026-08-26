import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { clearSessionCookie } from "../auth/session-cookie.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";
import { AccountsService } from "./accounts.service.js";
import {
  ChangeOwnPasswordDto,
  CreateAccountDto,
  ResetPasswordDto,
  SetAccountStatusDto,
  UpdateAccountDto,
  UpdateOwnAccountDto,
} from "./dto/account.dto.js";
import { IdentityFailureFilter } from "./identity-failure.filter.js";

@Controller("accounts")
@UseGuards(SessionGuard)
@UseFilters(IdentityFailureFilter)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  async list(@CurrentUser() actor: PublicUser) {
    return { accounts: await this.accounts.list(actor) };
  }

  @Post()
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async create(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateAccountDto,
  ) {
    return { account: await this.accounts.create(actor, input) };
  }

  @Patch("me")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async updateOwn(
    @CurrentUser() actor: PublicUser,
    @Body() input: UpdateOwnAccountDto,
  ) {
    return { account: await this.accounts.updateOwn(actor, input) };
  }

  @Patch(":id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async update(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: UpdateAccountDto,
  ) {
    return { account: await this.accounts.update(actor, id, input) };
  }

  @Post(":id/reset-password")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  resetPassword(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: ResetPasswordDto,
  ) {
    return this.accounts.resetPassword(actor, id, input.password);
  }

  @Post("me/change-password")
  @HttpCode(204)
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async changeOwnPassword(
    @CurrentUser() actor: PublicUser,
    @Body() input: ChangeOwnPasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.accounts.changeOwnPassword(actor, input);
    clearSessionCookie(response);
  }

  @Patch(":id/status")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async setStatus(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: SetAccountStatusDto,
  ) {
    return { account: await this.accounts.setStatus(actor, id, input) };
  }

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async delete(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ): Promise<void> {
    await this.accounts.delete(actor, id);
  }
}
