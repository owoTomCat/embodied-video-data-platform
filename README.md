# Embodied Video Data Platform

一个面向具身智能视频数据生产的本地平台框架，覆盖公开官网、账号密码登录、数采人员、团长和平台管理员四类界面。

当前版本保留了原有 Web 界面，账号、登录会话、团队权限、账户审计、视频上传、AI 质检、人工复核写回、积分周期锁定和交付包均已迁移到本地 NestJS + PostgreSQL 后端。视频文件由浏览器分片直传 MinIO，经 RabbitMQ 先后进入独立媒体进程和 AI 质检进程；媒体进程使用 FFprobe/FFmpeg 提取证据，AI 进程使用 Qwen3.7 完成初检、条件复核和服务端规则复算。平台内不再提供真实提现流程。

平台采用「采集任务」组织模式：管理员在线发布采集任务（限定场景 + 任务要求），数采人员先在任务大厅选择任务、确认任务要求后按任务提交视频；AI 质检 = 通用提示词框架 + 任务规范化要求（管理员自由填写的要求经 AI 规范化为结构化条目并人工确认后，随提交快照锁定），并按任务定价结算积分。

## 已实现范围

- 采集任务：管理员在线创建任务（标题、说明、场景名称带标签字典补全、自由填写任务要求、按分钟定价），AI 将任务要求规范化为结构化条目（hard/soft + 判定依据）供管理员预览编辑后确认；发布时全新场景自动加入标签字典并生成新版本；任务支持发布/暂停/恢复/关闭，关闭后不可再提交；任务创建、规范化确认、发布、暂停、恢复、关闭全部写入审计。
- 任务化上传：数采人员从任务大厅选择任务，阅读并确认任务要求后上传；上传创建时后端校验任务状态并锁定任务快照（版本、场景、规范化要求、单价），后续任务修改不影响已提交数据的质检与结算；历史无任务提交按无任务模式处理。
- AI 质检 = 通用框架 + 任务要求：质检提示词使用通用框架 v2（`video_qc_v2`），D4 在提供任务要求时按「任务符合度」逐条判定（含场景匹配），未提供时按通用任务真实性判定；服务端按条目复算 D4 并重算总分。仅决定性否决、真正缺失的必要输入、规则冲突或场景不匹配进入人工复核；硬性要求未满足、可选技术指标缺失及证据不足作为 advisory 并由分数表达，不占用复核队列。`task_compliance` 结果展示在质检详情。
- 按任务定价：积分单价优先级为任务快照单价 > 团队单价 > 全局默认积分；积分周期明细与 CSV 导出包含任务快照列。
- 公开官网：平台定位、真实脱敏公开指标、场景能力、生产流程、质量保障和体验入口。
- 数采人员：视频上传、服务端分页的我的数据、质检结果、质检详情、积分明细、采集指南和个人资料。
- 团长：成员管理、团队工作台、团队数据、团队分析、后端只读质检结果和团队积分汇总；团队工作台、团队数据、团队分析、成员指标和团队积分汇总优先使用后端数据，团队数据和成员指标支持 CSV 导出。
- 平台管理员：全平台提交、AI 队列、质量复核、数据资产、用户团队、规则、积分规则、公开配置和审计日志。
- 团队管理：管理员可创建、编辑和启停团队，调整团队单价，跨团队调配账号，并原子更换唯一团长；相关角色变更会撤销旧会话并写入审计。
- 核心规则：角色数据隔离、质量系数、有效时长、质检通过自动入账、次日北京时间 02:00 自动结算及结算前有原因的差额调整留痕。
- 真实视频链路：MP4/MOV 分片上传、暂停/继续、刷新或更换设备后重新选择同一原文件恢复未完成上传、对象大小与 SHA-256 校验、完全重复拦截、可靠消息、媒体元数据、黑屏与冻结片段。
- 上传授权：数采上传前必须确认数据使用权、隐私规范和敏感内容处理要求；后端创建上传任务时再次校验，并记录确认版本和时间。
- 敏感隔离：AI 命中隐私/安全风险或管理员人工复核标记后，视频会进入隔离状态，不再进入普通待结算资产、交付包候选或公开官网统计；解除隔离同样会写入审计。
- 对象治理：新上传对象默认保留 180 天，可通过 `SUBMISSION_OBJECT_RETENTION_DAYS` 调整；资产页待交付资产、最近入库资产、包体积、预览短期链接、交付包下载链接、CSV 清单、zip/tar 归档下载和异步归档任务链接都会写入审计。管理员删除对象时会同步删除原视频、低码率预览、HLS 清单/分片、封面和证据帧，并将提交标记为对象已删除，未到保留期需显式强制删除。
- 视频预览：媒体处理会生成低码率 MP4、HLS 多码率清单和分片、封面图和问题片段证据帧；详情页按权限优先使用 HLS 源，浏览器不支持时回退低码率 MP4，缺失时再回退原视频。
- 数采数据：我的数据、质检结果和提交详情均按当前登录账号从后端读取；质检结果页默认只列已有 AI 终态或待人工复核的提交。
- 团队质检：团长只读质检结果页从后端读取本团队未锁定且质量通过的数据，未通过、敏感隔离和疑似重复待确认数据不会进入普通积分候选。
- 团队工作台和分析：团长首页、团队分析从后端团队提交列表计算近 30 日指标、近 7 日趋势、场景分布、成员贡献、待关注和失败任务，后端不可用时保留演示兜底。
- 积分视图：数采积分明细、团队积分汇总和钱包读取真实入账周期、明细与流水，显示原文件名及下一笔预计可提现时间。
- 管理复核：管理员质量复核页从后端读取复核候选，覆盖质量通过且未入周期的数据，并保留近似重复候选供管理员确认或解除。
- 近似重复：媒体解析后按时长、大小、分辨率和帧率生成近似重复候选及相似度；疑似重复会在提交列表和复核页标记，管理员确认前不入账，误报解除后若满足其他资格即自动入账并写入审计。
- 正式 AI 质检：`qwen3.7-plus` 初检、`qwen3.7-flash` 条件复核、并发 2、三级延迟重试和 PostgreSQL 结果持久化。
- AI 运维：管理员可查看后端队列快照、发布耗时、Worker 心跳、机器信息、当前任务、运行耗时、任务完成/失败数、平均/最近/最长处理耗时和运行过久告警；失败 AI 质检任务可填写原因后重跑，运行超时任务可一键重新排队，并保留审计记录。
- 管理端首页：运营总览从后端提交列表计算视频提交、质量通过率、可交付资产和处理流水线状态，后端不可用时保留演示兜底。
- 管理端数据检索：数据提交页使用服务端搜索、状态筛选和分页，并展示真实周期锁定状态；当前筛选结果可导出 CSV。
- 审计检索：操作日志页使用服务端关键词、操作人、动作、时间范围筛选、分页和 CSV 导出，非管理员禁止访问。
- 通知和角标：顶部通知中心与导航角标读取后端运维状态摘要，按当前角色范围展示待处理、失败、复核和积分锁定提醒。
- 公开配置：官网指标、场景占比和公开文案从质检通过数据生成脱敏快照，管理员发布新快照会持久化并写入审计。
- 质量规则：管理员可发布质量规则版本、通过阈值和说明；当前版本保存在 PostgreSQL，并写入审计日志。
- 标签体系：管理员编辑核心标签会生成新的标签版本快照，当前版本保存在 PostgreSQL，并写入审计日志。
- 积分规则：管理员可发布积分规则版本、默认每分钟积分、质量系数档位和说明；当前版本保存在 PostgreSQL，并写入审计日志。
- 提示词版本：管理员可在“标签与规则”修改系统提示词；每次保存创建新版本，只影响之后开始的任务。
- 规则快照：新 AI 质检任务会锁定提示词、质量规则和标签体系版本；新积分周期会锁定积分规则版本，历史结果不受后续发布影响。
- 积分和交付：自动入账周期、明细快照、近似重复阻断、结算前差额调整流水、积分 CSV 导出、交付包、资产 CSV 清单、短期签名资产下载链接、zip/tar 一键归档和可追踪归档准备任务均已持久化。
- 运维发布：仓库包含 GitHub Actions CI；数据库迁移发布、回滚、容量/性能验收和告警起点见 `docs/operations/release-readiness.md`。

