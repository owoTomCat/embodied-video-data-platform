import type {
  WalletBalance,
  WalletFlowPoint,
  WalletTeamStat,
  WalletTransaction,
  WithdrawInput,
} from "../contracts";

export class WalletApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "WalletApiError";
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
    headers,
    credentials: "include",
  });
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
    const error = payload as { error?: unknown; code?: unknown };
    throw new WalletApiError(
      response.status,
      typeof error.error === "string" ? error.error : "钱包请求失败",
      typeof error.code === "string" ? error.code : undefined,
    );
  }
  return payload as T;
}

export type WalletDetail = {
  balance: WalletBalance;
  transactions: WalletTransaction[];
};

export async function getMyWallet(): Promise<WalletDetail> {
  return requestJson<WalletDetail>("/wallet/me");
}

export async function listWallets(): Promise<WalletBalance[]> {
  const result = await requestJson<{ wallets: WalletBalance[] }>("/wallet");
  return result.wallets;
}

export async function withdrawWallet(input: WithdrawInput): Promise<WalletBalance> {
  const result = await requestJson<{ balance: WalletBalance }>("/wallet/withdraw", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.balance;
}

/** 指定成员的钱包流水（管理员查看任意成员 / 团长查看本队成员） */
export async function listMemberTransactions(
  ownerId: string,
): Promise<WalletTransaction[]> {
  const result = await requestJson<{ transactions: WalletTransaction[] }>(
    `/wallet/transactions?ownerId=${encodeURIComponent(ownerId)}`,
  );
  return result.transactions;
}

/** 流水统计（日/周/月聚合，管理员） */
export async function getWalletFlowStats(
  bucket: "day" | "week" | "month",
  from?: string,
  to?: string,
): Promise<WalletFlowPoint[]> {
  const params = new URLSearchParams({ bucket });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const result = await requestJson<{ flow: WalletFlowPoint[] }>(
    `/wallet/stats/flow?${params.toString()}`,
  );
  return result.flow;
}

/** 团队流水分布（管理员） */
export async function getWalletTeamStats(
  from?: string,
  to?: string,
): Promise<WalletTeamStat[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const suffix = params.toString();
  const result = await requestJson<{ teams: WalletTeamStat[] }>(
    `/wallet/stats/teams${suffix ? `?${suffix}` : ""}`,
  );
  return result.teams;
}
