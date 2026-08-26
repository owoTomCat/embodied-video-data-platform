import type {
  ActiveUploadResult,
  BackendSubmissionPreview,
  BackendSubmission,
  BackendSubmissionListResult,
  BackendSubmissionTaskStat,
  ClearDuplicateCandidateInput,
  CreateUploadResult,
  DeleteSubmissionInput,
  DeleteSubmissionResult,
  PresignedPart,
  RenameSubmissionInput,
  RerunAiQualityInput,
  ReviewSubmissionQualityInput,
  SubmissionUploadApi,
} from "../contracts";

export class SubmissionApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SubmissionApiError";
  }
}

function apiUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:4000/api/v1";
  return `${base.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`;
}

function publicApiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//u.test(pathOrUrl)) return pathOrUrl;
  const base =
    process.env.NEXT_PUBLIC_API_BASE_URL ??
    "http://localhost:4000/api/v1";
  const normalizedBase = base.replace(/\/$/u, "");
  if (pathOrUrl.startsWith("/api/v1/")) {
    return `${normalizedBase.replace(/\/api\/v1$/u, "")}${pathOrUrl}`;
  }
  return apiUrl(pathOrUrl);
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
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const error = payload as {
      code?: unknown;
      error?: unknown;
      message?: unknown;
    };
    const validationMessage = Array.isArray(error.message)
      ? error.message.filter((item): item is string => typeof item === "string").join("；")
      : typeof error.message === "string"
        ? error.message
        : undefined;
    const publicMessage =
      validationMessage ||
      (typeof error.error === "string" && error.error !== "Bad Request"
        ? error.error
        : "视频请求失败");
    throw new SubmissionApiError(
      response.status,
      publicMessage,
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

export const submissionUploadApi: SubmissionUploadApi = {
  createUpload(input) {
    return requestJson<CreateUploadResult>("/submissions/uploads", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  async presignParts(id, partNumbers) {
    const result = await requestJson<{ parts: PresignedPart[] }>(
      `/submissions/${encodeURIComponent(id)}/uploads/parts`,
      {
        method: "POST",
        body: JSON.stringify({ partNumbers }),
      },
    );
    return result.parts.map((part) => ({
      ...part,
      expiresAt:
        typeof part.expiresAt === "number"
          ? part.expiresAt
          : Date.parse(String(part.expiresAt)),
    }));
  },

  verifyResumeUpload(id, input) {
    return requestJson<ActiveUploadResult>(
      `/submissions/${encodeURIComponent(id)}/uploads/resume`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  },

  async completeUpload(id, parts) {
    const result = await requestJson<{ submission: BackendSubmission }>(
      `/submissions/${encodeURIComponent(id)}/uploads/complete`,
      {
        method: "POST",
        body: JSON.stringify({ parts }),
      },
    );
    return result.submission;
  },

  abortUpload(id) {
    return requestJson<void>(
      `/submissions/${encodeURIComponent(id)}/uploads`,
      { method: "DELETE" },
    );
  },
};

export async function listActiveUploads(): Promise<ActiveUploadResult[]> {
  const result = await requestJson<{ uploads: ActiveUploadResult[] }>(
    "/submissions/uploads/active",
  );
  return result.uploads;
}

/** 任务维度统计（范围与当前角色可见的提交列表一致） */
export async function fetchTaskStats(): Promise<BackendSubmissionTaskStat[]> {
  const result = await requestJson<{ stats: BackendSubmissionTaskStat[] }>(
    "/submissions/task-stats",
  );
  return result.stats;
}

export async function listSubmissions(): Promise<BackendSubmission[]> {
  const result = await requestJson<{ submissions: BackendSubmission[] }>(
    "/submissions",
  );
  return result.submissions;
}

export type SearchSubmissionsInput = {
  q?: string;
  status?: string;
  taskId?: string;
  page?: number;
  pageSize?: number;
  includeThumbnails?: boolean;
};

export type LoadAllSubmissionsInput = Omit<
  SearchSubmissionsInput,
  "page" | "pageSize"
>;

const FULL_LIST_PAGE_SIZE = 100;
const FULL_LIST_MAX_SUBMISSIONS = 50_000;
const FULL_LIST_CONCURRENCY = 4;
const FULL_LIST_MAX_ATTEMPTS = 3;

class SubmissionListChangedError extends Error {}

function buildSubmissionSearchParams(
  input: SearchSubmissionsInput = {},
  options: { includePagination?: boolean } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (input.q?.trim()) params.set("q", input.q.trim());
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.taskId && input.taskId !== "all") params.set("taskId", input.taskId);
  if (input.includeThumbnails) params.set("includeThumbnails", "1");
  if (options.includePagination !== false && input.page !== undefined) {
    params.set("page", String(input.page));
  }
  if (options.includePagination !== false && input.pageSize !== undefined) {
    params.set("pageSize", String(input.pageSize));
  }
  return params;
}

export function submissionsExportUrl(input: SearchSubmissionsInput = {}): string {
  const params = buildSubmissionSearchParams(input, {
    includePagination: false,
  });
  const suffix = params.toString();
  return apiUrl(`/submissions/export.csv${suffix ? `?${suffix}` : ""}`);
}

export async function searchSubmissions(
  input: SearchSubmissionsInput,
): Promise<BackendSubmissionListResult> {
  const params = buildSubmissionSearchParams(input);
  const suffix = params.toString();
  const result = await requestJson<{
    submissions: BackendSubmission[];
    pagination?: BackendSubmissionListResult["pagination"];
    taskSources?: BackendSubmissionListResult["taskSources"];
  }>(`/submissions${suffix ? `?${suffix}` : ""}`);
  return {
    submissions: result.submissions,
    pagination:
      result.pagination ?? {
        page: input.page ?? 1,
        pageSize: result.submissions.length,
        total: result.submissions.length,
        totalPages: 1,
      },
    taskSources: result.taskSources ?? [],
  };
}

function validateFullListPage(
  result: BackendSubmissionListResult,
  requestedPage: number,
): void {
  const { page, pageSize, total, totalPages } = result.pagination;
  if (
    page !== requestedPage ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > FULL_LIST_PAGE_SIZE ||
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(totalPages) ||
    totalPages < 1
  ) {
    throw new SubmissionApiError(502, "视频分页信息无效，请稍后重试");
  }
  if (total > FULL_LIST_MAX_SUBMISSIONS) {
    throw new SubmissionApiError(
      413,
      `当前可见视频超过 ${FULL_LIST_MAX_SUBMISSIONS} 条，无法在浏览器内安全汇总`,
      "FULL_LIST_LIMIT_EXCEEDED",
    );
  }
}

async function loadSubmissionPageSet(
  input: LoadAllSubmissionsInput,
): Promise<BackendSubmission[]> {
  const first = await searchSubmissions({
    ...input,
    page: 1,
    pageSize: FULL_LIST_PAGE_SIZE,
  });
  validateFullListPage(first, 1);

  const { pageSize, total, totalPages } = first.pagination;
  const expectedTotalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages !== expectedTotalPages) {
    throw new SubmissionListChangedError();
  }

  const pages: BackendSubmission[][] = [first.submissions];
  for (
    let firstPage = 2;
    firstPage <= expectedTotalPages;
    firstPage += FULL_LIST_CONCURRENCY
  ) {
    const pageNumbers = Array.from(
      {
        length: Math.min(
          FULL_LIST_CONCURRENCY,
          expectedTotalPages - firstPage + 1,
        ),
      },
      (_, index) => firstPage + index,
    );
    const results = await Promise.all(
      pageNumbers.map((page) =>
        searchSubmissions({
          ...input,
          page,
          pageSize: FULL_LIST_PAGE_SIZE,
        }),
      ),
    );
    for (const [index, result] of results.entries()) {
      const requestedPage = pageNumbers[index]!;
      validateFullListPage(result, requestedPage);
      if (
        result.pagination.pageSize !== pageSize ||
        result.pagination.total !== total ||
        result.pagination.totalPages !== totalPages
      ) {
        throw new SubmissionListChangedError();
      }
      pages.push(result.submissions);
    }
  }

  const submissions = pages.flat();
  const uniqueIds = new Set(submissions.map((submission) => submission.id));
  if (submissions.length !== total || uniqueIds.size !== total) {
    throw new SubmissionListChangedError();
  }
  return submissions;
}

/**
 * Loads a complete role-scoped result set for client-side metrics.
 *
 * Detectable membership changes (totals, page counts, missing or duplicate
 * IDs) are retried. This is a bounded full-pagination reader, not a database
 * transaction snapshot; it always fails instead of returning a partial list.
 */
export async function loadAllSubmissions(
  input: LoadAllSubmissionsInput = {},
): Promise<BackendSubmission[]> {
  for (let attempt = 0; attempt < FULL_LIST_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await loadSubmissionPageSet(input);
    } catch (error) {
      if (!(error instanceof SubmissionListChangedError)) throw error;
    }
  }
  throw new SubmissionApiError(
    409,
    "视频列表在分页读取期间持续变化，请稍后重试",
    "FULL_LIST_CHANGED",
  );
}

export async function getSubmission(id: string): Promise<BackendSubmission> {
  const result = await requestJson<{ submission: BackendSubmission }>(
    `/submissions/${encodeURIComponent(id)}`,
  );
  return result.submission;
}

export async function reviewSubmissionQuality(
  id: string,
  input: ReviewSubmissionQualityInput,
): Promise<BackendSubmission> {
  const result = await requestJson<{ submission: BackendSubmission }>(
    `/submissions/${encodeURIComponent(id)}/quality-review`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return result.submission;
}

export async function rerunAiQuality(
  id: string,
  input: RerunAiQualityInput,
): Promise<BackendSubmission> {
  const result = await requestJson<{ submission: BackendSubmission }>(
    `/submissions/${encodeURIComponent(id)}/quality-rerun`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.submission;
}

export async function renameSubmission(
  id: string,
  input: RenameSubmissionInput,
): Promise<BackendSubmission> {
  const result = await requestJson<{ submission: BackendSubmission }>(
    `/submissions/${encodeURIComponent(id)}/name`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return result.submission;
}

export async function deleteSubmission(
  id: string,
  input: DeleteSubmissionInput,
): Promise<DeleteSubmissionResult> {
  return await requestJson<DeleteSubmissionResult>(
    `/submissions/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      body: JSON.stringify(input),
    },
  );
}

export async function clearDuplicateCandidate(
  id: string,
  candidateId: string,
  input: ClearDuplicateCandidateInput,
): Promise<BackendSubmission> {
  const result = await requestJson<{ submission: BackendSubmission }>(
    `/submissions/${encodeURIComponent(id)}/duplicate-candidates/${encodeURIComponent(candidateId)}/clear`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.submission;
}

export async function getSubmissionPreview(
  id: string,
): Promise<BackendSubmissionPreview> {
  const result = await requestJson<{ preview: BackendSubmissionPreview }>(
    `/submissions/${encodeURIComponent(id)}/preview`,
  );
  return {
    ...result.preview,
    hls: result.preview.hls
      ? { ...result.preview.hls, url: publicApiUrl(result.preview.hls.url) }
      : undefined,
  };
}