## 自动入账与次日结算

- 正常流程不需要管理员锁定或点击结算。AI 质检完成或人工复核通过时，提交已完成、资产正常、对象可用、无未解除的疑似重复、最终评分达到快照通过阈值且具备最终复核资格，便在同一数据库事务内保存计费快照并将收入记入钱包「结算中」。每个提交最多一个计费条目；并发 Worker、重复回调与补偿扫描不会重复入账。
- 金额继续按任务快照单价 > 团队单价 > 全局默认单价的优先级，乘有效小时数与质量系数计算，无新增费用。每个新提交拥有独立周期，`businessDate` 为上海审批日期，同一天可有多个周期，不向已结算周期追加条目。
- 到期时间是审批所在上海日历日的**次日 02:00（Asia/Shanghai）**，不是滚动 24 小时。例如 9 月 8 日 01:59、02:00 或 23:59 通过，均在 9 月 9 日 02:00 到期。钱包返回 `nextSettlementAt`；流水返回 `submissionId`、`fileName`、`settleDueAt`，时间均为 epoch 毫秒，历史缺失关联返回 `null`。
- API 和质检 Worker 启动后、此后每分钟补记历史合格但未入账的视频并结算到期周期。补记优先使用原 `manualReviewedAt`，其次原 `completedAt`，旧数据再退回质检记录 `updatedAt`/`createdAt`，不使用部署时刻。停机错过的到期金额会在恢复后补结算。初始化计费规则、自动入账和撤销均不依赖启用的管理员账号。
- 结算前纠错使用 `POST /point-cycles/:id/items/:itemId/adjust`，必须管理员权限和原因；记录原值、新值与差额，差额同步调整钱包结算中余额，到期按最新有效调整金额结算，原计费快照不被覆盖。到期再次锁定提交并检查资格；被隔离、对象不可用、出现未解除重复或质检非最终通过的收入以调整记录及负数入账流水撤销，不转可提现。余额分项不一致或不足会回滚事务并记录错误，不截断成零掩盖差错。
- 人工调整与自动结算统一按提交、周期、钱包顺序加锁，避免并发纠错发生外键死锁。历史周期缺少计价快照时使用其关联的历史规则；无关联版本的早期周期使用原默认系数，不使用当前活动规则，也不会按空系数将金额清零。
- 已入账视频继续禁止通过普通复核或重跑接口覆盖质检快照。已结算周期不再允许金额调整；重处理或资格变化不会暗扣可用、提现中或已支付金额。若需要更正已支付历史，应通过独立人工财务核对处理，本实现不新增债务或自动追扣机制。
- `POST /point-cycles`、`GET /point-cycles/preview`、`POST /point-cycles/:id/settle` 已移除，无法通过 HTTP 提前结算。保留周期列表、详情、CSV、单价规则和结算前异常调整接口。
- 迁移 `NextDaySettlement2026092100001` 放宽系统记账的创建人空值、补充索引和调整记录的稳定插入序号，并重算旧 `locked` 周期到期时间，不重置账号、余额、提现、已结算记录或原计费快照。稳定序号避免并发事务的开始时间反序导致读取旧调整。旧聚合周期不拆账：以各条目原审批时间中**最晚一次审批的次日 02:00**为到期时间，保守避免任何较晚审批项提前可用；不重新入账。该财务迁移为前向迁移，回滚须显式恢复已核验备份。
- **发布保护**：先备份原 PostgreSQL 数据与对象数据，应用迁移后再启动 API/Worker，保留原环境变量、账号、对象存储与提现加密密钥，不运行重置/重新播种。历史补记中原到期时间已过去的记录将在启动扫描中立即结算；正数结算仍发送原 `submission.source.retention.v1` 工作事件，后续 `SourceRetentionProcessor` 继续检查正式标注、任务切片完整性与原有回收安全条件，不能把新结算策略当作绕过对象保护的理由。零金额撤销不会新建回收事件。

## 本地运行

