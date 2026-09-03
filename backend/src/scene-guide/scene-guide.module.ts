import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { CollectionTaskEntity } from "../database/entities/collection-task.entity.js";
import { GuideTaskEntity } from "../database/entities/guide-task.entity.js";
import { SceneCategoryPricingEntity } from "../database/entities/scene-category-pricing.entity.js";
import { SceneEntity } from "../database/entities/scene.entity.js";
import { SceneLibraryEntity } from "../database/entities/scene-library.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { StorageModule } from "../storage/storage.module.js";
import { QwenSceneGuideProvider } from "./qwen-scene-guide.provider.js";
import { SceneGuideController } from "./scene-guide.controller.js";
import {
  sceneGuideModelApiKey,
  sceneGuideModelBaseUrl,
  sceneGuideModelTimeoutMs,
  sceneGuidePromptPath,
} from "./scene-guide.config.js";
import { loadSceneGuidePrompt } from "./scene-guide.prompt.js";
import { SceneGuideService } from "./scene-guide.service.js";
import { SCENE_GUIDE_PROVIDER } from "./scene-guide.tokens.js";

export { SCENE_GUIDE_PROVIDER };

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GuideTaskEntity,
      CollectionTaskEntity,
      SceneLibraryEntity,
      SceneEntity,
      SceneCategoryPricingEntity,
    ]),
    StorageModule,
    AuditModule,
    AuthModule,
  ],
  controllers: [SceneGuideController],
  providers: [
    SceneGuideService,
    AllowedOriginGuard,
    {
      provide: SCENE_GUIDE_PROVIDER,
      useFactory: async () => {
        const prompt = await loadSceneGuidePrompt(sceneGuidePromptPath());
        return new QwenSceneGuideProvider({
          apiKey: sceneGuideModelApiKey(),
          baseUrl: sceneGuideModelBaseUrl(),
          timeoutMs: sceneGuideModelTimeoutMs(process.env.SCENE_GUIDE_MODEL_TIMEOUT_MS),
          prompt,
        });
      },
    },
  ],
  exports: [SceneGuideService],
})
export class SceneGuideModule {}
