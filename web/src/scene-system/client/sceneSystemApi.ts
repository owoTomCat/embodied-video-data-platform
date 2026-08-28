import type {
  CreateSceneClassificationInput,
  CreateSceneLibraryInput,
  Level1Scene,
  SceneClassification,
  SceneLibraryItem,
  UpdateSceneClassificationInput,
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
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:4000/api/v1";
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
