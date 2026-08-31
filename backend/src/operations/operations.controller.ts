import {
  Controller,
  Get,
  Post,
  Query,
  UseFilters,
  UseGuards,
} from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { SessionGuard } from "../auth/session.guard.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SensitiveActionRateLimitGuard } from "../security/sensitive-action-rate-limit.guard.js";
import { OperationsFailureFilter } from "./operations-failure.filter.js";
import { OperationsService } from "./operations.service.js";
import { AnnotationOperationsQueryDto } from "./dto/annotation-operations-query.dto.js";

@Controller("operations")
@UseGuards(SessionGuard)
@UseFilters(OperationsFailureFilter)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get("queue")
  async queue(@CurrentUser() actor: PublicUser) {
    return await this.operations.queue(actor);
  }

  @Get("annotation-runs")
  async annotationRuns(
    @CurrentUser() actor: PublicUser,
    @Query() query: AnnotationOperationsQueryDto,
  ) {
    return await this.operations.annotationRuns(actor, query);
  }

  @Get("status")
  async status(@CurrentUser() actor: PublicUser) {
    return await this.operations.status(actor);
  }

  @Post("workers/reclaim-timeouts")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async reclaimTimedOutTasks(@CurrentUser() actor: PublicUser) {
    return await this.operations.reclaimTimedOutTasks(actor);
  }

  @Post("workers/prune-inactive")
  @UseGuards(AllowedOriginGuard, SensitiveActionRateLimitGuard)
  async pruneInactiveWorkers(@CurrentUser() actor: PublicUser) {
    return await this.operations.pruneInactiveWorkers(actor);
  }
}
