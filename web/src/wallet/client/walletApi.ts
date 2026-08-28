import type { WalletBalance, WalletTransaction, WithdrawInput } from "../contracts";

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
