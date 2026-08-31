import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_AI_QUALITY_CONCURRENCY = 3;

export function videoQualityPromptPath(): string {
  const configured = process.env.VIDEO_QUALITY_PROMPT_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  return fileURLToPath(
    new URL(
      "../../../docs/quality/prompts/qwen-video-ai-quality-framework-v2/manifest.json",
      import.meta.url,
    ),
  );
}

export function videoAnnotationPromptPath(): string {
  const configured = process.env.VIDEO_ANNOTATION_PROMPT_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  return fileURLToPath(
    new URL(
      "../../../docs/quality/prompts/ego-video-annotation-v2/manifest.json",
      import.meta.url,
    ),
  );
}

export function aiAnnotationShadowEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return true;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error("AI_ANNOTATION_SHADOW_ENABLED 必须是 true 或 false");
}

export function aiQualityConcurrency(value: string | undefined): number {
  const parsed = Number(value?.trim() || DEFAULT_AI_QUALITY_CONCURRENCY);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 32) {
    throw new Error("AI_QUALITY_CONCURRENCY 必须是 1 到 32 之间的整数");
  }
  return parsed;
}

export function aiQualityModelTimeoutMs(value: string | undefined): number {
  const parsed = Number(value?.trim() || 600_000);
  if (!Number.isInteger(parsed) || parsed < 10_000 || parsed > 3_600_000) {
    throw new Error(
      "AI_QUALITY_MODEL_TIMEOUT_MS 必须是 10000 到 3600000 之间的整数",
    );
  }
  return parsed;
}

export function aiAnnotationModelTimeoutMs(value: string | undefined): number {
  const parsed = Number(value?.trim() || 180_000);
  if (!Number.isInteger(parsed) || parsed < 10_000 || parsed > 600_000) {
    throw new Error(
      "AI_ANNOTATION_MODEL_TIMEOUT_MS 必须是 10000 到 600000 之间的整数",
    );
  }
  return parsed;
}

export function aiAnnotationConcurrency(value: string | undefined): number {
  const parsed = Number(value?.trim() || 1);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) {
    throw new Error("AI_ANNOTATION_CONCURRENCY 必须是 1 到 8 之间的整数");
  }
  return parsed;
}

export function aiAnnotationSampleRate(value: string | undefined): number {
  const parsed = Number(value?.trim() || 1);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("AI_ANNOTATION_SAMPLE_RATE 必须是 0 到 1 之间的数字");
  }
  return parsed;
}

export function annotationAutoAcceptEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return true;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error("ANNOTATION_AUTO_ACCEPT_ENABLED 必须是 true 或 false");
}

export function annotationAutoAcceptAuditRate(value: string | undefined): number {
  const parsed = Number(value?.trim() || 0);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error("ANNOTATION_AUTO_ACCEPT_AUDIT_RATE 必须是 0 到 1 之间的数字");
  }
  return parsed;
}