推荐使用 Docker Desktop 启动后端基础设施，再在本机启动 Web 界面。

```bash
cp .env.example .env
docker compose up -d --build

cd web
pnpm install
pnpm dev
```

默认地址：

- Web：`http://localhost:3000`
- 后端存活检查：`http://localhost:4000/api/v1/health/live`
- 后端就绪检查：`http://localhost:4000/api/v1/health/ready`（包含 PostgreSQL 可用性）
- RabbitMQ 管理页：`http://localhost:15672`
- MinIO 管理页：`http://localhost:9001`

后端容器每次启动都会自动检查并升级数据库结构；媒体进程和 AI 质检进程会等待 API 健康后再启动。Web 通过 `web/.env.local` 中的 `NEXT_PUBLIC_API_BASE_URL` 和 `BACKEND_INTERNAL_URL` 连接本地后端。

正式 AI 主流程需要在根目录 `.env` 配置 `QWEN_API_KEY` 和工作空间专属 `QWEN_BASE_URL`。非密钥默认配置为：

```dotenv
AI_QUALITY_CONCURRENCY=3
AI_QUALITY_MODEL_TIMEOUT_MS=600000
EVDP_AUTO_RECLAIM_WORKER_TIMEOUTS=true
MEDIA_WORKER_TASK_TIMEOUT_MS=600000
VIDEO_QUALITY_INITIAL_MODEL=qwen3.7-plus
VIDEO_QUALITY_REVIEW_MODEL=qwen3.7-flash
```

未配置百炼密钥时，API、账号、上传和媒体解析仍能运行，但 `ai-quality-worker` 会明确启动失败，视频会停在“等待 AI 质检”。密钥不会写入数据库或管理页面。

### 本地预设账号

首次启动且 `users` 表为空时，系统会创建以下账号并写入 PostgreSQL（本地初始密码由管理员通过私密渠道提供，不写入公开仓库）：

| 角色 | 用户名 | 团队 |
| --- | --- | --- |
| 平台管理员 | `admin` | 无 |
| 团长 | `tuanzhang1` | TEAM-01 |
| 团长 | `tuanzhang2` | TEAM-02 |
| 数采人员 | `ceshirenyuan1` | TEAM-01 |
| 数采人员 | `ceshirenyuan2` | TEAM-01 |
| 数采人员 | `ceshirenyuan3` | TEAM-01 |
| 数采人员 | `ceshirenyuan4` | TEAM-02 |
| 数采人员 | `ceshirenyuan5` | TEAM-02 |

这些预设账号只适合本机联调。把服务开放到局域网或公网之前，必须登录“个人资料”修改各账号密码，并更换 `.env` 中的数据库、会话、队列和对象存储密钥。
后端在生产模式下会拦截这些本地默认密钥和本地预设账号密码；`compose.yaml` 的本地服务会显式带上 `EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS=true` 作为本机联调许可，真实部署不应设置该开关。

正常重启只会在账号表完全为空时创建预设账号；只要已有任意账号，就不会重置密码或覆盖现有身份。对于已经运行过旧版本、但需要一次性校准上述八个账号的本地数据库，可明确执行：

```bash
docker compose exec api node dist/cli/bootstrap-local-identity.js --reconcile
```

该命令只应在需要校准的现有本地安装中手动运行，不属于日常启动流程。它会保留无关账号和业务数据，只校准上述预设账号并撤销被校准账号的旧会话。每个登录用户都可以在“个人资料”中验证当前密码后修改自己的密码；管理员和对应团长也可以在账号管理页重置其权限范围内账号的密码。两种改密操作都会撤销目标账号的现有会话。

视频上传限制：仅支持 MP4 和 MOV，单文件最大 2 GiB；分片大小为 16 MiB，浏览器最多同时上传 3 个分片。上传地址有效期 15 分钟。等待类任务仍可作为有效内容，当前自动无效片段只包括技术性黑屏和画面冻结。
对象保留期默认 180 天，可在 `.env` 中通过 `SUBMISSION_OBJECT_RETENTION_DAYS` 调整；设置为 `0` 表示不设置保留到期时间，但管理员删除仍会写入审计并同步业务状态。正式环境建议先完成备份，再执行强制删除。

### 备份和恢复演练

本地部署至少需要同时备份 PostgreSQL 数据和 MinIO 对象。推荐演练步骤：

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U evdp -d evdp > backups/evdp.sql
docker compose cp minio:/data backups/minio-data
```

恢复演练建议在一套新的本地环境中完成：

```bash
docker compose down
docker compose up -d postgres minio
docker compose exec -T postgres psql -U evdp -d evdp < backups/evdp.sql
docker compose cp backups/minio-data minio:/data
docker compose up -d --build
```

恢复后检查 `/api/v1/health/ready`、管理员审计日志、视频预览链接和交付包清单。真实部署应替换为云数据库快照、对象存储版本化/跨区复制和定期恢复演练。

如果只调试账号等 API，可以用 Docker 启动五个基础服务，再使用本机 Node 启动后端：

```bash
docker compose up -d postgres redis rabbitmq minio

