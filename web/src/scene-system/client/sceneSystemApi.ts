import { resolveApiBaseUrl } from "../../lib/api-base";
import type {
  CreateSceneInput,
  Scene,
  SceneLibraryItem,
  UpdateSceneInput,
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

/** 场景存量/目标/缺口（各场景，管理员看板） */
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

export async function listScenes(): Promise<Scene[]> {
  const result = await requestJson<{ scenes: Scene[] }>(
    "/scene-system/scenes",
  );
  return result.scenes;
}

export async function createScene(input: CreateSceneInput): Promise<Scene> {
  const result = await requestJson<{ item: Scene }>("/scene-system/scenes", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.item;
}

export async function updateScene(
  id: string,
  input: UpdateSceneInput,
): Promise<Scene> {
  const result = await requestJson<{ item: Scene }>(
    `/scene-system/scenes/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
  return result.item;
}

export async function deleteScene(id: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(
    `/scene-system/scenes/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export async function listSceneLibrary(): Promise<SceneLibraryItem[]> {
  const result = await requestJson<{ library: SceneLibraryItem[] }>(
    "/scene-system/library",
  );
  return result.library;
}
