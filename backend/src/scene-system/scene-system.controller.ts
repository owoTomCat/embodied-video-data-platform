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
  CreateSceneDto,
  UpdateSceneDto,
} from "./dto/scene-system.dto.js";
import { SceneSystemFailureFilter } from "./scene-system-failure.filter.js";
import { SceneSystemService } from "./scene-system.service.js";

/**
 * 场景体系：单层「场景」 + 场景库（只读）。
 * 读取：登录用户可读（任务创建/展示使用）；修改：仅管理员。
 * 场景库写操作已废弃（统一由 scene-guide 数采自建）。
 */
@Controller("scene-system")
@UseGuards(SessionGuard)
@UseFilters(SceneSystemFailureFilter)
export class SceneSystemController {
  constructor(private readonly scenes: SceneSystemService) {}

  /** 场景存量/目标/缺口（各场景，管理员）——场景存量看板 */
  @Get("inventory")
  async inventory(@CurrentUser() actor: PublicUser) {
    if (actor.role !== "admin") return { items: [] };
    return await this.scenes.sceneInventory();
  }

  /** 场景进度（各场景存量/目标/缺口）——数采端任务大厅可见 */
  @Get("progress")
  async progress(@CurrentUser() actor: PublicUser) {
    if (actor.status !== "active") return { items: [] };
    return await this.scenes.sceneInventory();
  }

  // ---------- 场景（单层） ----------

  @Get("scenes")
  async listScenes(@CurrentUser() actor: PublicUser) {
    return {
      scenes: await this.scenes.listScenes(),
    };
  }

  @Post("scenes")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async createScene(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateSceneDto,
  ) {
    return {
      item: await this.scenes.createScene(actor, input),
    };
  }

  @Put("scenes/:id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async updateScene(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: UpdateSceneDto,
  ) {
    return {
      item: await this.scenes.updateScene(actor, id, input),
    };
  }

  @Delete("scenes/:id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async deleteScene(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return this.scenes.deleteScene(actor, id);
  }

  // ---------- 场景库（只读） ----------

  @Get("library")
  async listLibrary(@CurrentUser() actor: PublicUser) {
    return { library: await this.scenes.listLibrary() };
  }
}
