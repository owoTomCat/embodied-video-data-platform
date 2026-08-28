#!/usr/bin/env bash
#
# 本地开发环境健康自愈脚本
#
# 背景：api 容器（NestJS）长期运行后可能出现 Node 句柄/线程泄漏，
# 最终事件循环挂死；叠加 Docker Desktop for Mac 的已知 bug（进程冻结后
# daemon 无法 kill，见 docker/for-mac #6850/#7816），只能重启 Docker Desktop。
#
# 本脚本作为兜底：定时探测 api 健康端点，连续失败达到阈值时自动重启容器；
# 若 Docker daemon 本身卡死，则给出人工操作指引。
#
# 用法：
#   scripts/dev-health.sh                 # 检查一次并自愈
#   scripts/dev-health.sh --check-only    # 只检查不重启
#   scripts/dev-health.sh --cron          # 适合 cron 的静默模式（有异常才输出）
#
# 建议配合 cron/launchd 每 2~5 分钟执行一次，例如：
#   */2 * * * * cd /Users/edy/Desktop/Cdoe/Data-Platform && ./scripts/dev-health.sh --cron >> /tmp/dev-health.log 2>&1

set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_HEALTH_URL="http://127.0.0.1:4000/api/v1/health/ready"
API_CONTAINER="evdp-api-1"
MAX_FAILURES=3           # 连续失败多少次后重启容器
FAIL_INTERVAL_SECONDS=10 # 两次探测之间的间隔（秒）
CURL_TIMEOUT=5

MODE="${1:-check}"
CHECK_ONLY=0
QUIET=0
case "$MODE" in
  --check-only) CHECK_ONLY=1 ;;
  --cron) QUIET=1 ;;
esac

log() { [ "$QUIET" -eq 1 ] || echo "[dev-health] $*"; }
warn() { echo "[dev-health] ⚠ $*"; }

# 1. Docker daemon 是否响应
if ! docker ps >/dev/null 2>&1; then
  warn "Docker daemon 无响应。请重启 Docker Desktop（菜单栏鲸鱼图标 → Restart），然后执行 docker compose up -d"
  exit 2
fi

# 2. api 容器是否存在/运行
STATE=$(docker inspect -f '{{.State.Status}}' "$API_CONTAINER" 2>/dev/null || echo "missing")
if [ "$STATE" != "running" ]; then
  if [ "$CHECK_ONLY" -eq 1 ]; then
    warn "api 容器状态异常：$STATE（未自动重启，请手动处理）"
    exit 1
  fi
  warn "api 容器状态：$STATE，尝试拉起…"
  docker compose -f "$PROJECT_DIR/compose.yaml" up -d api
  sleep 5
fi

# 3. 探测 api 健康端点，连续失败达阈值则重启容器
failures=0
for i in $(seq 1 "$MAX_FAILURES"); do
  if curl -sf -m "$CURL_TIMEOUT" -o /dev/null "$API_HEALTH_URL" 2>/dev/null; then
    failures=0
  else
    failures=$((failures + 1))
    log "api 健康检查失败（$failures/$MAX_FAILURES）"
    [ "$i" -lt "$MAX_FAILURES" ] && sleep "$FAIL_INTERVAL_SECONDS"
  fi
done

if [ "$failures" -ge "$MAX_FAILURES" ]; then
  warn "api 连续 ${failures} 次健康检查失败"
  if [ "$CHECK_ONLY" -eq 1 ]; then
    warn "已跳过自动重启（--check-only），请手动执行：docker compose restart api"
    exit 1
  fi
  warn "自动重启 api 容器…"
  if docker compose -f "$PROJECT_DIR/compose.yaml" restart api >/dev/null 2>&1; then
    sleep 8
    if curl -sf -m "$CURL_TIMEOUT" -o /dev/null "$API_HEALTH_URL" 2>/dev/null; then
      log "api 已恢复"
    else
      warn "重启后 api 仍无响应，可能需要重启 Docker Desktop"
      exit 3
    fi
  else
    warn "docker compose restart 失败（daemon 可能已卡死）。请重启 Docker Desktop，然后执行 docker compose up -d"
    exit 4
  fi
else
  log "api 健康（连续 ${failures} 次失败后恢复/无失败）"
fi

# 4. 汇总容器状态（异常时输出；ai-quality-lab 是 --profile ai-test 可选服务，正常应为停止）
BROKEN=$(docker ps -a --format '{{.Names}} {{.Status}}' \
  | grep evdp \
  | grep -v "evdp-ai-quality-lab-1" \
  | grep -vE "Up|Exited \(0\)" || true)
if [ -n "$BROKEN" ]; then
  warn "以下容器状态异常："
  echo "$BROKEN" | while IFS= read -r line; do warn "  $line"; done
  exit 1
fi

log "全部服务正常"
exit 0
