import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";
import {
  CreateSceneClassificationDto,
  CreateSceneLevel1Dto,
  CreateSceneLibraryDto,
  UpdateSceneClassificationDto,
  UpdateSceneLevel1Dto,
  UpdateSceneLibraryDto,
} from "./dto/scene-system.dto.js";
import { SceneSystemFailureFilter } from "./scene-system-failure.filter.js";
import { SceneSystemService } from "./scene-system.service.js";

/**
 * 场景体系：一级场景 + 场景分类表 + 场景库。
 * 读取：登录用户可读（任务创建/展示使用）；修改：仅管理员。
 */
@Controller("scene-system")
@UseGuards(SessionGuard)
@UseFilters(SceneSystemFailureFilter)
export class SceneSystemController {
  constructor(private readonly scenes: SceneSystemService) {}

  /** 一级场景（编码/名称/计费大类 key） */
  @Get("meta")
  async meta(@CurrentUser() actor: PublicUser) {
    return { level1: await this.scenes.listLevel1() };
  }

  // ---------- 一级场景 ----------

  @Post("level1")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async createLevel1(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateSceneLevel1Dto,
  ) {
    return { item: await this.scenes.createLevel1(actor, input) };
  }

  @Put("level1/:id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async updateLevel1(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: UpdateSceneLevel1Dto,
  ) {
    return { item: await this.scenes.updateLevel1(actor, id, input) };
  }

  @Delete("level1/:id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async deleteLevel1(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return this.scenes.deleteLevel1(actor, id);
  }

  // ---------- 场景分类表（二级场景） ----------

  @Get("classification")
  async listClassification(@CurrentUser() actor: PublicUser) {
    return {
      classification: await this.scenes.listClassification(),
    };
  }

  @Post("classification")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async createClassification(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateSceneClassificationDto,
  ) {
    return {
      item: await this.scenes.createClassification(actor, input),
    };
  }

  @Put("classification/:id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async updateClassification(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: UpdateSceneClassificationDto,
  ) {
    return {
      item: await this.scenes.updateClassification(actor, id, input),
    };
  }

  @Delete("classification/:id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async deleteClassification(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return this.scenes.deleteClassification(actor, id);
  }

  // ---------- 场景库 ----------

  @Get("library")
  async listLibrary(@CurrentUser() actor: PublicUser) {
    return { library: await this.scenes.listLibrary() };
  }

  @Post("library")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async createLibrary(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateSceneLibraryDto,
  ) {
    return {
      item: await this.scenes.createLibrary(actor, input),
    };
  }

  @Put("library/:id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async updateLibrary(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: UpdateSceneLibraryDto,
  ) {
    return {
      item: await this.scenes.updateLibrary(actor, id, input),
    };
  }

  @Delete("library/:id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async deleteLibrary(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return this.scenes.deleteLibrary(actor, id);
  }
}
