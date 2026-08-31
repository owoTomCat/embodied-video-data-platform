import { loadVideoQualityPrompt } from "../video-quality/prompt-loader.js";
import { QwenVideoQualityProvider } from "../video-quality/qwen-video-quality.provider.js";
import { VideoQualityMediaPreprocessor } from "../video-quality/media-preprocessor.js";
import { VideoQualityService } from "../video-quality/video-quality.service.js";
import { loadVideoAnnotationPrompt } from "../video-annotation/prompt-loader.js";
import { QwenVideoAnnotationProvider } from "../video-annotation/qwen-video-annotation.provider.js";
import { parseQualityLabEnvironment } from "./environment.js";
import { createQualityLabApp } from "./server.js";
import { QualityLabJobStore } from "./job-store.js";
import { QualityLabPromptStore } from "./prompt-store.js";

async function bootstrap(): Promise<void> {
  const environment = parseQualityLabEnvironment(process.env);
  const store = new QualityLabJobStore({
    persistencePath: environment.historyPath,
    retentionMs: environment.historyRetentionDays * 24 * 60 * 60 * 1_000,
  });
  const writeLog = (event: Record<string, unknown>) => {
    process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`);
  };
  const committedPrompt = await loadVideoQualityPrompt(environment.promptPath);
  if (
    committedPrompt.initialModel !== environment.initialModel ||
    committedPrompt.reviewModel !== environment.reviewModel
  ) {
    throw new Error("环境中的模型 ID 与提示词版本不一致");
  }
  const promptStore = new QualityLabPromptStore({
    committedPrompt,
    persistencePath: environment.promptStatePath,
  });
  const qwenApiKey = environment.qwenApiKey;
  const annotationPrompt =
    environment.mode === "fused"
      ? await loadVideoAnnotationPrompt(environment.annotationPromptPath)
      : undefined;
  const annotationProvider =
    qwenApiKey && annotationPrompt
      ? new QwenVideoAnnotationProvider({
          apiKey: qwenApiKey,
          baseUrl: environment.qwenBaseUrl,
          timeoutMs: environment.annotationModelTimeoutMs,
          maxConcurrency: environment.annotationConcurrency,
          prompt: annotationPrompt,
        })
      : undefined;
  const evaluatorFactory = qwenApiKey
    ? (prompt: ReturnType<QualityLabPromptStore["getCurrent"]>) =>
        new VideoQualityService({
          preprocessor: new VideoQualityMediaPreprocessor(),
          provider: new QwenVideoQualityProvider({
            config: {
              apiKey: qwenApiKey,
              baseUrl: environment.qwenBaseUrl,
              initialModel: environment.initialModel,
              reviewModel: environment.reviewModel,
              timeoutMs: environment.modelTimeoutMs,
            },
            prompt,
            diagnosticSink: (diagnostic) => {
              store.appendDiagnostic(diagnostic.taskId, diagnostic);
              writeLog({ event: "bailian_call_attempt", ...diagnostic });
            },
          }),
          ...(annotationProvider
            ? { annotationProvider, annotationSampleRate: 1 }
            : {}),
        })
    : undefined;
  const app = createQualityLabApp({
    environment,
    evaluator: null,
    evaluatorFactory,
    ...(annotationPrompt
      ? {
          annotation: {
            model: annotationPrompt.model,
            promptVersion: annotationPrompt.promptVersion,
            schemaVersion: annotationPrompt.outputSchema,
            systemPrompt: annotationPrompt.systemPrompt,
          },
        }
      : {}),
    promptStore,
    store,
    logger: writeLog,
  });
  app.listen(environment.port, environment.host, () => {
    process.stdout.write(
      `AI video quality lab listening on http://${environment.host}:${environment.port}\n`,
    );
  });
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown";
  process.stderr.write(`AI video quality lab failed to start: ${message}\n`);
  process.exitCode = 1;
});
