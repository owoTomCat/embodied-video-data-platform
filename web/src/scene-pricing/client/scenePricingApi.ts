import type {
  SceneCategoryPricing,
  UpdateSceneCategoryPriceInput,
} from "../contracts";

export class ScenePricingApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ScenePricingApiError";
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
    throw new ScenePricingApiError(
      response.status,
      typeof error.error === "string" ? error.error : "场景定价请求失败",
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

export async function listSceneCategoryPricing(): Promise<
  SceneCategoryPricing[]
> {
  const result = await requestJson<{
    categories: SceneCategoryPricing[];
  }>("/scene-pricing");
  return result.categories;
}

export async function updateSceneCategoryPrice(
  categoryKey: string,
  input: UpdateSceneCategoryPriceInput,
): Promise<SceneCategoryPricing> {
  const result = await requestJson<{ category: SceneCategoryPricing }>(
    `/scene-pricing/${encodeURIComponent(categoryKey)}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
  return result.category;
}
