import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { DatabaseModule } from "../database/database.module.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import { StorageModule } from "../storage/storage.module.js";
import { OperationsModule } from "../operations/operations.module.js";
import { VideoQualityMediaPreprocessor } from "../video-quality/media-preprocessor.js";
import { QwenVideoQualityProvider } from "../video-quality/qwen-video-quality.provider.js";
import { VideoQualityService } from "../video-quality/video-quality.service.js";
import {
  aiQualityModelTimeoutMs,
} from "./ai-quality.config.js";
import { AiQualityAnalysisService } from "./ai-quality-analysis.service.js";
import { AiQualityModule } from "./ai-quality.module.js";
import { AI_QUALITY_EVALUATOR_FACTORY } from "./ai-quality.tokens.js";
import { RabbitAiQualityWorker } from "./rabbit-ai-quality-worker.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      SubmissionEntity,
      MediaMetadataEntity,
      VideoQualityResultEntity,
    ]),
    StorageModule,
    AiQualityModule,
    OperationsModule,
  ],
  providers: [
    {
      provide: AI_QUALITY_EVALUATOR_FACTORY,
      useFactory: () =>
        (
          prompt: ConstructorParameters<
            typeof QwenVideoQualityProvider
          >[0]["prompt"],
        ) => {
          const provider = new QwenVideoQualityProvider({
            config: {
              apiKey: required("QWEN_API_KEY"),
              baseUrl: required("QWEN_BASE_URL"),
              initialModel: prompt.initialModel,
              reviewModel: prompt.reviewModel,
              timeoutMs: aiQualityModelTimeoutMs(
                process.env.AI_QUALITY_MODEL_TIMEOUT_MS,
              ),
            },
            prompt,
            diagnosticSink: (diagnostic) => {
              process.stdout.write(`${JSON.stringify({
                event: "ai_quality_model_call",
                ...diagnostic,
              })}\n`);
            },
          });
          return new VideoQualityService({
            preprocessor: new VideoQualityMediaPreprocessor(),
            provider,
          });
        },
    },
    AiQualityAnalysisService,
    RabbitAiQualityWorker,
  ],
})
export class AiQualityWorkerModule {}
