import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "../auth/auth.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuditLogEntity } from "../database/entities/audit-log.entity.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import { WorkerHeartbeatEntity } from "../database/entities/worker-heartbeat.entity.js";
import { OperationsController } from "./operations.controller.js";
import { AutomaticWorkerReclaimerService } from "./automatic-worker-reclaimer.service.js";
import { OperationsFailureFilter } from "./operations-failure.filter.js";
import { OperationsService } from "./operations.service.js";
import { WorkerHeartbeatService } from "./worker-heartbeat.service.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SecurityModule } from "../security/security.module.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AuditLogEntity,
      AnnotationRunEntity,
      JobOutboxEntity,
      SubmissionEntity,
      VideoQualityResultEntity,
      WorkerHeartbeatEntity,
    ]),
    AuditModule,
    AuthModule,
    SecurityModule,
  ],
  controllers: [OperationsController],
  providers: [
    AutomaticWorkerReclaimerService,
    OperationsService,
    WorkerHeartbeatService,
    OperationsFailureFilter,
    AllowedOriginGuard,
  ],
  exports: [WorkerHeartbeatService],
})
export class OperationsModule {}
