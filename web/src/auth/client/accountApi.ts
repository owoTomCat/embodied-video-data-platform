import type { AccountStatus } from "../../domain/types";
import type {
  AccountAuditLog,
  AccountAuditListResult,
  AccountPublic,
  CreateTeamInput,
  SearchAccountAuditInput,
  TeamPublic,
  CreateAccountInput,
  UpdateTeamInput,
  UpdateAccountInput,
} from "../contracts";

export class AccountApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AccountApiError";
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
    throw new AccountApiError(
      response.status,
      typeof errorPayload.error === "string"
        ? errorPayload.error
        : "操作失败，请稍后重试",
      typeof errorPayload.code === "string"
        ? errorPayload.code
        : undefined,
    );
  }

  return payload as T;
}

export function login(
  username: string,
  password: string,
): Promise<{ user: AccountPublic; homePath: string }> {
  return requestJson("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function logout(): Promise<void> {
  return requestJson("/auth/logout", {
    method: "POST",
  });
}

export function changeOwnPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  return requestJson("/accounts/me/change-password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function listAccounts(): Promise<AccountPublic[]> {
  const result = await requestJson<{ accounts: AccountPublic[] }>(
    "/accounts",
  );
  return result.accounts;
}

export async function listTeams(): Promise<TeamPublic[]> {
  const result = await requestJson<{ teams: TeamPublic[] }>("/teams");
  return result.teams;
}

export async function createTeam(
  input: CreateTeamInput,
): Promise<TeamPublic> {
  const result = await requestJson<{ team: TeamPublic }>("/teams", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.team;
}

export async function updateTeam(
  id: string,
  input: UpdateTeamInput,
): Promise<TeamPublic> {
  const result = await requestJson<{ team: TeamPublic }>(
    `/teams/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return result.team;
}

export async function assignTeamLeader(
  id: string,
  accountId: string,
): Promise<AccountPublic[]> {
  const result = await requestJson<{ accounts: AccountPublic[] }>(
    `/teams/${encodeURIComponent(id)}/leader`,
    {
      method: "PATCH",
      body: JSON.stringify({ accountId }),
    },
  );
  return result.accounts;
}

export async function createAccount(
    input: CreateAccountInput,
): Promise<AccountPublic> {
  const result = await requestJson<{ account: AccountPublic }>(
    "/accounts",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return result.account;
}

export async function updateAccount(
  id: string,
  input: UpdateAccountInput,
): Promise<AccountPublic> {
  const result = await requestJson<{ account: AccountPublic }>(
    `/accounts/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return result.account;
}

export async function updateOwnAccount(input: {
  phone?: string;
}): Promise<AccountPublic> {
  const result = await requestJson<{ account: AccountPublic }>(
    "/accounts/me",
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
  return result.account;
}

export function resetAccountPassword(
  id: string,
  password: string,
): Promise<{ reauthenticate: boolean }> {
  return requestJson(
    `/accounts/${encodeURIComponent(id)}/reset-password`,
    {
      method: "POST",
      body: JSON.stringify({ password }),
    },
  );
}

export async function setAccountStatus(
  id: string,
  status: AccountStatus,
): Promise<AccountPublic> {
  const result = await requestJson<{ account: AccountPublic }>(
    `/accounts/${encodeURIComponent(id)}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  );
  return result.account;
}

export function deleteAccount(id: string): Promise<void> {
  return requestJson(`/accounts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function listAccountAudit(): Promise<AccountAuditLog[]> {
  const result = await searchAccountAudit();
  return result.logs;
}

function buildAuditSearchParams(
  input: SearchAccountAuditInput = {},
  options: { includePagination?: boolean } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  const appendText = (key: string, value?: string) => {
    const normalized = value?.trim();
    if (normalized) params.set(key, normalized);
  };
  appendText("q", input.q);
  appendText("actor", input.actor);
  if (input.action && input.action !== "all") {
    appendText("action", input.action);
  }
  appendText("from", input.from);
  appendText("to", input.to);
  if (options.includePagination !== false && input.page !== undefined) {
    params.set("page", String(input.page));
  }
  if (options.includePagination !== false && input.pageSize !== undefined) {
    params.set("pageSize", String(input.pageSize));
  }
  return params;
}

export function accountAuditExportUrl(
  input: SearchAccountAuditInput = {},
): string {
  const params = buildAuditSearchParams(input, { includePagination: false });
  const suffix = params.toString();
  return apiUrl(`/audit-logs/export.csv${suffix ? `?${suffix}` : ""}`);
}

export async function searchAccountAudit(
  input: SearchAccountAuditInput = {},
): Promise<AccountAuditListResult> {
  const params = buildAuditSearchParams(input);
  const suffix = params.toString();
  const result = await requestJson<{
    logs: AccountAuditLog[];
    pagination?: AccountAuditListResult["pagination"];
  }>(`/audit-logs${suffix ? `?${suffix}` : ""}`);
  return {
    logs: result.logs,
    pagination:
      result.pagination ?? {
        page: input.page ?? 1,
        pageSize: input.pageSize ?? result.logs.length,
        total: result.logs.length,
        totalPages: 1,
      },
  };
}
