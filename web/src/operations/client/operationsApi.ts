import type {
  BackendOperationsStatus,
  BackendAnnotationOperations,
  AnnotationOperationsView,
  BackendQueueSnapshot,
  BackendWorkerReclaimResult,
} from "../contracts";

export class OperationsApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "OperationsApiError";
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
  let headers: Headers | undefined;
  if (init.headers !== undefined || init.body !== undefined) {
    headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set("content-type", "application/json");
  }
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    ...(headers ? { headers } : {}),
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
    throw new OperationsApiError(
      response.status,
      typeof error.error === "string" ? error.error : "队列请求失败",
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

export function getQueueSnapshot(): Promise<BackendQueueSnapshot> {
  return requestJson<BackendQueueSnapshot>("/operations/queue");
}

export function getAnnotationOperations(input: {
  view: AnnotationOperationsView;
  page: number;
  pageSize?: number;
  includeSummary: boolean;
}): Promise<BackendAnnotationOperations> {
  const parameters = new URLSearchParams({
    view: input.view,
    page: String(input.page),
    pageSize: String(input.pageSize ?? 50),
    includeSummary: String(input.includeSummary),
  });
  return requestJson<BackendAnnotationOperations>(
    `/operations/annotation-runs?${parameters.toString()}`,
  );
}

export function getOperationsStatus(): Promise<BackendOperationsStatus> {
  return requestJson<BackendOperationsStatus>("/operations/status");
}

export function reclaimWorkerTimeouts(): Promise<BackendWorkerReclaimResult> {
  return requestJson<BackendWorkerReclaimResult>(
    "/operations/workers/reclaim-timeouts",
    { method: "POST" },
  );
}

export function pruneInactiveWorkers(): Promise<{ removed: number }> {
  return requestJson<{ removed: number }>(
    "/operations/workers/prune-inactive",
    { method: "POST" },
  );
}
