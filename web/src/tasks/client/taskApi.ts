import type {
  CollectionTask,
  CollectionTaskForCollector,
  ConfirmRequirementsInput,
  CreateTaskInput,
  NormalizedTaskRequirements,
  TaskListQuery,
  TaskListResult,
  TaskTypeCatalog,
  UpdateTaskInput,
} from "../contracts";

export class TaskApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "TaskApiError";
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
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: "include",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const errorPayload =
      payload && typeof payload === "object"
        ? (payload as { error?: unknown; code?: unknown })
        : {};
    const message =
      typeof errorPayload.error === "string"
        ? errorPayload.error
        : `请求失败（HTTP ${response.status}）`;
    const code =
      typeof errorPayload.code === "string" ? errorPayload.code : undefined;
    throw new TaskApiError(response.status, message, code);
  }
  return payload as T;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试";
}

function taskFrom(payload: { task: CollectionTask }): CollectionTask {
  return payload.task;
}

export async function listTasksForCollector(): Promise<
  CollectionTaskForCollector[]
> {
  const payload = await requestJson<{ tasks: CollectionTaskForCollector[] }>(
    "tasks",
  );
  return payload.tasks;
}

/** 任务类型选择器数据源：预设场景目录 + 通用任务模板（管理员） */
export async function listTaskTypeCatalog(): Promise<TaskTypeCatalog> {
  return requestJson<TaskTypeCatalog>("tasks/preset-scenes");
}

export async function listManageTasks(
  query: TaskListQuery = {},
): Promise<TaskListResult> {
  const params = new URLSearchParams();
  if (query.status && query.status !== "all") {
    params.set("status", query.status);
  }
  if (query.q) params.set("q", query.q);
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  const suffix = params.toString();
  return requestJson<TaskListResult>(`tasks/manage${suffix ? `?${suffix}` : ""}`);
}

export async function getTask(id: string): Promise<CollectionTask> {
  return requestJson<{ task: CollectionTask }>(`tasks/${id}`).then(taskFrom);
}

export async function createTask(
  input: CreateTaskInput,
): Promise<CollectionTask> {
  return requestJson<{ task: CollectionTask }>("tasks", {
    method: "POST",
    body: JSON.stringify(input),
  }).then(taskFrom);
}

/** 编辑任务结果：任务 + 自动规范化信息（供前端同步提示词规范化状态） */
export type UpdateTaskResult = {
  task: CollectionTask;
  autoNormalized: boolean;
  normalizationFailed: boolean;
};

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
): Promise<UpdateTaskResult> {
  return requestJson<UpdateTaskResult>(`tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteTask(id: string): Promise<void> {
  await requestJson<void>(`tasks/${id}`, { method: "DELETE" });
}

/** AI 规范化预览（不落库） */
export async function normalizeTaskRequirements(
  id: string,
): Promise<NormalizedTaskRequirements> {
  const payload = await requestJson<{ normalized: NormalizedTaskRequirements }>(
    `tasks/${id}/normalize`,
    { method: "POST" },
  );
  return payload.normalized;
}

export async function confirmTaskRequirements(
  id: string,
  input: ConfirmRequirementsInput,
): Promise<CollectionTask> {
  return requestJson<{ task: CollectionTask }>(
    `tasks/${id}/confirm-requirements`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  ).then(taskFrom);
}

export async function publishTask(id: string): Promise<CollectionTask> {
  return requestJson<{ task: CollectionTask }>(`tasks/${id}/publish`, {
    method: "POST",
  }).then(taskFrom);
}

export async function pauseTask(id: string): Promise<CollectionTask> {
  return requestJson<{ task: CollectionTask }>(`tasks/${id}/pause`, {
    method: "POST",
  }).then(taskFrom);
}

export async function resumeTask(id: string): Promise<CollectionTask> {
  return requestJson<{ task: CollectionTask }>(`tasks/${id}/resume`, {
    method: "POST",
  }).then(taskFrom);
}

export async function closeTask(id: string): Promise<CollectionTask> {
  return requestJson<{ task: CollectionTask }>(`tasks/${id}/close`, {
    method: "POST",
  }).then(taskFrom);
}

export { errorMessage as taskErrorMessage };
