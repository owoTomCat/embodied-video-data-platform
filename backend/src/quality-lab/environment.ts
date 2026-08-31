import { dirname, resolve } from "node:path";

export type RawQualityLabEnvironment = Record<string, string | undefined>;

export type QualityLabMode = "quality" | "fused";

export type QualityLabEnvironment = {
  host: string;
  port: number;
  maxUploadBytes: number;
  modelTimeoutMs: number;
  mode: QualityLabMode;
  promptPath: string;
  annotationPromptPath: string;
  annotationModelTimeoutMs: number;
  annotationConcurrency: number;
  qwenApiKey?: string;
  qwenBaseUrl: string;
  initialModel: string;
  reviewModel: string;
  modelConfigured: boolean;
  historyPath?: string;
  promptStatePath?: string;
  historyRetentionDays: number;
};

function integer(
  source: RawQualityLabEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(source[name] ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return parsed;
}

export function parseQualityLabEnvironment(
  source: RawQualityLabEnvironment,
): QualityLabEnvironment {
  const qwenApiKey = source.QWEN_API_KEY?.trim() || undefined;
  const qwenBaseUrl = (
    source.QWEN_BASE_URL ??
    "https://dashscope.aliyuncs.com/compatible-mode/v1"
  ).trim();
  const url = new URL(qwenBaseUrl);
  if (url.protocol !== "https:") {
    throw new Error("QWEN_BASE_URL 必须使用 HTTPS");
  }
  const host = (source.QUALITY_LAB_HOST ?? "127.0.0.1").trim();
  if (host !== "127.0.0.1" && host !== "0.0.0.0") {
    throw new Error("QUALITY_LAB_HOST 只能是 127.0.0.1 或 0.0.0.0");
  }
  const historyPath = source.QUALITY_LAB_HISTORY_PATH?.trim() || undefined;
  const modeValue = source.QUALITY_LAB_MODE?.trim().toLowerCase() || "quality";
  if (modeValue !== "quality" && modeValue !== "fused") {
    throw new Error("QUALITY_LAB_MODE 必须是 quality 或 fused");
  }
  return {
    host,
    port: integer(source, "QUALITY_LAB_PORT", 4010, 1, 65_535),
    maxUploadBytes: integer(
      source,
      "QUALITY_LAB_MAX_UPLOAD_BYTES",
      1_073_741_824,
      1,
      2_147_483_648,
    ),
    modelTimeoutMs: integer(
      source,
      "QUALITY_LAB_MODEL_TIMEOUT_MS",
      600_000,
      1_000,
      3_600_000,
    ),
    mode: modeValue,
    promptPath:
      source.VIDEO_QUALITY_PROMPT_PATH?.trim() ||
      resolve(
        process.cwd(),
        "../docs/quality/prompts/qwen-video-ai-quality-framework-v2/manifest.json",
      ),
    annotationPromptPath:
      source.VIDEO_ANNOTATION_PROMPT_PATH?.trim() ||
      resolve(
        process.cwd(),
        "../docs/quality/prompts/ego-video-annotation-v2/manifest.json",
      ),
    annotationModelTimeoutMs: integer(
      source,
      "AI_ANNOTATION_MODEL_TIMEOUT_MS",
      180_000,
      10_000,
      600_000,
    ),
    annotationConcurrency: integer(
      source,
      "AI_ANNOTATION_CONCURRENCY",
      1,
      1,
      8,
    ),
    qwenApiKey,
    qwenBaseUrl: url.toString().replace(/\/$/u, ""),
    initialModel:
      source.VIDEO_QUALITY_INITIAL_MODEL?.trim() ||
      "qwen3.7-plus",
    reviewModel:
      source.VIDEO_QUALITY_REVIEW_MODEL?.trim() ||
      "qwen3.7-flash",
    modelConfigured: Boolean(qwenApiKey),
    historyPath,
    promptStatePath:
      source.QUALITY_LAB_PROMPT_STATE_PATH?.trim() ||
      (historyPath ? resolve(dirname(historyPath), "prompt.json") : undefined),
    historyRetentionDays: integer(
      source,
      "QUALITY_LAB_HISTORY_RETENTION_DAYS",
      30,
      1,
      365,
    ),
  };
}
