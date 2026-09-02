import { resolveApiBaseUrl } from "../../lib/api-base";
import type {
  CreateSceneClassificationInput,
  CreateSceneLevel1Input,
  CreateSceneLibraryInput,
  Level1Scene,
  SceneClassification,
  SceneLibraryItem,
  UpdateSceneClassificationInput,
  UpdateSceneLevel1Input,
  UpdateSceneLibraryInput,
} from "../contracts";

export class SceneSystemApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SceneSystemApiError";
  }
}

function apiUrl(path: string): string {
  const base = resolveApiBaseUrl(
    process.env.NEXT_PUBLIC_API_BASE_URL,
    "http://localhost:4000/api/v1",
  );
  return `${base.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers,
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = payload as { code?: unknown; error?: unknown };
    throw new SceneSystemApiError(
      response.status,
      typeof error.error === "string" ? error.error : "场景体系请求失败",
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

export async function listLevel1Scenes(): Promise<Level1Scene[]> {
  const result = await requestJson<{ level1: Level1Scene[] }>(
    "/scene-system/meta",
  );
  return result.level1;
}

export async function createSceneLevel1(
  input: CreateSceneLevel1Input,
): Promise<Level1Scene> {
  const result = await requestJson<{ item: Level1Scene }>(
    "/scene-system/level1",
    { method: "POST", body: JSON.stringify(input) },
  );
  return result.item;
}

export async function updateSceneLevel1(
  id: string,
  input: UpdateSceneLevel1Input,
): Promise<Level1Scene> {
  const result = await requestJson<{ item: Level1Scene }>(
    `/scene-system/level1/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return result.item;
}

export async function deleteSceneLevel1(id: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(
    `/scene-system/level1/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

/** 场景存量/目标/缺口（各二级场景，管理员看板） */
export type SceneInventoryItem = {
  sceneName: string;
  type: "scene_type" | "measured";
  currentSeconds: number;
  targetSeconds: number;
  shortfallSeconds: number;
  taskCount: number;
};

export async function getSceneInventory(): Promise<SceneInventoryItem[]> {
  const result = await requestJson<{ items: SceneInventoryItem[] }>(
    "/scene-system/inventory",
  );
  return result.items;
}

/** 场景进度（各二级场景存量/目标/缺口）——数采端任务大厅可见，用于场景型任务优先采集缺口大的场景 */
export async function getSceneProgress(): Promise<SceneInventoryItem[]> {
  const result = await requestJson<{ items: SceneInventoryItem[] }>(
    "/scene-system/progress",
  );
  return result.items;
}

export async function listSceneClassification(): Promise<
  SceneClassification[]
> {
  const result = await requestJson<{
    classification: SceneClassification[];
  }>("/scene-system/classification");
  return result.classification;
}

export async function createSceneClassification(
  input: CreateSceneClassificationInput,
): Promise<SceneClassification> {
  const result = await requestJson<{ item: SceneClassification }>(
    "/scene-system/classification",
    { method: "POST", body: JSON.stringify(input) },
  );
  return result.item;
}

export async function updateSceneClassification(
  id: string,
  input: UpdateSceneClassificationInput,
): Promise<SceneClassification> {
  const result = await requestJson<{ item: SceneClassification }>(
    `/scene-system/classification/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return result.item;
}

export async function deleteSceneClassification(
  id: string,
): Promise<void> {
  await requestJson<{ deleted: boolean }>(
    `/scene-system/classification/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export async function listSceneLibrary(): Promise<SceneLibraryItem[]> {
  const result = await requestJson<{ library: SceneLibraryItem[] }>(
    "/scene-system/library",
  );
  return result.library;
}

export async function createSceneLibrary(
  input: CreateSceneLibraryInput,
): Promise<SceneLibraryItem> {
  const result = await requestJson<{ item: SceneLibraryItem }>(
    "/scene-system/library",
    { method: "POST", body: JSON.stringify(input) },
  );
  return result.item;
}

export async function updateSceneLibrary(
  id: string,
  input: UpdateSceneLibraryInput,
): Promise<SceneLibraryItem> {
  const result = await requestJson<{ item: SceneLibraryItem }>(
    `/scene-system/library/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return result.item;
}

export async function deleteSceneLibrary(id: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(
    `/scene-system/library/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}
