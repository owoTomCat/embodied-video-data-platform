/**
 * 云账户接口请求/响应类型与端点常量。
 *
 * 字段名编号与云账户开放平台文档一致（请求参数名），便于对照接入。
 */

export const YZH_ENDPOINTS = {
  /** 支付宝实时支付 */
  alipayOrder: "/api/payment/v1/order-alipay",
  /** 微信实时支付 */
  wxpayOrder: "/api/payment/v1/order-wxpay",
  /** H5 签约·预申请签约 */
  h5Presign: "/api/sdk/v1/presign",
  /** H5 签约·申请签约（取 H5 页面） */
  h5Sign: "/api/sdk/v1/sign/h5",
  /** H5 签约·获取劳动者签约状态 */
  signStatus: "/api/sdk/v1/sign/user/status",
  /** H5 签约·申请解约 */
  h5Release: "/api/sdk/v1/release/h5",
} as const;

export type PayoutChannel = "alipay" | "wxpay";

/** 打款到用户支付宝/微信时都要有的公共溯源信息（报税用，必填）。 */
export type PayoutTrailingFields = {
  /** 收入来源互联网平台名称（最大 48 字符） */
  dealer_platform_name: string;
  /** 用户在平台内的名称/昵称（最大 48 字符） */
  dealer_user_nickname: string;
  /** 用户在平台内的唯一、长期、可追溯标识码（最大 80 字符） */
  dealer_user_id: string;
};

export type CreateAlipayOrderRequest = PayoutTrailingFields & {
  order_id: string;
  dealer_id: string;
  broker_id: string;
  real_name: string;
  /** 支付宝账号：user_id(2088…) 或 logon_id（邮箱/手机号） */
  card_no: string;
  id_card: string;
  phone_no: string;
  /** 金额，单位元，最多两位小数 */
  pay: string;
  pay_remark?: string;
  order_title?: string;
  /** 固定值 Check：校验支付宝姓名 */
  check_name?: string;
  notify_url?: string;
  project_id?: string;
};

export type CreateWxpayOrderRequest = PayoutTrailingFields & {
  order_id: string;
  dealer_id: string;
  broker_id: string;
  real_name: string;
  id_card: string;
  /** 平台企业微信应用 AppID 下用户的 OpenID */
  openid: string;
  phone_no: string;
  pay: string;
  pay_remark?: string;
  notify_url?: string;
  /** 若配置多个 AppID，指定支付对应的 AppID */
  wx_app_id?: string;
  /** 固定值 transfer */
  wxpay_mode?: string;
  project_id?: string;
};

export type PayoutOrderResponse = {
  order_id: string;
  /** 综合服务平台流水号 */
  ref: string;
  pay: string;
};

export type H5PresignRequest = {
  dealer_id: string;
  broker_id: string;
  real_name: string;
  id_card: string;
  /** 证件类型编码，默认 0=身份证 */
  certificate_type: number;
  /** 0：不收集手机号（默认）；1：收集 */
  collect_phone_no?: number;
};

export type H5PresignResponse = {
  /** H5 签约 token（2 小时有效） */
  token: string;
  /** 0 未签约 / 1 已签约 / 2 已解约 */
  status: number;
};

export type H5SignRequest = {
  token: string;
  color?: string;
  /** 签约完成回调地址 */
  url?: string;
  /** 签订后跳转 URL */
  redirect_url?: string;
  /** 签约事件状态回调地址 */
  event_callback_url?: string;
};

export type H5SignResponse = {
  url: string;
};

export type SignStatusRequest = {
  dealer_id: string;
  broker_id: string;
  real_name: string;
  id_card: string;
};

export type SignStatusResponse = {
  /** 0 未签约 / 1 已签约 / 2 已解约 */
  status: number;
};

/** 云账户回调通知的加密外壳（请求体字段）。 */
export type YzhNotifyEnvelope = {
  data: string;
  mess: string;
  timestamp: string;
  sign: string;
  sign_type?: string;
};

/** 支付结果回调（解密后）：外层 notify_id/notify_time + 嵌套 data。 */
export type PaymentResultNotify = {
  notify_id: string;
  notify_time: string;
  data: {
    order_id: string;
    pay: string;
    broker_id: string;
    dealer_id: string;
    real_name: string;
    card_no: string;
    id_card: string;
    phone_no: string;
    /** 订单状态码，见《订单状态码》：1 已支付 / 2 失败 / 4 挂单 / 9 退汇 / 15 取消 / -1 已无效 */
    status: string;
    status_detail: string;
    status_message: string;
    status_detail_message: string;
    withdraw_platform: string;
    ref: string;
    project_id?: string;
    finished_time?: string;
    [key: string]: unknown;
  };
};

/** 签约结果回调（解密后）：外层 + 嵌套 data。 */
export type SignResultNotify = {
  notify_id: string;
  notify_time: string;
  data: {
    dealer_id: string;
    real_name: string;
    id_card: string;
    /** 签约状态：0 未签约 / 1 已签约 / 2 已解约 */
    status: number;
    [key: string]: unknown;
  };
};
