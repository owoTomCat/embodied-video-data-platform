import { randomUUID } from "node:crypto";

import {
  des3Encrypt,
  rsaSign,
} from "./yzh.crypto.js";
import type { YzhConfig } from "./yzh.config.js";

type Fetcher = typeof fetch;

type YzhEnvelope<T> = {
  code: string;
  message: string;
  requestId: string | null;
  data: T | null;
};

export class YzhTransportError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "YzhTransportError";
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function randomMess(): string {
  return Math.random().toString(36).slice(2, 12);
}

function redact(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
    .slice(0, 400);
}

/**
 * 云账户 REST 客户端：负责 3DES 加密 data、RSA 签名，并组装 Headers/Body。
 *
 * 请求约定（接口概述）：
 * - Headers：dealer-id、request-id；
 * - POST：application/x-www-form-urlencoded，body= form 编码的 data/mess/timestamp/sign/sign_type；
 * - GET：上述参数放 Query 并 URL-Encode。
 */
export class YzhHttpClient {
  private readonly config: YzhConfig;
  private readonly fetcher: Fetcher;

  constructor(config: YzhConfig, fetcher: Fetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  private ensureConfigured(): void {
    const { dealerId, brokerId, appKey, des3Key, privateKey, yzhPublicKey } =
      this.config;
    if (!dealerId || !brokerId || !appKey || !des3Key || !privateKey || !yzhPublicKey) {
      throw new YzhTransportError(
        "[yunzhanghu] 云账户凭证未配置（YZH_DEALER_ID/YZH_BROKER_ID/YZH_APP_KEY/YZH_3DES_KEY/YZH_PRIVATE_KEY/YZH_PUBLIC_KEY），无法发起真实请求，请先完成云账户对接准备",
        null,
        null,
      );
    }
  }

  private signedFields(params: Record<string, unknown>): {
    data: string;
    mess: string;
    timestamp: string;
    sign: string;
    signType: string;
  } {
    const data = des3Encrypt(JSON.stringify(params), this.config.des3Key);
    const mess = randomMess();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const sign = rsaSign(
      data,
      mess,
      timestamp,
      this.config.appKey,
      this.config.privateKey,
    );
    return { data, mess, timestamp, sign, signType: "rsa" };
  }

  /** GET：签名参数放 Query（URL-Encode）。 */
  async get<T>(path: string, params: Record<string, unknown>): Promise<YzhEnvelope<T>> {
    this.ensureConfigured();
    const { data, mess, timestamp, sign, signType } = this.signedFields(params);
    const query = new URLSearchParams({
      data,
      mess,
      timestamp,
      sign,
      sign_type: signType,
    }).toString();
    const url = `${stripTrailingSlash(this.config.baseUrl)}${path}?${query}`;
    const headers: Record<string, string> = {
      "dealer-id": this.config.dealerId,
      "request-id": randomUUID(),
    };
    return this.request<T>(url, { method: "GET", headers });
  }

  /** POST：签名参数放 form-urlencoded body。 */
  async post<T>(path: string, params: Record<string, unknown>): Promise<YzhEnvelope<T>> {
    this.ensureConfigured();
    const { data, mess, timestamp, sign, signType } = this.signedFields(params);
    const body = new URLSearchParams({
      data,
      mess,
      timestamp,
      sign,
      sign_type: signType,
    }).toString();
    const url = `${stripTrailingSlash(this.config.baseUrl)}${path}`;
    const headers: Record<string, string> = {
      "dealer-id": this.config.dealerId,
      "request-id": randomUUID(),
      "Content-Type": "application/x-www-form-urlencoded",
    };
    return this.request<T>(url, { method: "POST", headers, body });
  }

  private async request<T>(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<YzhEnvelope<T>> {
    let response: Response;
    try {
      response = await this.fetcher(url, init);
    } catch (error) {
      throw new YzhTransportError(
        `[yunzhanghu] 网络请求失败：${error instanceof Error ? redact(error.message) : "unknown"}`,
        null,
        null,
      );
    }
    const requestId = response.headers.get("x-request-id");
    let envelope: unknown;
    try {
      envelope = await response.json();
    } catch {
      throw new YzhTransportError(
        `[yunzhanghu] 响应不是合法 JSON（HTTP ${response.status}）：${redact((await response.text().catch(() => "")) || "")}`,
        response.status,
        requestId,
      );
    }
    if (!envelope || typeof envelope !== "object") {
      throw new YzhTransportError(
        "[yunzhanghu] 响应结构异常",
        response.status,
        requestId,
      );
    }
    const rec = envelope as Record<string, unknown>;
    return {
      code: typeof rec.code === "string" ? rec.code : "",
      message: typeof rec.message === "string" ? rec.message : "",
      requestId:
        (typeof rec.request_id === "string" ? rec.request_id : null) ?? requestId,
      data: (rec.data as T | undefined) ?? null,
    };
  }
}
