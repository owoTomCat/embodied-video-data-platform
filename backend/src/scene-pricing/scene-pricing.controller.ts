import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";
import { UpdateSceneCategoryPriceDto } from "./dto/update-scene-category-price.dto.js";
import { ScenePricingFailureFilter } from "./scene-pricing-failure.filter.js";
import { ScenePricingService } from "./scene-pricing.service.js";

/**
 * 场景大类定价（元/小时）。
 * 读取：登录用户可读；修改：仅管理员，范围 [20, 40]。
 */
@Controller("scene-pricing")
@UseGuards(SessionGuard)
@UseFilters(ScenePricingFailureFilter)
export class ScenePricingController {
  constructor(private readonly pricing: ScenePricingService) {}

  @Get()
  async list(@CurrentUser() actor: PublicUser) {
    return { categories: await this.pricing.list() };
  }

  @Put(":key")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async update(
    @CurrentUser() actor: PublicUser,
    @Param("key") key: string,
    @Body() input: UpdateSceneCategoryPriceDto,
  ) {
    return {
      category: await this.pricing.update(actor, key, input),
    };
  }
}
