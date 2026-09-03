import { Inject, Injectable } from "@nestjs/common";

import { des3Decrypt, rsaVerify } from "./yzh.crypto.js";
import { YZH_CONFIG_TOKEN, type YzhConfig } from "./yzh.config.js";
import {
  YZH_ENDPOINTS,
  type CreateAlipayOrderRequest,
  type CreateWxpayOrderRequest,
  type H5PresignRequest,
  type H5PresignResponse,
  type H5SignRequest,
  type H5SignResponse,
  type PayoutOrderResponse,
  type SignStatusRequest,
  type SignStatusResponse,
  type YzhNotifyEnvelope,
} from "./yzh.dtos.js";
import { YzhHttpClient } from "./yzh.http-client.js";

export class YzhBusinessError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string | null,
  ) {
    super(message);
    this.name = "YzhBusinessError";
  }
}

/** 幂等已存在：code=2002，应使用原单号查询而非重下。 */
export class YzhDuplicateOrderError extends Error {
  constructor(readonly requestId: string | null) {
    super("该订单已上传过（code=2002），请用原单号调用查询接口确认订单状态");
    this.name = "YzhDuplicateOrderError";
  }
}

export class YzhNotifyVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YzhNotifyVerificationError";
  }
}

@Injectable()
export class YzhClientService {
  constructor(
    private readonly http: YzhHttpClient,
    @Inject(YZH_CONFIG_TOKEN) private readonly config: YzhConfig,
  ) {}

  /** 支付宝实时支付。返回同步接单结果（非最终支付结果）。 */
  async createAlipayOrder(
    params: CreateAlipayOrderRequest,
  ): Promise<PayoutOrderResponse> {
    const resp = await this.http.post<PayoutOrderResponse>(YZH_ENDPOINTS.alipayOrder, params);
    return this.settle(resp);
  }

  /** 微信实时支付。返回同步接单结果（非最终支付结果）。 */
  async createWxpayOrder(
    params: CreateWxpayOrderRequest,
  ): Promise<PayoutOrderResponse> {
    const resp = await this.http.post<PayoutOrderResponse>(YZH_ENDPOINTS.wxpayOrder, params);
    return this.settle(resp);
  }

  /** H5 签约·预申请签约：生成 H5 签约 token。 */
  async h5Presign(params: H5PresignRequest): Promise<H5PresignResponse> {
    const resp = await this.http.post<H5PresignResponse>(YZH_ENDPOINTS.h5Presign, params);
    return this.settle(resp);
  }

  /** H5 签约·申请签约：取 H5 签约页面 URL。 */
  async h5Sign(params: H5SignRequest): Promise<H5SignResponse> {
    const resp = await this.http.get<H5SignResponse>(YZH_ENDPOINTS.h5Sign, params);
    return this.settle(resp);
  }

  /** H5 签约·获取劳动者签约状态。 */
  async getSignStatus(params: SignStatusRequest): Promise<SignStatusResponse> {
    const resp = await this.http.get<SignStatusResponse>(YZH_ENDPOINTS.signStatus, params);
    return this.settle(resp);
  }

  /**
   * 云账户回调验签 + 解密。
   * 用云账户公钥验签、3DES Key 解密；返回解密后的明文 JSON 字符串。
   */
  async verifyAndDecryptNotify(envelope: YzhNotifyEnvelope): Promise<string> {
    const { appKey, des3Key, yzhPublicKey } = this.config;
    if (!appKey || !des3Key || !yzhPublicKey) {
      throw new YzhNotifyVerificationError(
        "[yunzhanghu] 云账户凭证未配置（YZH_APP_KEY/YZH_3DES_KEY/YZH_PUBLIC_KEY），无法校验回调解密，请先完成云账户对接准备",
      );
    }
    const ok = rsaVerify(
      envelope.data,
      envelope.mess,
      envelope.timestamp,
      appKey,
      envelope.sign,
      yzhPublicKey,
    );
    if (!ok) {
      throw new YzhNotifyVerificationError("回调验签未通过");
    }
    try {
      return des3Decrypt(envelope.data, des3Key);
    } catch {
      throw new YzhNotifyVerificationError("回调解密失败");
    }
  }

  private settle<T>(resp: { code: string; message: string; requestId: string | null; data: T | null }): T {
    if (resp.data === null && resp.code === "0000") {
      throw new YzhBusinessError(resp.code, "响应缺少 data", resp.requestId);
    }
    if (resp.code === "0000") return resp.data as T;
    if (resp.code === "2002") throw new YzhDuplicateOrderError(resp.requestId);
    throw new YzhBusinessError(resp.code, resp.message, resp.requestId);
  }
}
