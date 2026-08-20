import type {
  AdjustPointCycleItemInput,
  BackendPointCycle,
  BackendPointCyclePreview,
  BackendPointRule,
  CreatePointRuleInput,
} from "../contracts";

export class PointCycleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PointCycleApiError";
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
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = payload as { code?: unknown; error?: unknown };
    throw new PointCycleApiError(
      response.status,
      typeof error.error === "string" ? error.error : "积分周期请求失败",
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

export async function listPointCycles(): Promise<BackendPointCycle[]> {
  const result = await requestJson<{ cycles: BackendPointCycle[] }>(
    "/point-cycles",
  );
  return result.cycles;
}

export async function previewPointCycle(): Promise<BackendPointCyclePreview> {
  const result = await requestJson<{ preview: BackendPointCyclePreview }>(
    "/point-cycles/preview",
  );
  return result.preview;
}

export async function createPointCycle(
  businessDate?: string,
): Promise<BackendPointCycle> {
  const result = await requestJson<{ cycle: BackendPointCycle }>(
    "/point-cycles",
    {
      method: "POST",
      body: JSON.stringify(
        businessDate === undefined ? {} : { businessDate },
      ),
    },
  );
  return result.cycle;
}

export function pointCycleExportUrl(id: string): string {
  return apiUrl(`/point-cycles/${encodeURIComponent(id)}/export.csv`);
}

export async function getPointRule(): Promise<BackendPointRule> {
  const result = await requestJson<{ rule: BackendPointRule }>(
    "/point-cycles/rule",
  );
  return result.rule;
}

export async function createPointRule(
  input: CreatePointRuleInput,
): Promise<BackendPointRule> {
  const result = await requestJson<{ rule: BackendPointRule }>(
    "/point-cycles/rule",
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return result.rule;
}

export async function adjustPointCycleItem(
  cycleId: string,
  itemId: string,
  input: AdjustPointCycleItemInput,
): Promise<BackendPointCycle> {
  const result = await requestJson<{ cycle: BackendPointCycle }>(
    `/point-cycles/${encodeURIComponent(cycleId)}/items/${encodeURIComponent(itemId)}/adjust`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.cycle;
}
