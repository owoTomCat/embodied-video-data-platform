import type {
  CollectorLibrary,
  CreateCollectorLibraryInput,
  GenerateGuideTaskInput,
  GuideSceneClassification,
  GuideTask,
  PhotoUploadResult,
  ReviewGuideTaskInput,
  SubmitEditedCardInput,
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

/** 场景分类表（二级场景），用于建库选择 */
export async function listSceneClassification(): Promise<
  GuideSceneClassification[]
> {
  const result = await requestJson<{
    classification: GuideSceneClassification[];
  }>("scene-system/classification");
  return result.classification;
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

export async function submitEditedCard(
  id: string,
  input: SubmitEditedCardInput,
): Promise<GuideTask> {
  const result = await requestJson<{ task: GuideTask }>(
    `scene-guide/${encodeURIComponent(id)}/submit-edited`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.task;
}

export async function reviewGuideTask(
  id: string,
  input: ReviewGuideTaskInput,
): Promise<GuideTask> {
  const result = await requestJson<{ task: GuideTask }>(
    `scene-guide/${encodeURIComponent(id)}/review`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.task;
}

export async function backfillSubmission(
  id: string,
  submissionId: string,
): Promise<GuideTask> {
  const result = await requestJson<{ task: GuideTask }>(
    `scene-guide/${encodeURIComponent(id)}/submission`,
    {
      method: "PUT",
      body: JSON.stringify({ submissionId }),
    },
  );
  return result.task;
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
