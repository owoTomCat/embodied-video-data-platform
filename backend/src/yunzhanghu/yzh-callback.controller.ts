import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Res,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsOptional, IsString, MaxLength } from "class-validator";
import type { Response } from "express";
import { Repository } from "typeorm";

import {
  YzhCallbackLogEntity,
  type YzhCallbackKind,
} from "../database/entities/yzh-callback-log.entity.js";
import {
  YzhNotifyVerificationError,
  YzhClientService,
} from "./yzh-client.service.js";
import type { PaymentResultNotify, SignResultNotify } from "./yzh.dtos.js";

export class YzhNotifyBodyDto {
  @IsString()
  @MaxLength(200_000)
  data!: string;

  @IsString()
  @MaxLength(128)
  mess!: string;

  @IsString()
  @MaxLength(32)
  timestamp!: string;

  @IsString()
  @MaxLength(4_096)
  sign!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  sign_type?: string;
}

/**
 * 云账户异步回调接收端（公开，无登录态）。
 *
 * 安全依赖：验签（云账户公钥）+ 3DES 解密；建议部署时再按文档中的
 * 「回调来源 IP 白名单」在前置网关或 Nginx 层放行，做第二道防线。
 *
 * 契约：验签解密成功后必须返回字符串 "success"，否则云账户会不断重发（25h 内最多 8 次）。
 */
@Controller("yunzhanghu/callback")
export class YzhCallbackController {
  private readonly logger = new Logger(YzhCallbackController.name);

  constructor(
    private readonly yzh: YzhClientService,
    @InjectRepository(YzhCallbackLogEntity)
    private readonly callbackLogs: Repository<YzhCallbackLogEntity>,
  ) {}

  /** 单笔支付结果回调。 */
  @Post("payment")
  @HttpCode(200)
  async paymentNotify(
    @Body() body: YzhNotifyBodyDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.handle<PaymentResultNotify>(
      "payment",
      body,
      res,
      (payload, notifyId) => {
        const status = payload?.data?.status;
        this.logger.log(
          `[yunzhanghu] 支付结果回调 order_id=${payload?.data?.order_id} status=${status}`,
        );
        // TODO(接入)：
        //  - 判订单状态（1 已支付 / 2 失败 / 4 挂单 / 9 退汇 / 15 取消 / -1 已无效）
        //  - 更新本地 yzh_payout_orders.status
        //  - 处理挂单（status=4，中间态，勿重复出款）与银行卡退汇
        //  - 幂等：同一 notify_id 只处理一次
        // 返回 status_code 用于落库记录
        return { notifyId: payload?.notify_id ?? notifyId, statusCode: String(status ?? "") };
      },
    );
  }

  /** H5 签约结果回调。 */
  @Post("sign")
  @HttpCode(200)
  async signNotify(
    @Body() body: YzhNotifyBodyDto,
    @Res() res: Response,
  ): Promise<void> {
    await this.handle<SignResultNotify>(
      "sign",
      body,
      res,
      (payload, notifyId) => {
        const status = payload?.data?.status;
        this.logger.log(
          `[yunzhanghu] 签约结果回调 real_name=${payload?.data?.real_name} status=${status}`,
        );
        // TODO(接入)：更新本地签约状态 / 触发后续绑定
        return { notifyId: payload?.notify_id ?? notifyId, statusCode: status === null || status === undefined ? null : String(status) };
      },
    );
  }

  /** 通用处理：验签 + 解密 → 落回调流水 → 返回 success。 */
  private async handle<T>(
    kind: YzhCallbackKind,
    body: YzhNotifyBodyDto,
    res: Response,
    onDecoded: (payload: T | null, notifyId: string | null) => {
      notifyId: string | null;
      statusCode: string | null;
    },
  ): Promise<void> {
    let payload: T | null = null;
    let notifyId: string | null = null;
    let ok = false;
    let errorMessage: string | null = null;
    let statusCode: string | null = null;
    try {
      const plaintext = await this.yzh.verifyAndDecryptNotify(body);
      payload = JSON.parse(plaintext) as T;
      notifyId = (payload as { notify_id?: string } | null)?.notify_id ?? null;
      const decoded = onDecoded(payload, notifyId);
      notifyId = decoded.notifyId ?? notifyId;
      statusCode = decoded.statusCode;
      ok = true;
    } catch (error) {
      ok = false;
      errorMessage =
        error instanceof Error ? error.message : "unknown";
      this.logger.warn(
        `[yunzhanghu] 回调处理失败 kind=${kind} error=${errorMessage}`,
      );
    }
    try {
      await this.callbackLogs.save(
        this.callbackLogs.create({
          id: `YZH-CB-${randomUUID().slice(0, 12)}`,
          kind,
          notifyId,
          payload: payload ? JSON.stringify(payload) : null,
          statusCode,
          ok,
          errorMessage,
        }),
      );
    } catch (error) {
      this.logger.error(
        `[yunzhanghu] 回调流水落库失败：${error instanceof Error ? error.message : "unknown"}`,
      );
    }
    if (!ok) {
      // 未返回 success，云账户会重发。返回非 success 响应。
      res.set("Content-Type", "text/plain").status(500).send("verify failed");
      return;
    }
    res.set("Content-Type", "text/plain").send("success");
  }
}
