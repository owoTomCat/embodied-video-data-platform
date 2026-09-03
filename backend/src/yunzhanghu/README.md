# 云账户（yunzhanghu）接入模块

与云账户综合服务平台对接的「最小闭环」骨架：**H5 签约 + 收款方式绑定 + 实时支付（支付宝/微信）+ 支付结果回调**。

> 状态：**骨架阶段**。代码已可编译，默认指向**沙箱**；所有请求在凭证缺失时会在调用点抛出明确报错（不会带脏数据打真接口）。**尚未接入、也未真实联调**，需先向云账户完成对接准备、取得真实凭证后替换。

## 目录

```
src/yunzhanghu/
├─ yunzhanghu.module.ts    NestJS 模块（装配 config/http/service/controller）
├─ yzh.config.ts          环境变量 -> 配置（YZH_*），默认 sandbox
├─ yzh.crypto.ts          3DES（DESede/CBC/PKCS5）+ RSA-SHA256 签名/验签/解密
├─ yzh.http-client.ts     REST 客户端：加密 data、签名、组装 Headers/Body、解析响应
├─ yzh.dtos.ts            请求/响应 DTO + 端点常量
├─ yzh-client.service.ts  友好封装：建单/签到/查状态/回调解密
└─ yzh-callback.controller.ts  异步回调接收端（验签+解密+落库+返回 success）
```

对应数据库表（由 `202609090001-yunzhanghu.ts` 创建）：
- `collector_payout_accounts` 数采人员收款档案（支付宝 user_id / 微信 openid）
- `yzh_payout_orders` 打款订单本地快照
- `yzh_callback_logs` 异步回调流水

## 环境变量

在 `.env`（参考 `.env.example`）配置：

| 变量 | 说明 |
|---|---|
| `YZH_ENV` | `sandbox`（默认）或 `prod`；sandbox 基础地址自动为 `https://api-service.yunzhanghu.com/sandbox` |
| `YZH_DEALER_ID` | 平台企业 ID |
| `YZH_BROKER_ID` | 综合服务主体 ID |
| `YZH_APP_KEY` | App Key |
| `YZH_3DES_KEY` | 3DES Key |
| `YZH_PRIVATE_KEY` | 平台企业 RSA 私钥（PKCS8 PEM；对应公钥需配置到云账户平台） |
| `YZH_PUBLIC_KEY` | 云账户公钥（验签回调） |
| `YZH_BASE_URL` | 可选，prod 环境覆盖基础地址 |
| `YZH_CALLBACK_BASE_URL` | 可选，公网 HTTPS 根地址，用于拼 `notify_url` |

## 已接入的接口（封装在 `yzh-client.service.ts`）

| 方法 | 云账户端点 |
|---|---|
| `createAlipayOrder` | `POST /api/payment/v1/order-alipay`（支付宝实时支付） |
| `createWxpayOrder` | `POST /api/payment/v1/order-wxpay`（微信实时支付） |
| `h5Presign` | `POST /api/sdk/v1/presign`（预申请签约，取 token） |
| `h5Sign` | `GET /api/sdk/v1/sign/h5`（取 H5 签约页 URL） |
| `getSignStatus` | `GET /api/sdk/v1/sign/user/status`（查签约状态） |

## 回调端点（公开，验签+解密）

| 路径 | 说明 |
|---|---|
| `POST /api/v1/yunzhanghu/callback/payment` | 单笔支付结果回调 |
| `POST /api/v1/yunzhanghu/callback/sign` | H5 签约结果回调 |

成功返回纯文本 `success`（否则云账户 25h 内重发至多 8 次）。

## 关键契约提醒（务必遵守）

- **`code=0000` ≠ 支付成功**：云账户「同步接单、异步支付」。`0000` 仅表示已受理，最终状态以回调 `status` 为准。
- **`code=2002`**：该单已上传过，用原 `order_id` 调**查询接口**确认，避免重复出款。
- **`status=4`（挂单）为中间态**：余额不足/风控/通道维护/未签约等，满足条件自动重试，勿当失败重下，避免重复出款。
- 银行卡路径还有**退汇 `status=9`**（先成功后失败），支付宝/微信为终态、无退汇。
- 支付单需填 `dealer_platform_name / dealer_user_nickname / dealer_user_id`（报税用，必填）。

## Todo（接入期待办）

1. **真实凭证**：从云账户【业务中心→业务管理→对接信息】取得并填入 `YZH_*`（可先用 30 天沙箱测试账号）。
2. **回调 IP 白名单**：按云账户文档列出的来源 IP，在前置网关/Nginx 放行（第二道防线）。
3. **收款方式绑定**：支付宝授权登录（拿 `user_id`）、微信开放平台授权（拿 `openid`）——需各自开放平台 AppID/AppSecret，且微信 AppID 需与云账户微信商户号(MCHID) 绑定。
4. **业务状态处理**：回调中按 status 更新 `yzh_payout_orders`、处理挂单/退汇、幂等（同一 `notify_id` 只处理一次）。
5. **钱包提现接线**：把现有 `wallet.withdraw` 接到 `createAlipayOrder/createWxpayOrder`。
6. 若改用官方 `@yunzhanghu/sdk-nodejs`，可仅替换 `yzh.http-client.ts` 与 `yzh.crypto.ts` 的实现，业务层不变。
