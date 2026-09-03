/**
 * 云账户（yunzhanghu）对接配置加载。
 *
 * 所有值来自环境变量（与项目其它模块一致，直接读 process.env）。
 * 骨架阶段默认指向沙箱环境，无需真实凭证即可加载配置；
 * 真正请求前会先做 isYzhConfigured() 校验，缺失时给出明确报错。
 */

export type YzhEnv = "prod" | "sandbox";

/** NestJS 注入 token（YzhConfig 为类型，不能直接用类 token）。 */
export const YZH_CONFIG_TOKEN = Symbol("YzhConfig");

export type YzhConfig = {
  /** 环境：prod=生产，sandbox=沙箱（默认） */
  env: YzhEnv;
  /** 平台企业 ID */
  dealerId: string;
  /** 综合服务主体 ID */
  brokerId: string;
  /** App Key */
  appKey: string;
  /** 3DES Key，用于加密/解密 data */
  des3Key: string;
  /** 平台企业 RSA 私钥（PKCS8 PEM），用于对请求签名 */
  privateKey: string;
  /** 云账户 RSA 公钥，用于验签云账户回调 */
  yzhPublicKey: string;
  /** 基础接口地址（生产或沙箱根地址） */
  baseUrl: string;
  /** 回调地址基准（对外暴露的 HTTPS 根地址，用于拼接 notify_url） */
  callbackBaseUrl: string;
};

const PROD_BASE_URL = "https://api-service.yunzhanghu.com";
const SANDBOX_BASE_URL = "https://api-service.yunzhanghu.com/sandbox";
const DEFAULT_MODEL_BASE_URL = PROD_BASE_URL;

function optional(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function yzhEnv(): YzhEnv {
  const raw = process.env.YZH_ENV?.trim().toLowerCase() ?? "sandbox";
  if (raw !== "prod" && raw !== "sandbox") {
    throw new Error("YZH_ENV 必须是 prod 或 sandbox");
  }
  return raw;
}

export function loadYzhConfig(): YzhConfig {
  const env = yzhEnv();
  const cfgBase = process.env.YZH_BASE_URL?.trim() || DEFAULT_MODEL_BASE_URL;
  const baseUrl = env === "sandbox" ? SANDBOX_BASE_URL : cfgBase;

  return {
    env,
    dealerId: optional("YZH_DEALER_ID"),
    brokerId: optional("YZH_BROKER_ID"),
    appKey: optional("YZH_APP_KEY"),
    des3Key: optional("YZH_3DES_KEY"),
    privateKey: optional("YZH_PRIVATE_KEY"),
    yzhPublicKey: optional("YZH_PUBLIC_KEY"),
    baseUrl: baseUrl.replace(/\/+$/u, ""),
    callbackBaseUrl: optional("YZH_CALLBACK_BASE_URL").replace(/\/+$/u, ""),
  };
}

/** 是否已具备完整凭证（用于在调用方按需提示/降级）。 */
export function isYzhConfigured(): boolean {
  return Boolean(
    process.env.YZH_DEALER_ID?.trim() &&
      process.env.YZH_BROKER_ID?.trim() &&
      process.env.YZH_APP_KEY?.trim() &&
      process.env.YZH_3DES_KEY?.trim() &&
      process.env.YZH_PRIVATE_KEY?.trim() &&
      process.env.YZH_PUBLIC_KEY?.trim(),
  );
}
