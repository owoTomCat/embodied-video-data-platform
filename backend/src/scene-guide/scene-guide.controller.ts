import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import {
  CreateCollectorLibraryDto,
  GenerateGuideTaskDto,
} from "./dto/scene-guide.dto.js";
import { SceneGuideFailureFilter } from "./scene-guide.failure.filter.js";
import { SceneGuideService } from "./scene-guide.service.js";
import { SceneGuideFailure } from "./scene-guide.policy.js";

/**
 * 数采个人场景库 + 拍照生成任务卡：
 * 数采自建「我的场景库」→ 在场景库下拍照生成 3-5 张任务卡（私有）→ 点任务卡进提交页（顶部显示操作提示）。
 * 管理员可看到并统一管理所有数采的场景库。
 */
@Controller("scene-guide")
@UseGuards(SessionGuard)
@UseFilters(SceneGuideFailureFilter)
export class SceneGuideController {
  constructor(private readonly guide: SceneGuideService) {}

  // ---------- 数采个人场景库 ----------

  /** 数采：计费大类分类（任务大厅分栏）。 */
  @Get("categories")
  async listCategories(@CurrentUser() actor: PublicUser) {
    return { categories: await this.guide.listCategories(actor) };
  }

  /** 数采：某个一级大场景分类下的个人场景库列表。 */
  @Get("libraries/by-category/:categoryKey")
  async listLibrariesByCategory(
    @CurrentUser() actor: PublicUser,
    @Param("categoryKey") categoryKey: string,
  ) {
    return { libraries: await this.guide.listLibrariesByCategory(actor, categoryKey) };
  }

  /** 数采：我的场景库列表。 */
  @Get("libraries/mine")
  async listMyLibraries(@CurrentUser() actor: PublicUser) {
    return { libraries: await this.guide.listMyLibraries(actor) };
  }

  /** 数采：创建自己的场景库。 */
  @Post("libraries")
  @UseGuards(AllowedOriginGuard)
  async createLibrary(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateCollectorLibraryDto,
  ) {
    return {
      library: await this.guide.createLibrary(actor, {
        name: input.name,
        sceneId: input.sceneId,
        collectionTaskId: input.collectionTaskId,
        description: input.description,
        photoRefs: input.photoRefs,
      }),
    };
  }

  /** 数采：查看单个场景库（含任务卡）。 */
  @Get("libraries/:id")
  async getLibrary(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return { library: await this.guide.getLibraryDetail(actor, id) };
  }

  /** 数采 / 管理员：删除场景库。 */
  @Delete("libraries/:id")
  @UseGuards(AllowedOriginGuard)
  async deleteLibrary(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return await this.guide.deleteLibrary(actor, id);
  }

  /** 管理员：全部场景库（统一管理）。 */
  @Get("libraries")
  async listAllLibraries(@CurrentUser() actor: PublicUser) {
    return { libraries: await this.guide.listAllLibraries(actor) };
  }

  /** 数采：获取照片的预签名下载 URL（用于场景库卡片封面展示）。 */
  @Get("photo")
  @UseGuards(AllowedOriginGuard)
  async photoUrl(
    @CurrentUser() actor: PublicUser,
    @Query("key") key: string,
  ) {
    if (!key) {
      throw new SceneGuideFailure("VALIDATION", "缺少照片 key", 400);
    }
    return await this.guide.resolvePhotoUrl(actor, key);
  }

  // ---------- 任务卡 ----------

  /** 预签名上传地址（数采上传环境照片）。 */
  @Post("photo/upload")
  @UseGuards(AllowedOriginGuard)
  async presignPhoto(
    @CurrentUser() actor: PublicUser,
    @Body() input: { name: string; contentType: string; sizeBytes: number },
  ) {
    return { upload: await this.guide.presignPhoto(actor, input) };
  }

  /** 拍照指导：识别环境物体 + 生成 3-5 张任务卡（ai_generated）。 */
  @Post()
  @UseGuards(AllowedOriginGuard)
  async generate(
    @CurrentUser() actor: PublicUser,
    @Body() input: GenerateGuideTaskDto,
  ) {
    return {
      tasks: await this.guide.generate(actor, {
        sceneLibraryId: input.sceneLibraryId,
        photoRefs: input.photoRefs,
      }),
    };
  }

  /** 某场景库下的任务卡列表。 */
  @Get("library/:libraryId/tasks")
  async listByLibrary(
    @CurrentUser() actor: PublicUser,
    @Param("libraryId") libraryId: string,
  ) {
    return { tasks: await this.guide.listByLibrary(actor, libraryId) };
  }

  /** 管理员：全部指导任务卡（审核）。 */
  @Get()
  async listForAdmin(@CurrentUser() actor: PublicUser) {
    return { tasks: await this.guide.listForAdmin(actor) };
  }

  @Get(":id")
  async get(@CurrentUser() actor: PublicUser, @Param("id") id: string) {
    return { task: await this.guide.get(actor, id) };
  }
}
