import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Put,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";
import { AdjustPointCycleItemDto, CreatePointCycleDto } from "./dto/point-cycle.dto.js";
import { CreatePointRuleDto } from "./dto/point-rule.dto.js";
import { PointCycleFailureFilter } from "./point-cycle-failure.filter.js";
import { PointCyclesService } from "./point-cycles.service.js";
import { PointRulesService, publicPointRule } from "./point-rules.service.js";

@Controller("point-cycles")
@UseGuards(SessionGuard)
@UseFilters(PointCycleFailureFilter)
export class PointCyclesController {
  constructor(
    private readonly cycles: PointCyclesService,
    private readonly rules: PointRulesService,
  ) {}

  @Get()
  async list(@CurrentUser() actor: PublicUser) {
    return { cycles: await this.cycles.list(actor) };
  }

  @Get("preview")
  async preview(@CurrentUser() actor: PublicUser) {
    return { preview: await this.cycles.preview(actor) };
  }

  @Get("rule")
  async getRule(@CurrentUser() actor: PublicUser) {
    return { rule: publicPointRule(await this.rules.getActive(actor)) };
  }

  @Put("rule")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async createRule(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreatePointRuleDto,
  ) {
    return { rule: publicPointRule(await this.rules.create(actor, input)) };
  }

  @Get(":id")
  async get(@CurrentUser() actor: PublicUser, @Param("id") id: string) {
    return { cycle: await this.cycles.get(actor, id) };
  }

  @Get(":id/export.csv")
  @Header("content-type", "text/csv; charset=utf-8")
  async exportCsv(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Res() response: Response,
  ) {
    const csv = await this.cycles.exportCsv(actor, id);
    response
      .setHeader(
        "content-disposition",
        `attachment; filename="${id}-points.csv"`,
      )
      .send(csv);
  }

  @Post(":id/items/:itemId/adjust")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async adjustItem(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body() input: AdjustPointCycleItemDto,
  ) {
    return {
      cycle: await this.cycles.adjustItem(actor, id, itemId, input),
    };
  }

  @Post(":id/settle")
  @HttpCode(200)
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async settle(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return {
      cycle: await this.cycles.settleCycle(id, new Date(), actor),
    };
  }

  @Post()
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async create(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreatePointCycleDto,
  ) {
    return {
      cycle: await this.cycles.create(actor, input.businessDate),
    };
  }
}
