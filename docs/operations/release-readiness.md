# 发布就绪检查与运维指引（Release Readiness）

> 本文档是 README 中“运维发布”一节的落点：数据库迁移发布/回滚、容量/性能验收与告警起点。
> 状态：骨架已由仓库内可核验的命令与配置整理；标注为「**待运维负责人**」的条目需要在正式上线前由指定负责人补齐实际值（域名、监控渠道、容量数字等），补齐前不应视为已就绪。

## 1. 发布版本标记

- 后端与前端镜像统一使用三个构建参数标记版本：`EVDP_RELEASE_VERSION`、`EVDP_GIT_SHA`、`EVDP_BUILD_TIME`（见 `compose.yaml` 各服务的 `build.args`）。本地默认 `dev` / `unknown`。
- 发布时应从 Git tag/commit 取值构建，例如：

  ```bash
  EVDP_RELEASE_VERSION=v0.2.0 EVDP_GIT_SHA=$(git rev-parse HEAD) \
  EVDP_BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
  docker compose build api media-worker ai-quality-worker ai-annotation-worker web
  ```

- 运行后通过 `GET /api/v1/health/version` 回读 `version` / `revision` / `builtAt`，与发布记录比对，作为“部署的就是这个版本”的证据。
- `docker compose ps` 中所有 worker 必须与 api 使用**同一 release 版本镜像**；混合版本是部署事故的高发来源。

## 2. 生产环境准备（首次与轮换）

`deploy/` 下脚本按序使用（在服务器上执行，仓库不在服务器上时先拷贝）：

1. `deploy/prepare-production-env.sh <env-file> <public-host>`：轮换 PostgreSQL/Redis/RabbitMQ/MinIO 口令并重写连接 URL；设置 `WEB_ORIGIN`、`COOKIE_SECURE`、`TRUST_PROXY_HOPS`、`NEXT_PUBLIC_API_BASE_URL=/api/v1`、`BACKEND_INTERNAL_URL`；校验 Qwen 凭据（缺失时退出码 2）。
2. 用生成好的 env 文件启动：`docker compose -f compose.yaml -f compose.prod.yaml up -d --build`。`compose.prod.yaml` 会：以 `NODE_ENV=production` + `EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS=false` 启动 api（生产默认凭据被 `backend/src/config/environment.ts` 拒绝）；api 启动命令先 `run-migrations.js` 再 `main.js`；追加 `web`（NEXT_PUBLIC_API_BASE_URL=/api/v1 构建期注入）与 `gateway`（nginx，`WEB_BIND_ADDRESS:WEB_HOST_PORT`）。
3. `deploy/bootstrap-production-identity.sh`：仅在账号表为空时创建 8 个预设账号并逐一轮换随机密码（凭据写入服务器 `/root/evdp-initial-credentials.txt`，0600）。
4. 密钥纪律：Qwen（百炼）API Key 曾通过明文渠道联调，正式上线前必须在百炼控制台**轮换**；MinIO 凭据由步骤 1 轮换。`.env` 不进仓库（`.env.example` 仅含本地默认值）。

## 3. 数据库迁移：发布与回滚

- **正向发布**：生产由 api 容器启动命令执行（`node dist/database/run-migrations.js`），无需手工步骤；手工执行等价命令：

  ```bash
  cd backend
  pnpm migration:run
  ```

- **回滚原则（重要）**：代码注释与历史决策一致——`down` 迁移只适用于**可销毁测试库**（`NODE_ENV=test` + 显式 `ALLOW_TEST_DATABASE_RESET=true` + 独立 test/e2e 库名，见 `backend/test` 的数据库保护 Guard）。**生产回退应保留新 Schema、只回退应用镜像版本**，不得用 `down` 改写真实数据去迁就旧 Schema。
- 若确需在隔离演练环境验证回退脚本：`cd backend && pnpm migration:revert`（容器内为 `node dist/database/revert-migration.js`），仅限一次性测试库。
- 每个发布记录应写明：本次 migration head（`backend/src/database/migrations/` 最新文件名）、涉及表、是否需要数据回填/后台任务。

## 4. 备份与恢复

本地/单机部署至少同时备份 PostgreSQL 与 MinIO 对象，README「备份和恢复演练」给出可复现步骤：

