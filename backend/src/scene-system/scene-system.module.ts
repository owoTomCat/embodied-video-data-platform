import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { SceneClassificationEntity } from "../database/entities/scene-classification.entity.js";
import { SceneLibraryEntity } from "../database/entities/scene-library.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SecurityModule } from "../security/security.module.js";
import { SceneSystemController } from "./scene-system.controller.js";
import { SceneSystemFailureFilter } from "./scene-system-failure.filter.js";
import { SceneSystemService } from "./scene-system.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SceneClassificationEntity,
      SceneLibraryEntity,
    ]),
    AuthModule,
    AuditModule,
    SecurityModule,
  ],
  controllers: [SceneSystemController],
  providers: [SceneSystemService, SceneSystemFailureFilter, AllowedOriginGuard],
  exports: [SceneSystemService],
})
export class SceneSystemModule {}
