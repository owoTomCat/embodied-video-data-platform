import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AiQualityModule } from "../ai-quality/ai-quality.module.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { StorageModule } from "../storage/storage.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { SecurityModule } from "../security/security.module.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SubmissionFailureFilter } from "../submissions/submission-failure.filter.js";
import { AnnotationManagementService } from "./annotation-management.service.js";
import { AnnotationRunsController } from "./annotation-runs.controller.js";
import { AnnotationRunService } from "./annotation-run.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnnotationRunEntity,
      SubmissionEntity,
      MediaMetadataEntity,
    ]),
    StorageModule,
    AiQualityModule,
    AuditModule,
    AuthModule,
    SecurityModule,
  ],
  controllers: [AnnotationRunsController],
  providers: [
    AnnotationRunService,
    AnnotationManagementService,
    AllowedOriginGuard,
    SubmissionFailureFilter,
  ],
  exports: [AnnotationRunService],
})
export class VideoAnnotationModule {}
