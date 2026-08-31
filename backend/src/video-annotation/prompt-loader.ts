import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  VIDEO_ANNOTATION_SCHEMA_VERSION,
  parseRawVideoAnnotation,
} from "./video-annotation.js";

export type LoadedVideoAnnotationPrompt = {
  systemPrompt: string;
  outputExample: Record<string, unknown>;
  promptVersion: string;
  outputSchema: typeof VIDEO_ANNOTATION_SCHEMA_VERSION;
  model: string;
  contentSha256: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`候选标注提示词 manifest 缺少或无效：${label}`);
  }
  return value.trim();
}

async function resolveManifestPath(path: string): Promise<string> {
  const info = await stat(path);
  return info.isDirectory() ? join(path, "manifest.json") : path;
}

export async function loadVideoAnnotationPrompt(
  path: string,
): Promise<LoadedVideoAnnotationPrompt> {
  const manifestPath = await resolveManifestPath(path);
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `候选标注提示词 manifest 读取失败：${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
  if (!isRecord(manifest) || !isRecord(manifest.files)) {
    throw new Error("候选标注提示词 manifest 必须包含 files 对象");
  }
  const promptVersion = requiredString(manifest.promptVersion, "promptVersion");
  const outputSchema = requiredString(manifest.outputSchema, "outputSchema");
  const model = requiredString(manifest.model, "model");
  const systemFile = requiredString(manifest.files.systemPrompt, "files.systemPrompt");
  const outputFile = requiredString(manifest.files.outputExample, "files.outputExample");
  if (outputSchema !== VIDEO_ANNOTATION_SCHEMA_VERSION) {
    throw new Error(`不支持的候选标注输出 Schema：${outputSchema}`);
  }
  const directory = dirname(manifestPath);
  const systemPrompt = (
    await readFile(resolve(directory, systemFile), "utf8")
  ).trim();
  if (!systemPrompt) throw new Error("候选标注系统提示词为空");
  const outputExampleValue = JSON.parse(
    await readFile(resolve(directory, outputFile), "utf8"),
  ) as unknown;
  if (!isRecord(outputExampleValue)) {
    throw new Error("候选标注标准输出必须是 JSON 对象");
  }
  if (outputExampleValue.schema_version !== VIDEO_ANNOTATION_SCHEMA_VERSION) {
    throw new Error("候选标注标准输出与 manifest 的 Schema 不一致");
  }
  try {
    parseRawVideoAnnotation(outputExampleValue);
  } catch (error) {
    throw new Error(
      `候选标注标准输出不符合 ${VIDEO_ANNOTATION_SCHEMA_VERSION}：${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  }
  return {
    systemPrompt,
    outputExample: outputExampleValue,
    promptVersion,
    outputSchema: VIDEO_ANNOTATION_SCHEMA_VERSION,
    model,
    contentSha256: createHash("sha256")
      .update(
        JSON.stringify({
          promptVersion,
          outputSchema: VIDEO_ANNOTATION_SCHEMA_VERSION,
          model,
          systemPrompt,
          outputExample: outputExampleValue,
        }),
        "utf8",
      )
      .digest("hex"),
  };
}