```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U evdp -d evdp > backups/evdp.sql
docker compose cp minio:/data backups/minio-data
```

恢复在新环境演练：先起 `postgres minio`，导入 SQL 与对象，再 `up -d --build`，随后检查 `/api/v1/health/ready`、管理员审计日志、视频预览与交付包清单。

- 生产建议（**待运维负责人**）：云数据库自动快照 + 保留周期；对象存储版本化/跨区复制；**定期（至少每月）执行一次恢复演练**并把演练记录归档；恢复演练应包含“切片后源文件已删除”场景下的对象一致性核对。

## 5. 服务、端口与健康检查

| 服务 | 容器端口 | 默认宿主映射 | 健康检查 |
| --- | --- | --- | --- |
| postgres | 5432 | 127.0.0.1:`POSTGRES_HOST_PORT`(55432) | pg_isready |
| redis | 6379 | 127.0.0.1:6379 | redis-cli ping |
| rabbitmq | 5672/15672 | 127.0.0.1:5672/15672 | rabbitmq-diagnostics ping |
| minio | 9000/9001 | 127.0.0.1:`MINIO_API_HOST_PORT`(9000)/`MINIO_CONSOLE_HOST_PORT`(9001) | /minio/health/live |
| api | 4000 | 127.0.0.1:4000 | wget /api/v1/health/ready |
| media / ai-quality / ai-annotation worker | — | — | restart 策略自愈 |
| web（prod） | 3000 | 内网 | wget 首页 |
| gateway（prod） | 80 | `WEB_BIND_ADDRESS:WEB_HOST_PORT` | depends_on 健康 |

- 应用健康端点：`/api/v1/health/live`（存活）、`/api/v1/health/ready`（就绪）、`/api/v1/health/version`（发布版本）。
- 本地完整视频处理必须用 `docker compose up -d --build`（worker 镜像内含 FFprobe/FFmpeg）；仅调试 API 时可只起 `postgres redis rabbitmq minio` 再 `pnpm start:local`。
- 宿主端口绑定默认 127.0.0.1（本地安全默认）。生产需要对外暴露 gateway 与 MinIO（预签名下载 URL 指向 `MINIO_PUBLIC_ENDPOINT`）时，在 env 中覆盖 `WEB_BIND_ADDRESS`、`MINIO_BIND_ADDRESS` 等变量——**待运维负责人**按部署拓扑明确哪些端口可公网访问（建议仅 80/443，MinIO 走内网或私有网络）。

### 已知的本地稳定性经验（复制到生产排障）

- `compose.yaml` 面向本地开发，api 默认配置 `pids_limit: 200`、`mem_limit: 1536m`、`NODE_OPTIONS=--max-old-space-size=1024`、`stop_grace_period: 30s` 与 `restart: unless-stopped`。生产叠加 `compose.prod.yaml` 后会清除 `mem_limit` 和 Node 堆上限，由服务器/编排层按容量验收结果配置内存；`pids_limit`、停止宽限与重启策略继续防止线程泄漏或进程挂死。
- `scripts/dev-health.sh` 定时探测 ready 端点（连续失败 3 次自动 restart api）、预检宿主 swap（>50% 提示、>80% 预警）并给出 Docker VM 内存建议；建议 cron 每 2–5 分钟执行。
- 线程基线参考：api 约 10–20 线程（`docker stats` 观察）；持续增长说明存在连接/句柄泄漏，排查 TypeORM 连接池、amqplib、aws-sdk、ioredis 配置。

## 6. 容量与性能验收起点