cd backend
pnpm install
pnpm build
pnpm start:local
```

完整视频处理应使用 `docker compose up -d --build`，因为 `media-worker`、`ai-quality-worker` 和独立的 `ai-annotation-worker` 容器均已包含 FFprobe/FFmpeg。质检和结构化标注使用独立队列、重试/DLQ 与心跳，任一 Worker 停止不会改变另一条链路的健康状态。结构化标注默认全量运行（`AI_ANNOTATION_SHADOW_ENABLED=true`、`AI_ANNOTATION_SAMPLE_RATE=1`），自动准入默认开启（`ANNOTATION_AUTO_ACCEPT_ENABLED=true`）：Gate 判定为 eligible 的结果直接发布为 `auto_accepted`。默认不启用人工 Audit（`ANNOTATION_AUTO_ACCEPT_AUDIT_RATE=0`）；后续需要抽检时再提高该比例。关闭自动准入只影响之后完成的 Run，不撤销已有正式结果。

### 本地健康自愈与故障预防

api 容器（NestJS）曾出现两类故障：① Node 句柄/线程泄漏（基线 11 线程，挂死前 265 线程）；② **宿主机内存压力导致 Docker VM 冻结**——Docker VM 默认占用约一半内存（16GB 机器约 7.75GB），叠加 web dev 与编辑器后 macOS 进入重度换页（swap 打满），会冻结 VM 内全部进程，表现为 api 无响应且容器无法 kill（`did not receive an exit event`，见 docker/for-mac #6850 / #7816），只能重启 Docker Desktop。为此做了四项预防：

1. **本地有界失败（compose.yaml）**：api 容器默认配置 `pids_limit: 200`、`mem_limit: 1536m`、`NODE_OPTIONS=--max-old-space-size=1024` 与 `stop_grace_period: 30s`。线程/内存超限时由内核终止容器并依赖 `restart: unless-stopped` 自动拉起。服务器部署叠加 `compose.prod.yaml` 后会清除 `mem_limit` 和 Node 堆上限，不把开发机容量带入生产；`pids_limit` 与停止宽限仍作为进程异常保护保留。
2. **健康自愈脚本**：`scripts/dev-health.sh` 定时探测 `/api/v1/health/ready`，连续失败 3 次自动 `docker compose restart api`；daemon 卡死时给出重启 Docker Desktop 的指引；**并预检宿主机 swap 使用率**，超过 50% 提示、超过 80% 预警并建议降低 Docker VM 内存。建议通过 cron/launchd 每 2~5 分钟执行一次：

   ```bash
   */2 * * * * cd <仓库目录> && ./scripts/dev-health.sh --cron >> /tmp/dev-health.log 2>&1
   ```

3. **按本地机器调整 Docker VM 内存**：这是 Docker Desktop 虚拟机的本地设置，不是生产服务器限制。8GB MacBook Air 可设为 **2GB** 以避免 macOS 重度换页；内存更充足的开发机可按并行容器数量提高。Linux 服务器没有这项 Docker Desktop VM 上限，生产容量应按真实视频并发与 Worker 实测配置。
4. **泄漏监控**：可用 `docker stats evdp-api-1` 观察线程数（基线约 10~20）。若线程持续增长，说明存在连接/句柄泄漏，需要排查 TypeORM 连接池、amqplib、aws-sdk 与 ioredis 的配置。

### 独立 AI 视频质检与融合标注实验页

只验证 AI 视频质检时，不需要启动 PostgreSQL、MinIO、RabbitMQ 或 Qdrant。根目录 `.env` 配置百炼 `QWEN_API_KEY` 和工作空间专属 `QWEN_BASE_URL` 后运行：

```bash
docker compose --profile ai-test up --build ai-quality-lab ai-annotation-lab
```

两个实验入口使用相同视频上传方式，但任务历史和结果完全隔离：

- `http://127.0.0.1:4010`：原业务 AI 质检基线，只运行 D1–D5、条件复核和服务端规则复算。
- `http://127.0.0.1:4011`：融合 AI 标注实验页，对同一视频并行运行原业务质检与 `ego_video_annotation_v2` 结构化语义标注，后者不参与质检分数或结算。

v2 标注会输出任务粒度、执行模式、原子步骤、手物交互、完成度、可见结果、失败恢复、复杂度信号和逐采样点 coverage。正式业务链路使用 `ego_annotation_evidence_policy_v3` 和 `annotation_auto_gate_v1`：服务端先做不改变语义的确定性规范化，结构/证据引用错误进入有预算的模型修复或重试；只有固定、可解释的核心任务风险进入人工复核。约 5 秒抽帧间隔、低 confidence 及允许保守输出的 completion/result/failure 字段不会单独阻断。人工确认或具有完整 Gate 快照的自动准入结果可进入之后生成的交付快照；旧影子结果、候选、拒绝和已替代 Run 不可正式导出。

两个页面均可一次选择多个 MP4/MOV；浏览器和服务端都最多同时处理 2 条。业务质检提示词可直接在页面编辑并发布新版本；每个新任务会锁定创建时的提示词版本，之后的修改不会影响已上传或历史任务。融合结构化标注使用仓库中版本化的独立提示词，并在结果 JSON 中记录 Prompt、Schema、证据策略和模型版本。

实验模式不写正式数据库。每次上传由服务端生成固定的 `LAB-...` 任务 ID；页面刷新后会从本地历史恢复，容器重启后仍可查询。点击左侧历史任务即可在右侧切换对应评分详情，任务缩略卡会显示总分。任务状态、评分结果、当前提示词和脱敏百炼调用诊断通过 Docker 命名卷持久化，任务数据保留 30 天，也可以在页面手动删除并下载单项或整批 JSON。诊断包含每次尝试的阶段、模型、耗时、HTTP 状态、百炼 `request_id` 和底层网络错误码，但不保存 API Key、Authorization 请求头、Base64 帧、请求正文或完整模型回复。

原视频和抽帧仍会在单项完成、失败或取消后立即删除；服务重启时尚未完成的任务会标记为“服务重启导致任务中断，请重新上传”。由于尚未连接库存数据库和向量库，第五维使用规则中明确允许的冷启动权威系数 `C_inventory=1.00`、`C_unique=1.00`；同一页面批次内仍会通过 SHA-256 识别完全相同文件。

真实模型调用会产生百炼费用。自动测试不会调用百炼；如果需要对目录中最小样例执行一次明确的付费冒烟测试，可运行：

```bash
docker compose --profile ai-test run --rm ai-quality-lab \
  node dist/cli/smoke-video-quality.js \
  /samples/file/27622_60.mp4 --confirm-paid-call
```

停止实验页使用 `docker compose --profile ai-test stop ai-quality-lab ai-annotation-lab`。当前 API Key 曾通过明文渠道提供，完成联调后应在百炼控制台轮换。

旧 D1 账号只在首次迁移时读取，运行期不再提供 D1 接口。迁移命令会保留账号 ID、角色和团队归属，把旧原型密码立即转换为 Argon2id，并跳过旧会话：

```bash
cd backend
D1_SQLITE_PATH=/绝对路径/旧数据库.sqlite pnpm import:d1
```

