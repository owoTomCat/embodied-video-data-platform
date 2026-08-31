import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import {
  ConfirmNormalizedRequirementsDto,
  CreateTaskDto,
  TaskQueryDto,
  UpdateTaskDto,
} from "./dto/tasks.dto.js";
import { TaskFailureFilter } from "./tasks.failure.filter.js";
import { TasksService } from "./tasks.service.js";

@Controller("tasks")
@UseGuards(SessionGuard)
@UseFilters(TaskFailureFilter)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  /** 数采人员 / 团长：任务大厅（published + paused） */
  @Get()
  async listForCollectors(@CurrentUser() actor: PublicUser) {
    return await this.tasks.listForCollectors(actor);
  }

  /** 管理员：任务管理列表（注意：必须声明在 :id 之前） */
  @Get("manage")
  async listManage(
    @CurrentUser() actor: PublicUser,
    @Query() query: TaskQueryDto,
  ) {
    return await this.tasks.listManage(actor, {
      status: query.status,
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /** 管理员：任务类型选择器使用的预设场景目录（注意：必须声明在 :id 之前） */
  @Get("preset-scenes")
  async presetScenes(@CurrentUser() actor: PublicUser) {
    return await this.tasks.listPresetScenes(actor);
  }

  @Get(":id")
  async get(@CurrentUser() actor: PublicUser, @Param("id") id: string) {
    return { task: await this.tasks.get(actor, id) };
  }

  @Post()
  @UseGuards(AllowedOriginGuard)
  async create(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateTaskDto,
  ) {
    return { task: await this.tasks.create(actor, input) };
  }

  @Patch(":id")
  @UseGuards(AllowedOriginGuard)
  async update(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: UpdateTaskDto,
  ) {
    // update 返回 { task, autoNormalized, normalizationFailed }，直接透传供前端同步规范化信息
    return await this.tasks.update(actor, id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @UseGuards(AllowedOriginGuard)
  async delete(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ): Promise<void> {
    await this.tasks.delete(actor, id);
  }

  /** AI 规范化预览（不落库） */
  @Post(":id/normalize")
  @UseGuards(AllowedOriginGuard)
  async normalize(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return await this.tasks.normalize(actor, id);
  }

  /** 确认规范化结果（管理员可编辑后再确认） */
  @Post(":id/confirm-requirements")
  @UseGuards(AllowedOriginGuard)
  async confirmRequirements(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: ConfirmNormalizedRequirementsDto,
  ) {
    return { task: await this.tasks.confirmRequirements(actor, id, input) };
  }

  @Post(":id/publish")
  @UseGuards(AllowedOriginGuard)
  async publish(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ) {
    return { task: await this.tasks.publish(actor, id) };
  }

  @Post(":id/pause")
  @UseGuards(AllowedOriginGuard)
  async pause(@CurrentUser() actor: PublicUser, @Param("id") id: string) {
    return { task: await this.tasks.pause(actor, id) };
  }

  @Post(":id/resume")
  @UseGuards(AllowedOriginGuard)
  async resume(@CurrentUser() actor: PublicUser, @Param("id") id: string) {
    return { task: await this.tasks.resume(actor, id) };
  }

  @Post(":id/close")
  @UseGuards(AllowedOriginGuard)
  async close(@CurrentUser() actor: PublicUser, @Param("id") id: string) {
    return { task: await this.tasks.close(actor, id) };
  }
}
