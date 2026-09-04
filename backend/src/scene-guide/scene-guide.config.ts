import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function sceneGuidePromptPath(): string {
  const configured = process.env.SCENE_GUIDE_PROMPT_PATH?.trim();
  if (configured && existsSync(configured)) return configured;
  return fileURLToPath(
    new URL(
      "../../../docs/quality/prompts/scene-guide-v1/manifest.json",
      import.meta.url,
    ),
  );
}

export function sceneGuideModelTimeoutMs(value: string | undefined): number {
  const parsed = Number(value?.trim() || 180_000);
  if (!Number.isInteger(parsed) || parsed < 10_000 || parsed > 600_000) {
    throw new Error("SCENE_GUIDE_MODEL_TIMEOUT_MS 必须是 10000 到 600000 之间的整数");
  }
  return parsed;
}

export function sceneGuideModelBaseUrl(): string {
  const value = process.env.QWEN_BASE_URL?.trim();
  if (!value) throw new Error("QWEN_BASE_URL is required");
  return value;
}

export function sceneGuideModelApiKey(): string {
  const value = process.env.QWEN_API_KEY?.trim();
  if (!value) throw new Error("QWEN_API_KEY is required");
  return value;
}
