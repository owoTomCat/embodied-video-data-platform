import {
  Body,
  Controller,
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
import {
  GenerateGuideTaskDto,
  ReviewGuideTaskDto,
  SubmitEditedCardDto,
} from "./dto/scene-guide.dto.js";
import { SceneGuideFailureFilter } from "./scene-guide.failure.filter.js";
import { SceneGuideService } from "./scene-guide.service.js";

/**
 * 场景指导任务卡（两层任务体系 P3）：
 * 数采选场景型任务 → 拍照（MinIO 预签名上传）→ Qwen-VL 识别环境物体 → LLM 生成任务卡
 * → (编辑→人工审核) → 按卡采集上传。
 */
@Controller("scene-guide")
@UseGuards(SessionGuard)
@UseFilters(SceneGuideFailureFilter)
export class SceneGuideController {
  constructor(private readonly guide: SceneGuideService) {}

  /** 预签名上传地址（数采上传环境照片）。 */
  @Post("photo/upload")
  @UseGuards(AllowedOriginGuard)
  async presignPhoto(
    @CurrentUser() actor: PublicUser,
    @Body() input: { name: string; contentType: string; sizeBytes: number },
  ) {
    return { upload: await this.guide.presignPhoto(actor, input) };
  }

  /** 拍照指导：识别环境物体 + 生成任务卡（ai_generated）。 */
  @Post()
  @UseGuards(AllowedOriginGuard)
  async generate(
    @CurrentUser() actor: PublicUser,
    @Body() input: GenerateGuideTaskDto,
  ) {
    return {
      task: await this.guide.generate(actor, {
        sceneTypeTaskId: input.sceneTypeTaskId,
        photoRefs: input.photoRefs,
      }),
    };
  }

  /** 数采编辑并提交任务卡（→ in_review）。 */
  @Post(":id/submit-edited")
  @UseGuards(AllowedOriginGuard)
  async submitEdited(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: SubmitEditedCardDto,
  ) {
    return {
      task: await this.guide.submitEdited(actor, id, {
        sceneName: input.sceneName,
        card: input.card,
      }),
    };
  }

  /** 管理员审核任务卡（approved / rejected）。 */
  @Post(":id/review")
  @UseGuards(AllowedOriginGuard)
  async review(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: ReviewGuideTaskDto,
  ) {
    return {
      task: await this.guide.review(actor, id, {
        decision: input.decision,
        comment: input.comment,
      }),
    };
  }

  /** 采集完成后回填 submission_id。 */
  @Put(":id/submission")
  @UseGuards(AllowedOriginGuard)
  async backfillSubmission(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: { submissionId: string },
  ) {
    return {
      task: await this.guide.backfillSubmission(actor, id, input.submissionId),
    };
  }

  /** 数采查看自己的指导任务卡列表。 */
  @Get("mine")
  async listMine(@CurrentUser() actor: PublicUser) {
    return { tasks: await this.guide.listMine(actor) };
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
