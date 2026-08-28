import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AiQualityModule } from "../ai-quality/ai-quality.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { CollectionTaskEntity } from "../database/entities/collection-task.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { ScenePricingModule } from "../scene-pricing/scene-pricing.module.js";
import { SceneSystemModule } from "../scene-system/scene-system.module.js";
import { SecurityModule } from "../security/security.module.js";
import { RequirementNormalizerService } from "./requirement-normalizer.service.js";
import { TaskFailureFilter } from "./tasks.failure.filter.js";
import { TasksController } from "./tasks.controller.js";
import { TasksPolicy } from "./tasks.policy.js";
import { TasksService } from "./tasks.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([CollectionTaskEntity]),
    AuthModule,
    AuditModule,
    SecurityModule,
    AiQualityModule,
    ScenePricingModule,
    SceneSystemModule,
  ],
  controllers: [TasksController],
  providers: [
    TasksService,
    TasksPolicy,
    TaskFailureFilter,
    RequirementNormalizerService,
    AllowedOriginGuard,
  ],
  exports: [TasksService],
})
export class TasksModule {}