- **质量门（CI，`.github/workflows/ci.yml`）**：Backend = postgres 服务上 typecheck → migration:run → 全量测试 → build；Web = typecheck → lint → 测试 → build → 渲染冒烟；另有 gitleaks 密钥扫描与凭据回归检查。本地等价命令见 README「验证」。
- **上传吞吐**：单文件 ≤2 GiB、分片 16 MiB、浏览器并发 3 分片、预签名 15 分钟；瓶颈通常在 MinIO/磁盘，验收时记录分片上传耗时与失败率。
- **媒体处理**：默认 AI 质检并发 3（`AI_QUALITY_CONCURRENCY`）、标注并发 1（`AI_ANNOTATION_CONCURRENCY`）、媒体任务超时 600s。FFmpeg 转码/抽帧是 CPU 密集段，按真实样例测量单条耗时后确定 worker 数量——**待运维负责人**以 3–6 条代表视频在验收环境实测并记录数字。
- **对象存储容量**：默认保留 180 天（`SUBMISSION_OBJECT_RETENTION_DAYS`，0=不设到期）；日增量 ≈ 上传总量 + 预览/切片产物。按业务上传速率估算 MinIO 卷容量与磁盘水位，**待运维负责人**给出告警阈值与扩容流程。
- **已知缺口**（代码核对结论）：仓库暂无 Prometheus/日志聚合/外部告警配置，见第 8 节。

## 7. 告警起点

以下为仓库内已有的事实信号源，接入外部通知渠道的方式**待运维负责人**：

1. **探活**：`/api/v1/health/ready` 与 `docker compose ps`（restart 计数突增说明反复崩溃）。
2. **队列健康**：RabbitMQ 管理台（15672）与 `operations` 管理 API（队列快照、Worker 心跳、运行过久任务）；各业务队列配套 retry/dead 队列（拓扑见 `backend/src/messaging/rabbitmq-topology.ts`），**死信消息不会自动消失，需人工处置并留痕**。
3. **宿主机资源**：swap 使用率（`scripts/dev-health.sh` 的阈值逻辑可直接复用）、磁盘水位（对象卷 + 数据库卷）。
4. **进程异常**：api 容器线程/内存持续增长（基线参考第 5 节）。
5. **模型链路**：AI 任务失败/重试计数与 Operations 页面告警项（运行过久任务）；模型调用账本（失败调用、token 未报告）可从运营视图核对。

## 8. 上线前开放项（决策清单）

- [ ] 域名与 TLS：gateway 目前仅 HTTP；若公网 HTTPS 由外部终止，需按 `TRUST_PROXY_HOPS` 与 `COOKIE_SECURE` 语义核对转发头与安全 Cookie（`deploy/prepare-production-env.sh` 默认写 `COOKIE_SECURE=false`、`TRUST_PROXY_HOPS=1`）。
- [ ] `WEB_ORIGIN` 设为正式域名；跨域/Cookie SameSite 行为以生产域名复测登录与上传。
- [ ] Qwen/百炼 Key 上线前轮换（见第 2 节）。
- [ ] 自动准入默认开启（`ANNOTATION_AUTO_ACCEPT_ENABLED=true`）与审计抽检率默认 0（`ANNOTATION_AUTO_ACCEPT_AUDIT_RATE=0`）为产品决策；正式运营建议启用非零抽检率并定期核对误放。
- [ ] 发布负责人与值班联系人；发布检查清单（下节）逐项签字。
- [ ] 备份恢复演练记录、容量告警阈值、监控通知渠道。

## 9. 发布检查清单（示例模板）

发布前：

- [ ] release SHA 冻结：`EVDP_RELEASE_VERSION`/`EVDP_GIT_SHA`/`EVDP_BUILD_TIME` 已记录，镜像已构建并 digest 固定
- [ ] 迁移 head 已记录，回滚预案（保留 Schema 回退镜像）已确认
- [ ] 备份已执行且恢复演练通过（至少 SQL + 对象各一次）
- [ ] `.env` 已用 `deploy/prepare-production-env.sh` 准备，无本地默认口令（api 以 `EVDP_ALLOW_LOCAL_DEFAULT_PASSWORDS=false` 启动验证）
- [ ] Qwen 凭据已轮换；gitleaks/凭据回归 CI 全绿

发布后（1 小时内）：

- [ ] `GET /api/v1/health/version` 回读版本与发布记录一致；`/ready` 通过
- [ ] 登录（管理员/团长/采集员各一）、任务大厅、上传一条真实视频走通「上传 → 媒体 → 质检 → 切片/标注」冒烟
- [ ] 各 worker 消费者在线（Media/QC/Annotation 队列各有消费者，勿只凭 ready 判定）
- [ ] 审计日志抽查：发布后关键写操作留痕正常
- [ ] Rabbit 死信队列深度为 0；磁盘/swap 水位正常
