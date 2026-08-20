import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AiQualityModule } from "../ai-quality/ai-quality.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { SubmissionDuplicateCandidateEntity } from "../database/entities/submission-duplicate-candidate.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SecurityModule } from "../security/security.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { SubmissionFailureFilter } from "./submission-failure.filter.js";
import { SubmissionStorageReconciliationService } from "./submission-storage-reconciliation.service.js";
import { SubmissionsController } from "./submissions.controller.js";
import { SubmissionsPolicy } from "./submissions.policy.js";
import { SubmissionsService } from "./submissions.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubmissionEntity,
      SubmissionDuplicateCandidateEntity,
      JobOutboxEntity,
      VideoQualityResultEntity,
    ]),
    AuditModule,
    AuthModule,
    SecurityModule,
    StorageModule,
    AiQualityModule,
  ],
  controllers: [SubmissionsController],
  providers: [
    SubmissionsService,
    SubmissionsPolicy,
    SubmissionFailureFilter,
    SubmissionStorageReconciliationService,
    AllowedOriginGuard,
  ],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
