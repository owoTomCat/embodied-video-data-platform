import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { CollectionTaskEntity } from "../database/entities/collection-task.entity.js";
import { SceneCategoryPricingEntity } from "../database/entities/scene-category-pricing.entity.js";
import { SceneEntity } from "../database/entities/scene.entity.js";
import { SceneLibraryEntity } from "../database/entities/scene-library.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SecurityModule } from "../security/security.module.js";
import { ScenePricingController } from "./scene-pricing.controller.js";
import { ScenePricingFailureFilter } from "./scene-pricing-failure.filter.js";
import { ScenePricingService } from "./scene-pricing.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SceneCategoryPricingEntity,
      SceneEntity,
      SceneLibraryEntity,
      CollectionTaskEntity,
    ]),
    AuthModule,
    AuditModule,
    SecurityModule,
  ],
  controllers: [ScenePricingController],
  providers: [ScenePricingService, ScenePricingFailureFilter, AllowedOriginGuard],
  exports: [ScenePricingService],
})
export class ScenePricingModule {}