需要页面联调数据时，可以写入 6 条明确带 `is_test_data=true` 标记的视频记录。脚本幂等，不覆盖同 ID 的已有数据，也不会伪造 AI 分数：

```bash
docker compose exec api node dist/cli/seed-video-test-data.js
```

停止服务时使用 `docker compose stop`，PostgreSQL、MinIO、Redis、RabbitMQ 和 Qdrant 的命名数据卷都会保留。删除数据卷属于破坏性操作，不是正常重启或日常清理步骤；只有在明确不再需要本地数据库、对象和队列数据时才可执行。

## 人工 / 线下提现

提现不连接支付宝或银行支付 API。数采在个人钱包的「可提现」页填写金额、支付宝账号与真实收款姓名，或银行账户、户名与银行名称，核对后提交申请。不要收集身份证、CVV、PIN 或密码。每次申请保存不可变的收款信息快照，不提供账户编辑影响已提交申请的路径。

- 申请把可提现金额原子转入「提现处理中（预留）」，不创建已付款流水；同一提交重试使用同一幂等标识，不会重复扣款。同一标识携带不同信息会被拒绝。
- 管理员从 `/admin/withdrawals`（「人工提现」）筛选并领取待处理申请，生成不可变批次并进入 processing。领取不会自动导出，更不会自动付款。
- 财务显式导出 CSV，在平台外手工核对并实际转账。**导出不是付款**。允许显式重新导出同一批次，但须按申请 ID / 批次 ID 与银行记录去重核对，不能再次批量转账。文件会带当前状态，已付款条目不可再次支付。
- 实际付款后，管理员填写转账参考号与实际付款时间并确认，才从预留转入已提现 / 累计提现，同时产生 withdraw 流水。付款时间不能早于申请或晚于当前时间。
- pending 可以填写原因拒绝，原路释放预留。processing 不能取消或直接拒绝；银行结果未知时保持 processing，不能自动退款。只有财务明确确认没有实际转账或款项已退回，填写原因并确认后才标记 failed 并释放。重复相同确认幂等，冲突确认被拒绝。
- 总余额 = 结算中 + 可提现 + 预留 + 已提现；累计赚取 = 可提现 + 预留 + 已提现（不含结算中）。历史提现流水和已提现金额原样保留，不倒推为新申请。

完整收款信息仅在管理员显式财务导出接口可读，普通申请列表只返回脱敏姓名 / 账号；团长只能读取本队钱包余额和历史流水，不能读取提现收款信息。批次、导出和状态确认记录到审计日志，不记录完整收款信息。财务原因 / 转账参考号不要填写敏感账号或姓名。

CSV 使用既有表格公式防注入规则；`account_text` 列额外加一个前导单引号作为文本标记，保留前导零和全部长账号数字。用表格软件导入时将此列设为文本；人工转账前去掉首个标记单引号再核对原账号，不要以数字格式打开、另存或直接自动支付导入。导出文件含敏感信息，须限制传递和访问，核对完成后安全删除。

### 提现密钥与部署

先备份数据库，再按既有迁移命令运行 `ManualPayouts2026092000001`（`backend/src/database/migrations/202609200001-manual-payouts.ts`），新增预留余额、申请与批次，不改写历史提现。生产环境禁止对有申请的数据库执行 migration down。

API 环境变量 `PAYOUT_RECIPIENT_KEY` 必须为独立随机 32 字节密钥的 **64 位十六进制**字符串。可离线生成：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

通过受控环境 / secret manager 配置到 API（现有 Compose 的 API `env_file: .env` 会加载它），不要提交到仓库或复制到浏览器环境变量。无密钥或格式错误时提交与导出返回不可用，绝不保存明文；余额查询仍可用。收款信息采用 AES-256-GCM，随机 IV，并绑定申请 ID 防止替换密文；幂等信息使用密钥 HMAC，避免泄露低熵账号。

**密钥须与数据库备份分别安全保存并测试恢复。** 密钥丢失无法解密历史收款信息；不要运行环境重建时生成替代密钥，也不要在已有申请时直接替换它。当前版本不提供在线密钥轮换接口；轮换须先停用申请 / 导出，制定受控解密重加密与一致性验证方案后操作。`deploy/prepare-production-env.sh` 不生成或覆盖此密钥，部署人员须显式提供原密钥。未配置密钥时可部署非提现功能，但不能验收提现提交 / 导出。

## 验证

后端数据库测试会清空目标库。只允许连接可销毁的专用测试库，不能使用业务库或手工验收库。
Vitest 统一入口要求 `NODE_ENV=test`、`ALLOW_TEST_DATABASE_RESET=true`，数据库名须包含独立的
`_test` / `test_` / `_e2e` / `e2e_` 标记（例如 `evdp_test`、`evdp_e2e_<uuid>`）。
每次交出 PostgreSQL 连接前还会用 `SELECT current_database()` 校验实际库名与配置一致。
`evdp`、`postgres`、`template0/1` 和未明确命名的数据库均拒绝；临时容器也必须使用测试库名。
保护仅由后端 Vitest 加载，不代替数据库权限隔离，不保护手工 SQL 或独立 CLI。
不要绕过测试配置运行重置脚本，不要对业务库执行 migration down 或日常执行 `docker compose down -v`。

先创建独立临时 PostgreSQL 实例及可销毁的 `evdp_test`，再显式配置连接；以下命令不会创建或备份数据库：

```bash
cd backend
NODE_ENV=test ALLOW_TEST_DATABASE_RESET=true \
  TEST_DATABASE_URL="$DISPOSABLE_TEST_DATABASE_URL" \
  DATABASE_URL="$DISPOSABLE_TEST_DATABASE_URL" pnpm test
pnpm typecheck
pnpm build

cd web
pnpm test
pnpm typecheck
pnpm build
pnpm test:render
```

只验证防误删规则、不连接任何数据库：`cd backend && pnpm exec vitest run test/database-safety.spec.ts`。
CI 的显式授权只用于独立 PostgreSQL service 中的 `evdp_test`。

CI、迁移发布、容量/性能检查和告警建议见 `docs/operations/release-readiness.md`。

## 初始账号

