import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseFilters,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import {
  ClearDuplicateCandidateDto,
  CompleteUploadDto,
  CreateUploadDto,
  DeleteSubmissionDto,
  DeleteSubmissionObjectsDto,
  ListSubmissionsQueryDto,
  PresignPartsDto,
  RenameSubmissionDto,
  RerunAiQualityDto,
  ReviewSubmissionQualityDto,
  VerifyResumeUploadDto,
} from "./dto/upload.dto.js";
import { SubmissionFailureFilter } from "./submission-failure.filter.js";
import { SubmissionsService } from "./submissions.service.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";

@Controller("submissions")
@UseGuards(SessionGuard)
@UseFilters(SubmissionFailureFilter)
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Post("uploads")
  @UseGuards(AllowedOriginGuard)
  createUpload(
    @CurrentUser() actor: PublicUser,
    @Body() input: CreateUploadDto,
  ) {
    return this.submissions.createUpload(actor, input);
  }

  @Post(":id/uploads/parts")
  @UseGuards(AllowedOriginGuard)
  presignParts(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: PresignPartsDto,
  ) {
    return this.submissions.presignParts(actor, id, input.partNumbers);
  }

  @Post(":id/uploads/resume")
  @UseGuards(AllowedOriginGuard)
  verifyResumeUpload(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: VerifyResumeUploadDto,
  ) {
    return this.submissions.verifyResumeUpload(actor, id, input);
  }

  @Get("uploads/active")
  async activeUploads(@CurrentUser() actor: PublicUser) {
    return { uploads: await this.submissions.activeUploads(actor) };
  }

  @Post(":id/uploads/complete")
  @UseGuards(AllowedOriginGuard)
  completeUpload(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: CompleteUploadDto,
  ) {
    return this.submissions.completeUpload(actor, id, input);
  }

  @Delete(":id/uploads")
  @UseGuards(AllowedOriginGuard)
  async abortUpload(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
  ): Promise<void> {
    await this.submissions.abortUpload(actor, id);
  }

  @Get()
  async list(
    @CurrentUser() actor: PublicUser,
    @Query() query: ListSubmissionsQueryDto,
  ) {
    return await this.submissions.list(actor, query);
  }

  @Get("export.csv")
  async exportCsv(
    @CurrentUser() actor: PublicUser,
    @Query() query: ListSubmissionsQueryDto,
    @Res() response: Response,
  ) {
    const csv = await this.submissions.exportCsv(actor, query);
    response
      .setHeader("content-type", "text/csv; charset=utf-8")
      .setHeader(
        "content-disposition",
        'attachment; filename="submissions-export.csv"',
      )
      .send(csv);
  }

  /** 任务维度统计（注意：必须声明在 :id 之前） */
  @Get("task-stats")
  async taskStats(@CurrentUser() actor: PublicUser) {
    return await this.submissions.taskStats(actor);
  }

  @Get(":id")
  async get(@CurrentUser() actor: PublicUser, @Param("id") id: string) {
    return { submission: await this.submissions.get(actor, id) };
  }

  @Get(":id/preview")
  async preview(@CurrentUser() actor: PublicUser, @Param("id") id: string) {
    return { preview: await this.submissions.preview(actor, id) };
  }

  @Get(":id/preview/hls/:fileName")
  async previewHls(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Param("fileName") fileName: string,
    @Res() response: Response,
  ) {
    const resource = await this.submissions.previewHlsResource(
      actor,
      id,
      fileName,
    );
    response
      .setHeader("content-type", resource.contentType)
      .setHeader("cache-control", "private, max-age=60");
    resource.stream.pipe(response);
  }

  @Patch(":id/quality-review")
  @UseGuards(AllowedOriginGuard)
  async reviewQuality(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: ReviewSubmissionQualityDto,
  ) {
    return {
      submission: await this.submissions.reviewQuality(actor, id, input),
    };
  }

  @Patch(":id/name")
  @UseGuards(AllowedOriginGuard)
  async rename(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: RenameSubmissionDto,
  ) {
    return {
      submission: await this.submissions.renameSubmission(actor, id, input),
    };
  }

  @Post(":id/quality-rerun")
  @UseGuards(AllowedOriginGuard)
  async rerunAiQuality(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: RerunAiQualityDto,
  ) {
    return {
      submission: await this.submissions.rerunAiQuality(
        actor,
        id,
        input.reason,
      ),
    };
  }

  @Delete(":id")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async deleteSubmission(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: DeleteSubmissionDto,
  ) {
    return await this.submissions.deleteSubmission(actor, id, input);
  }

  @Post(":id/duplicate-candidates/:candidateId/clear")
  @UseGuards(AllowedOriginGuard)
  async clearDuplicateCandidate(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Param("candidateId") candidateId: string,
    @Body() input: ClearDuplicateCandidateDto,
  ) {
    return {
      submission: await this.submissions.clearDuplicateCandidate(
        actor,
        id,
        candidateId,
        input.reason,
      ),
    };
  }

  @Delete(":id/objects")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async deleteObjects(
    @CurrentUser() actor: PublicUser,
    @Param("id") id: string,
    @Body() input: DeleteSubmissionObjectsDto,
  ) {
    return {
      submission: await this.submissions.deleteObjects(actor, id, input),
    };
  }
}
