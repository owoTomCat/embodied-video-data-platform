import type {
  CollectorLibrary,
  CreateCollectorLibraryInput,
  GenerateGuideTaskInput,
  GuideScene,
  GuideTask,
  PhotoUploadResult,
  SceneCategory,
} from "../contracts";

export class SceneGuideApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SceneGuideApiError";
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
    throw new SceneGuideApiError(
      response.status,
      typeof error.error === "string" ? error.error : "场景指导请求失败",
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

// ---------- 数采个人场景库 ----------

export async function listMyLibraries(): Promise<CollectorLibrary[]> {
  const result = await requestJson<{ libraries: CollectorLibrary[] }>(
    "scene-guide/libraries/mine",
  );
  return result.libraries;
}

/** 计费大类分类（任务大厅分栏）。 */
export async function listSceneCategories(): Promise<SceneCategory[]> {
  const result = await requestJson<{ categories: SceneCategory[] }>(
    "scene-guide/categories",
  );
  return result.categories;
}

/** 某个一级大场景分类下的数采个人场景库列表（任务大厅进入某大场景后展示）。 */
export async function listLibrariesByCategory(
  categoryKey: string,
): Promise<CollectorLibrary[]> {
  const result = await requestJson<{ libraries: CollectorLibrary[] }>(
    `scene-guide/libraries/by-category/${encodeURIComponent(categoryKey)}`,
  );
  return result.libraries;
}

export async function createCollectorLibrary(
  input: CreateCollectorLibraryInput,
): Promise<CollectorLibrary> {
  const result = await requestJson<{ library: CollectorLibrary }>(
    "scene-guide/libraries",
    { method: "POST", body: JSON.stringify(input) },
  );
  return result.library;
}

export async function getCollectorLibrary(
  id: string,
): Promise<CollectorLibrary & { tasks: GuideTask[] }> {
  const result = await requestJson<{
    library: CollectorLibrary & { tasks: GuideTask[] };
  }>(`scene-guide/libraries/${encodeURIComponent(id)}`);
  return result.library;
}

export async function deleteCollectorLibrary(id: string): Promise<void> {
  await requestJson<{ deleted: boolean }>(
    `scene-guide/libraries/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

/** 场景库/任务卡照片的预签名下载 URL（用于场景库卡片封面展示）。 */
export async function getGuidePhotoUrl(objectKey: string): Promise<{ url: string; expiresAt: number }> {
  return requestJson<{ url: string; expiresAt: number }>(
    `scene-guide/photo?key=${encodeURIComponent(objectKey)}`,
  );
}

/** 场景（单层），用于建库选择 */
export async function listScenes(): Promise<GuideScene[]> {
  const result = await requestJson<{ scenes: GuideScene[] }>(
    "scene-system/scenes",
  );
  return result.scenes;
}

// ---------- 任务卡 ----------

export async function presignPhoto(input: {
  name: string;
  contentType: string;
  sizeBytes: number;
}): Promise<PhotoUploadResult> {
  const result = await requestJson<{ upload: PhotoUploadResult }>(
    "scene-guide/photo/upload",
    { method: "POST", body: JSON.stringify(input) },
  );
  return result.upload;
}

export async function generateGuideTasks(
  input: GenerateGuideTaskInput,
): Promise<GuideTask[]> {
  const result = await requestJson<{ tasks: GuideTask[] }>("scene-guide", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.tasks;
}

export async function listLibraryTasks(
  libraryId: string,
): Promise<GuideTask[]> {
  const result = await requestJson<{ tasks: GuideTask[] }>(
    `scene-guide/library/${encodeURIComponent(libraryId)}/tasks`,
  );
  return result.tasks;
}

export async function getGuideTask(id: string): Promise<GuideTask> {
  const result = await requestJson<{ task: GuideTask }>(
    `scene-guide/${encodeURIComponent(id)}`,
  );
  return result.task;
}

/** 管理员：全部指导任务卡（审核用）。 */
export async function listAllGuideTasks(): Promise<GuideTask[]> {
  const result = await requestJson<{ tasks: GuideTask[] }>("scene-guide");
  return result.tasks;
}

export function guideTaskErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
