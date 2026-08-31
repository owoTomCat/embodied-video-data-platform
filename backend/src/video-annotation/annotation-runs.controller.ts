import { Body, Controller, Get, Param, Patch, Post, UseFilters, UseGuards } from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";
import { SubmissionFailureFilter } from "../submissions/submission-failure.filter.js";
import { AnnotationManagementService } from "./annotation-management.service.js";
import {
  AnnotationRunReasonDto,
  DiscardAnnotationRunDto,
  ReviewAnnotationRunDto,
} from "./dto/annotation-run.dto.js";

@Controller()
@UseGuards(SessionGuard)
@UseFilters(SubmissionFailureFilter)
export class AnnotationRunsController {
  constructor(private readonly annotations: AnnotationManagementService) {}

  @Get("submissions/:submissionId/annotation-runs")
  list(
    @CurrentUser() actor: PublicUser,
    @Param("submissionId") submissionId: string,
  ) {
    return this.annotations.list(actor, submissionId);
  }

  @Get("annotation-runs/:runId")
  get(
    @CurrentUser() actor: PublicUser,
    @Param("runId") runId: string,
  ) {
    return this.annotations.get(actor, runId);
  }

  @Post("submissions/:submissionId/annotation-runs")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  createNewVersion(
    @CurrentUser() actor: PublicUser,
    @Param("submissionId") submissionId: string,
    @Body() input: AnnotationRunReasonDto,
  ) {
    return this.annotations.createNewVersion(actor, submissionId, input.reason);
  }

  @Post("annotation-runs/:runId/retry")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  retry(
    @CurrentUser() actor: PublicUser,
    @Param("runId") runId: string,
    @Body() input: AnnotationRunReasonDto,
  ) {
    return this.annotations.retry(actor, runId, input.reason);
  }

  @Post("annotation-runs/:runId/discard")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  discard(
    @CurrentUser() actor: PublicUser,
    @Param("runId") runId: string,
    @Body() input: DiscardAnnotationRunDto,
  ) {
    return this.annotations.discard(actor, runId, input);
  }

  @Patch("annotation-runs/:runId/review")
  @UseGuards(AllowedOriginGuard)
  review(
    @CurrentUser() actor: PublicUser,
    @Param("runId") runId: string,
    @Body() input: ReviewAnnotationRunDto,
  ) {
    return this.annotations.review(actor, runId, input);
  }
}
