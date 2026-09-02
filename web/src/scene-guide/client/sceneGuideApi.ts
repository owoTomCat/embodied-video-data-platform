import type {
  GenerateGuideTaskInput,
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

/** 取得环境照片的上传地址，然后直接把文件 PUT 到 url。 */
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

export async function generateGuideTask(
  input: GenerateGuideTaskInput,
): Promise<GuideTask> {
  const result = await requestJson<{ task: GuideTask }>("scene-guide", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.task;
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

export async function listMyGuideTasks(): Promise<GuideTask[]> {
  const result = await requestJson<{ tasks: GuideTask[] }>("scene-guide/mine");
  return result.tasks;
}

export async function listAllGuideTasks(): Promise<GuideTask[]> {
  const result = await requestJson<{ tasks: GuideTask[] }>("scene-guide");
  return result.tasks;
}

export async function getGuideTask(id: string): Promise<GuideTask> {
  const result = await requestJson<{ task: GuideTask }>(
    `scene-guide/${encodeURIComponent(id)}`,
  );
  return result.task;
}

export function guideTaskErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
