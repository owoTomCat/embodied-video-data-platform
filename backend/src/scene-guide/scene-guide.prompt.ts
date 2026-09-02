import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  envelopeEnvRecognitionSchema,
  envelopeTaskCardSchema,
  SCENE_GUIDE_SCHEMA_VERSION,
} from "./scene-guide.schema.js";

export type LoadedSceneGuidePrompt = {
  promptVersion: string;
  envRecognitionSystemPrompt: string;
  envRecognitionOutputExample: Record<string, unknown>;
  envRecognitionModel: string;
  taskCardSystemPrompt: string;
  taskCardOutputExample: Record<string, unknown>;
  taskCardModel: string;
  contentSha256: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`场景指导提示词 manifest 缺少或无效：${label}`);
  }
  return value.trim();
}

async function resolveManifestPath(path: string): Promise<string> {
  const info = await stat(path);
  return info.isDirectory() ? join(path, "manifest.json") : path;
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `场景指导提示词文件读取失败：${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
}

export async function loadSceneGuidePrompt(
  path: string,
): Promise<LoadedSceneGuidePrompt> {
  const manifestPath = await resolveManifestPath(path);
  const manifest = await readJsonFile(manifestPath);
  if (!isRecord(manifest) || !isRecord(manifest.files)) {
    throw new Error("场景指导 manifest 必须包含 files 对象");
  }
  const promptVersion = requiredString(manifest.promptVersion, "promptVersion");
  const files = manifest.files;
  const envRecognitionSystemPrompt = requiredString(
    files.envRecognitionSystemPrompt,
    "files.envRecognitionSystemPrompt",
  );
  const envRecognitionOutputExample = requiredString(
    files.envRecognitionOutputExample,
    "files.envRecognitionOutputExample",
  );
  const taskCardSystemPrompt = requiredString(
    files.taskCardSystemPrompt,
    "files.taskCardSystemPrompt",
  );
  const taskCardOutputExample = requiredString(
    files.taskCardOutputExample,
    "files.taskCardOutputExample",
  );
  const envRecognitionModel = requiredString(manifest.model, "model");
  const taskCardModel = requiredString(manifest.cardModel, "cardModel");

  const directory = dirname(manifestPath);
  const envRecognitionSystemPromptText = (
    await readFile(resolve(directory, envRecognitionSystemPrompt), "utf8")
  ).trim();
  if (!envRecognitionSystemPromptText) {
    throw new Error("场景指导环境识别系统提示词为空");
  }
  const taskCardSystemPromptText = (
    await readFile(resolve(directory, taskCardSystemPrompt), "utf8")
  ).trim();
  if (!taskCardSystemPromptText) {
    throw new Error("场景指导任务卡系统提示词为空");
  }
  const envExampleValue = await readJsonFile(
    resolve(directory, envRecognitionOutputExample),
  );
  if (!isRecord(envExampleValue)) {
    throw new Error("场景指导环境识别示例必须是 JSON 对象");
  }
  envelopeEnvRecognitionSchema.parse(envExampleValue);
  const cardExampleValue = await readJsonFile(
    resolve(directory, taskCardOutputExample),
  );
  if (!isRecord(cardExampleValue)) {
    throw new Error("场景指导任务卡示例必须是 JSON 对象");
  }
  envelopeTaskCardSchema.parse(cardExampleValue);

  return {
    promptVersion,
    envRecognitionSystemPrompt: envRecognitionSystemPromptText,
    envRecognitionOutputExample: envExampleValue,
    envRecognitionModel,
    taskCardSystemPrompt: taskCardSystemPromptText,
    taskCardOutputExample: cardExampleValue,
    taskCardModel,
    contentSha256: createHash("sha256")
      .update(
        JSON.stringify({
          promptVersion,
          schemaVersion: SCENE_GUIDE_SCHEMA_VERSION,
          envRecognitionSystemPrompt: envRecognitionSystemPromptText,
          envRecognitionOutputExample: envExampleValue,
          taskCardSystemPrompt: taskCardSystemPromptText,
          taskCardOutputExample: cardExampleValue,
          envRecognitionModel,
          taskCardModel,
        }),
        "utf8",
      )
      .digest("hex"),
  };
}