- 管理员用户名：`admin`
- 团长用户名：`tuanzhang1`、`tuanzhang2`
- 测试人员用户名：`ceshirenyuan1` 至 `ceshirenyuan5`

初始密码由管理员通过私密渠道提供，不保存在公开源码或 README 中。

登录页使用用户名和密码。管理员可在“用户与团队”页面新增、编辑和启停团队，指定唯一团长，新增管理员、团长或数采人员账号，并可编辑账号、调整团队归属、重置密码、停用和重新启用账号。重置密码、角色或团队变更、团长更换和停用账号都会使受影响账号的已有登录会话失效。
登录接口和账号、团队、规则、积分周期、交付包、公开快照和对象删除等敏感写操作带有服务端频率限制；过期登录会话会在服务启动、定时任务和登录时自动清理。敏感视频隔离或解除隔离会随人工复核一并留痕，并影响后续积分、交付和公开统计口径。

> 对外长期使用时，管理员可在后台定期重置账号密码。

## 交互演示

账号、团队、团长任命、成员管理、审计、视频上传、数采我的数据与质检详情、媒体解析、AI 质检结果、人工质量复核写回、管理员系统提示词、积分周期锁定和交付包均使用真实本地后端；管理员首页、资产页、团队工作台、团队分析、成员指标、数采积分明细和团队积分汇总从后端提交、积分周期与待锁定提交数据计算。可优先体验：

- 管理员创建采集任务并填写要求，AI 规范化为结构化条目后可预览编辑、确认后发布；全新场景自动进入标签字典。
- 数采人员从任务大厅选择任务、确认任务要求后上传，质检详情展示任务符合度逐条判定；积分按任务单价 × 质量系数计算并锁定周期。
- 团长查看团队数据、成员详情与指标，并新增、改名、重置密码、停用或启用本团队数采账号；团队数据和成员指标均可按当前筛选导出。
- 管理员新增、编辑和启停团队，原子任命唯一团长；团长可导出本团队成员指标。
- 管理员新增或配置账号，查看正式 AI 队列和 Worker 心跳，重跑失败 AI 质检任务，在“标签与规则”发布新的 AI 系统提示词版本。
- 管理员预览并锁定积分周期，疑似重复候选会先被排除；系统会保存每条视频的积分快照和审计记录，并提供 CSV 明细下载。
- 锁定周期后的质量复核会写入调整流水和差额审计，不会覆盖原周期快照。
- 管理员创建交付包，系统保存资产条目并提供 CSV 资产清单、短期视频下载链接、zip/tar 一键归档下载和可追踪归档准备任务。
- 管理员发布公开官网脱敏快照，官网首页自动展示最新汇总指标和场景占比。
- 通过上传前授权确认、跨设备恢复上传、敏感视频隔离、近似重复候选、顶部通知面板、导航角标、成功提示和操作日志观察真实待处理事件与操作结果。

短信和真实支付仍为演示占位，不会触发外部服务；交付包已支持真实 CSV 清单、短期签名视频下载链接、zip/tar 一键归档和带进度状态的归档准备任务。上传后的视频在媒体解析成功时会自动生成低码率预览 MP4、HLS 多码率清单/分片、封面图和问题片段证据帧，生成近似重复候选，并进入正式 AI 队列，依次经历 `awaiting_ai`、`ai_processing` 和终态；结果、模型调用元数据、失败原因及提示词快照均写入 PostgreSQL，重启后仍然存在。

## 独立任务切片 JSON（TASK-ASSET-001A）

长期保存对象是任务切片 MP4 与 `task_segment.v1` JSON，不以完整视频作为切片使用的前提。
新资产使用 `segments/{assetId}/video.mp4` 与 `segments/{assetId}/annotation.r0001.json`；
历史 MP4 的 `clipObjectKey` 保持不变，JSON 仍进入对应 Asset 的 `segments/` 目录。
历史文件不保证目录共置，通过 `asset_id`、数据库 `clipObjectKey` 和 Revision `videoSha256` 逻辑绑定；
未来交付打包可统一导出为 `video.mp4 + annotation.json`，本阶段不实现该导出。
数据库保存 Asset 当前指针、状态及 Revision 的不可变内容/校验快照；对象存储保存实际文件。
契约入口为 `backend/src/task-segment/task-segment-annotation.ts`。

视频通过校验后，在同一事务中置 JSON 为 `pending` 并写入
`task.segment.annotation.publish.v1` Outbox，由现有 Media Worker 消费。
Asset 状态为 `pending → publishing → published`，失败为 `failed`；无需生成的切片为 `not_applicable`。
Revision 状态为 `publishing → published / failed`，失败重试复用同一指纹、编号和字节。
V1 业务链路仅完成初始 `r0001` 发布、同版本失败恢复及历史回填；不可变模型与状态机为后续版本保留能力。
尚无管理员编辑、标签/QC/Human Review 变更自动触发新版本或通用 Revision 发布命令。
对象上传、HEAD 大小及回读 SHA 校验通过后，事务再次验证输入指纹和视频绑定，才原子切换 Current Revision。
`published` Revision 禁止修改；历史版本仍可下载。未发布文件即使已上传也不会暴露为当前版本。

Canonical JSON 递归排序对象键、保留数组顺序，使用 UTF-8、两空格缩进和末尾换行；SHA-256 对实际文件字节计算。
Source Fingerprint 对固定 revision=1 的完整输出、完整 effective task/scene、相关映射、MP4 Key，
以及源 prompt SHA、review status、generation policy 做同样的 canonical SHA-256。
标签、时间、媒体参数或版本变动均产生新指纹；不依赖签名 URL、当前时间或随机序列化顺序。

所有任务、结果、失败/恢复、原子动作及 task-linked coverage 时间均减去 `actualStartMs`，不是 requested start。
越界证据失败，不 clamp。新切片的物理范围取逐侧 refined/coarse 有效边界与这些证据的并集，
再加前后各 500 ms padding（限制在源时长内），继续执行 3 秒最短规则；scene evidence 不扩大片段。
场景与任务语义默认标为 `inherited_from_published_annotation`，只有采用 Human Result 才标 `human_verified`，
不声称切片级视觉复核。场景、任务及对象复用已发布映射；工具允许 unmapped，不重新匹配标签字典。
`task.mapping` 和 `task.object_mapping` 明确保留任务标签与主对象映射。
`source_group_id = submissionId`，scope 为 `original_upload`，不推断跨文件 session。
`source_video_quality` 是本 Revision 发布时冻结的源视频 QC 快照，不是实时 QC；后续审核修改不会自动同步到已发布 JSON。

管理员接口（以下均以 `/api/v1/operations/task-segment-assets/:assetId` 开头）：

- `GET /annotation`：当前已发布内容与发布状态。
- `GET /annotation-revisions`：历史 Revision 元数据。
- `GET /annotation-revisions/:revision/download`：仅已发布版本的 15 分钟下载链接。
- `POST /annotation/retry`：ready/passed、未发布或 publishing 超时 5 分钟时幂等入队；不重切视频、不调用模型。

历史回填先 dry-run，再按显式上限入队；使用已经审查过的数据库及 MinIO 环境变量（`DATABASE_URL`、
`MINIO_BUCKET`、`MINIO_ENDPOINT`、`MINIO_PUBLIC_ENDPOINT`、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY`）：

```bash
cd backend
pnpm task-segment:annotation-backfill --dry-run --limit=100
pnpm task-segment:annotation-backfill --limit=100
# 使用上次输出的 nextCursor 继续：--after=<assetId>
```

每次最多扫描 1000 行；dry-run 不写数据库。已发布资产跳过，结构不完整/证据越界的历史资产会统计为 blocked，
执行回填时由发布器记录明确失败原因。源已删除但有效快照与 MP4 尚在时仍可发布；不搬迁旧 MP4、不补调模型。

Source Retention 保留现有正式 Run、完整任务对应关系、refinement 终态、视频 ready/passed 等门禁，
并要求所有必要资产的 Current JSON 已发布、绑定该 MP4 SHA 且对象 HEAD 大小正确。
先删除完整 preview、HLS 和 thumbnail，原视频最后删除；部分失败保留数据库 available 状态并幂等重试。
JSON 发布完成会为已结算 Submission 再次唤醒 retention，不改变 QC 或结算数据。

修改语义/审核结论应在同一 Asset 上新增 JSON Revision；改变边界或视频字节则应创建新 Asset。
001A 不实现编辑 API、替代关系或客户 Delivery；场景库存 UI 和组合筛选见下节 001B。

真实冒烟测试使用合成画面与预设语义（不调用 Qwen），覆盖 exact、stream copy、证据扩张、上传失败、历史回填及完整删源。
仅在独立 PostgreSQL/MinIO/RabbitMQ 环境中运行；该测试会重置指定的测试数据库，并创建独立 smoke Bucket：

```bash
cd backend
# Node 22，安装 FFmpeg/FFprobe，并设置本文测试安全变量、独立 RABBITMQ_URL。
# TASK_SEGMENT_SMOKE_ENDPOINT / TASK_SEGMENT_SMOKE_ACCESS_KEY / TASK_SEGMENT_SMOKE_SECRET_KEY
# 必须指向可销毁的 MinIO 实例；不设置 endpoint 时此项默认跳过。
pnpm exec vitest run test/task-segment-annotation-smoke.e2e-spec.ts
```

## 任务片段资产库（TASK-ASSET-001B）

管理员入口 `/admin/task-assets` 提供资产明细、组合筛选、场景库存和 CSV。
列表不会预签名所有视频：点击播放、查看/下载 JSON、技术详情时才调用现有片段接口。
没有工具条目的含义是“未列出工具”，不是已经确认“无工具”；未知结果不等同失败。

### 查询投影与发布一致性

`task_segment_asset_projections` 每个 Asset 只有一行，版本为 `task_asset_projection_v1`。
唯一语义来源是 **Asset.currentAnnotationRevisionId → 已发布 Revision.contentJson**。
不读取实时 AnnotationRun/LabelSet/QC 的语义，不调用模型，不修改 `task_segment.v1` 或 OSS 对象。
它是可重建的查询索引，不是第三份语义真相，也不是 Source Retention 的删源门禁。

新 JSON 发布时，保留 submission → run → asset → revision 锁顺序及正式 Run、视频绑定、指纹校验，
在同一事务内先 upsert 投影，再发布 Revision、切换 Asset 当前指针。任何一步失败都会回滚；
新 Revision 覆盖同一条投影，历史 JSON 不变。并发回填重新锁定 Asset 后读取当前指针，不能覆盖新版本。
发布 finalize 和历史回填均先对数据库 JSON 做一次 schema 与 Asset/Revision/视频绑定校验，再复用解析结果构建投影。
001A 发布器即使用 `task_segment.v1`；本功能不引入旧格式转换，不支持的格式在校验时明确失败，不静默发布。

场景只做确定性归组：正式标签为 `label:<labelId>`；无正式 ID 时使用 fine label（否则 coarse label）
经 NFKC、trim、小写、空白折叠得到 `proposed:<text>`；无可读文本为 `unknown`。
不自动生成 Label ID、不做模糊合并。对象、工具、交互原语分别建立数组索引；对象/工具另保留配对的 ID/name，
避免独立排序的 ID/name 数组被错误配对。无正式标签的计数包含 proposed 子集，原始文本保留。

### 接口与统计口径

以下管理员 GET 接口均在 `/api/v1/operations/task-assets` 下；未登录 401、非管理员 403：

- `/`：分页资产、筛选后 summary、indexHealth。
- `/facets`：全部当前筛选条件内的分布，不排除该 facet 自身的过滤条件。
- `/scene-summary`：按 sceneGroupKey 聚合及各场景 Top 10 动词/对象/工具。
- `/export.csv`：相同筛选范围，忽略分页，超过 50,000 行返回 `TASK_ASSET_EXPORT_LIMIT_EXCEEDED`；复用 CSV 转义与公式注入防护。

默认范围：Run succeeded 且 auto_accepted/human_verified；Asset ready、validation passed、JSON published；
当前 Revision published；投影的 Revision 与当前指针一致且 projectionVersion 为当前版本。
`includeHistorical=true` 额外包含 superseded Run 并标记 `isCurrent=false`，不包含 candidate/rejected。
页面的“包含历史资产（已被替代）”默认关闭；启用并应用筛选后，列表、分面、场景库存、索引覆盖与 CSV 共享当前/历史范围，
每行显示当前/历史状态，重置筛选恢复仅当前范围。这里的历史资产指被替代 Run 的切片，各切片仍读取自己的当前已发布 JSON，
不是展开同一切片的全部旧 JSON 修订。
原视频删除不影响入库范围。缺失或过期投影不混入结果；indexHealth 统计整个上述已发布范围（不随语义筛选变化），
分别报告当前、缺失和过期数量。资产表、统计、分面和 CSV 不逐条解析源 JSON，不做 Node 端全量过滤。

支持参数：`q`；`sceneKeys`、`sceneMappingStatuses`、`taskVerbs`、`taskLabelIds`、`objectLabelIds`、`toolLabelIds`；
`handModes`、`executionPatterns`、`interactionPrimitives`、`complexitySignals`；`completions`、`resultStatuses`、
`failureRecoveryStatuses`、`semanticVerifications`、`sourceAnnotationAcceptances`、`boundarySources`、`materializationModes`；
`hasAudio`、`hasUnmappedLabels`、`hasUncertainty`；`minDurationMs`、`maxDurationMs`、`sourceGroupId`。
多值支持重复参数或逗号分隔，同维度 OR、跨维度 AND；最多 20 个去重值、每值 120 字符，关键词最多 200 字符。
关键词为转义后的字面量 ILIKE 子串匹配（`%`/`_` 不作为通配符），没有全文、向量或 pg_trgm 索引。
`page` 默认 1，`pageSize` 默认 50、最大 100；排序 `createdAt|duration|scene|task|result` + `asc|desc`，
默认 createdAt DESC、assetId DESC，同值始终用 assetId 打破排序并列。

`totalSegmentDurationMs` 是所有片段时长之和，**重叠任务可能重复计算原视频区间**，不是独立采集时长。
`sourceGroupCount` 使用 COUNT(DISTINCT sourceGroupId)，表示原始上传数；全局总数不能把各场景去重数直接相加。
不加入采集目标、库存缺口、定价、QC 或结算计算，不与旧“数据资产/交付包”页面混用口径。

### 部署后的数据库回填

先应用迁移 `TaskAssetProjection2026091300001`（只建表/约束/索引，不回填数据），再在 backend 执行：

```bash
pnpm task-asset:projection-backfill -- --dry-run --limit=100
pnpm task-asset:projection-backfill -- --limit=100
# 按输出 nextCursor 继续：--after=<asset-id>
```

只需要指向已核对环境的 `DATABASE_URL`，**不需要原视频、MinIO/OSS 或模型密钥**。
非 dry-run 必须显式提供 limit（1–1000）；扫描已发布且有当前指针的资产。
输出 scanned、eligible（需重建数）、created、updated、current、blocked、failed、nextCursor。
dry-run 全程 SELECT，不写索引；单条失败不中断后续资产，错误仅含 Asset/Revision ID 和固定错误码。
blocked/failed 时 CLI 返回非零退出码。回填完成后检查页面索引覆盖率和待映射/未知分布。

本地验证使用 Node 22 及隔离测试环境：

```bash
cd backend
pnpm exec vitest run test/task-asset-projection.spec.ts test/task-asset-query.spec.ts test/task-asset.e2e-spec.ts
# 与 001A 相同的独立 PostgreSQL/MinIO/RabbitMQ/FFmpeg 环境，增加 A–G 资产库验收。
pnpm exec vitest run test/task-segment-annotation-smoke.e2e-spec.ts
# 会重置指定测试数据库；10,000 条 SQL 合成投影，不调用对象存储/模型。
TASK_ASSET_PERF=true pnpm exec vitest run test/task-asset-performance.e2e-spec.ts
```

性能测试执行 EXPLAIN ANALYZE，检查稀有场景普通索引、对象/工具 GIN，并输出首页、场景汇总、facets 的查询计划。
场景汇总和 facets 在只读事务内 `SET LOCAL jit = off`，避免 JSONB 展开行数估计引发高额编译开销；不改变连接池或数据库全局设置。
合成数据只验证索引与查询形态，不代表生产延迟或真实数据分布。低内存机器全量测试建议 `--maxWorkers=1`，避免与已有容器争抢资源。

## 工程结构

```text
backend/                  # NestJS API、PostgreSQL、MinIO、RabbitMQ 与媒体处理
web/
├── app/                  # vinext / Next 应用入口、全局样式和元数据
├── src/app/              # 客户端路由与角色边界
├── src/auth/             # 对接 NestJS 的登录与账号 API
├── src/domain/           # 领域类型和纯业务计算
├── src/data/             # 后端不可用时的演示兜底状态
├── src/submissions/      # 真实视频上传、列表与后端数据映射
├── src/components/       # 表格、状态、复核抽屉等公共组件
└── src/features/         # 官网、登录、数采、团长和管理员页面
```

账号、登录会话、团队、审计、视频提交、上传授权确认、近似重复候选、敏感视频隔离、对象存储访问审计与删除状态、AI 提示词版本、质量规则版本、标签体系版本、积分规则版本、规则快照、AI 质检结果、积分周期、交付包、交付包异步归档任务、公开官网脱敏快照、通知角标状态和 Worker 心跳通过 NestJS API 与 PostgreSQL 管理，视频对象、低码率预览视频、HLS 预览清单/分片、派生预览图和已准备归档保存在 MinIO，数采提交列表/质检结果/详情、数采积分明细、管理端首页、管理端提交列表、管理端资产页、管理员复核候选、团长工作台、团长团队数据、团长团队分析、团长成员指标、团长只读质检结果、团队积分汇总和审计日志已使用服务端检索、分页、积分周期或必要导出，Worker 已记录任务完成/失败数、平均/最近/最长处理耗时并支持超时任务重新排队，登录与敏感写操作已接入服务端限流、过期会话清理和生产默认密码保护。后续可继续把近似重复从当前元数据相似度升级为视觉指纹或向量检索。
