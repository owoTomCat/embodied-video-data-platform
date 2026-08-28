"use client";

import { CalendarDays, FileClock, Search, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  accountAuditExportUrl,
  searchAccountAudit,
} from "../../auth/client/accountApi";
import type {
  AccountAuditLog,
  AccountAuditPagination,
  KnownAccountAuditAction,
} from "../../auth/contracts";
import { useIdentity } from "../../auth/client/IdentityContext";

const PAGE_SIZE = 20;

type AuditRow = {
  id: string;
  createdAt: string;
  actor: string;
  action: string;
  actionCode: string;
  target: string;
  reason: string;
};

type ListMode = "loading" | "live" | "unavailable";

const accountActionLabels: Record<KnownAccountAuditAction, string> = {
  create: "创建账号",
  update: "更新账号",
  reset_password: "重置密码",
  change_password: "修改密码",
  enable: "启用账号",
  disable: "停用账号",
  delete: "删除账号",
  local_identity_reconcile: "本地账号校准",
  team_create: "创建团队",
  team_update: "更新团队",
  team_assign_leader: "指定团长",
  quality_review: "人工复核质量结果",
  ai_quality_rerun: "重跑 AI 质检",
  point_cycle_lock: "锁定结算周期",
  point_cycle_adjustment: "周期金额调整",
  delivery_package_create: "创建交付包",
  asset_quarantine: "敏感资产隔离",
  asset_release: "解除资产隔离",
  ai_quality_prompt_update: "更新 AI 提示词",
  quality_rule_publish: "发布质量规则",
  label_set_update: "更新标签体系",
  point_rule_publish: "发布单价规则",
  scene_pricing_update: "更新场景定价",
  public_site_snapshot_publish: "发布公开官网快照",
};

function accountActionLabel(action: string): string {
  return accountActionLabels[action as KnownAccountAuditAction] ?? "未知操作";
}

function formatCreatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(timestamp)
    .replaceAll("/", "-");
}

function accountLogToRow(log: AccountAuditLog): AuditRow {
  return {
    id: log.id,
    createdAt: formatCreatedAt(log.createdAt),
    actor: log.actorName,
    action: accountActionLabel(log.action),
    actionCode: log.action,
    target: log.targetName,
    reason: log.summary,
  };
}

export function AuditLogPage() {
  const { currentAccount } = useIdentity();
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<ListMode>("loading");
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [pagination, setPagination] = useState<AccountAuditPagination>({
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 1,
  });

  useEffect(() => {
    if (currentAccount.role !== "admin") return;
    let active = true;
    searchAccountAudit({
      q: query,
      actor,
      action,
      from,
      to,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((result) => {
        if (!active) return;
        setLogs(result.logs.map(accountLogToRow));
        setPagination(result.pagination);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setLogs([]);
        setPagination({ page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 1 });
        setMode("unavailable");
      });

    return () => {
      active = false;
    };
  }, [action, actor, currentAccount.role, from, page, query, to]);

  const range = useMemo(() => {
    if (pagination.total === 0) return "0";
    const start = (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(pagination.total, start + logs.length - 1);
    return `${start}-${end}`;
  }, [logs.length, pagination]);
  const exportUrl = useMemo(
    () => accountAuditExportUrl({ q: query, actor, action, from, to }),
    [action, actor, from, query, to],
  );

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">平台关键操作留痕</p>
          <h1>操作日志</h1>
          <span>记录质量调整、单价规则、结算周期锁定和用户管理动作</span>
        </div>
        {mode === "live" ? (
          <a className="button button-primary" href={exportUrl}>
            导出日志
          </a>
        ) : (
          <button
            className="button button-primary"
            type="button"
            disabled
            title="仅连接后端后可导出日志"
          >
            导出日志
          </button>
        )}
      </div>
      <div className="audit-summary">
        <ShieldCheck size={18} />
        <span>
          <strong>
            {mode === "live"
              ? "审计日志已连接后端筛选"
              : mode === "loading"
                ? "正在读取审计日志"
                : "审计日志服务不可用"}
          </strong>
          <small>
            {mode === "live"
              ? "账号、质检、金额和交付包关键动作均可按操作人、动作和时间追溯。"
              : mode === "loading"
                ? "页面会在接口返回后切换为真实数据。"
                : "数据服务暂不可用，请稍后重试。"}
          </small>
        </span>
      </div>
      <section className="content-card table-card">
        <div className="filter-bar audit-filter-bar">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="搜索"
              value={query}
              placeholder="搜索编号、动作、对象或说明"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="search-field">
            <UserRound size={16} />
            <input
              aria-label="操作人"
              value={actor}
              placeholder="操作人"
              onChange={(event) => {
                setActor(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            aria-label="动作筛选"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">全部动作</option>
            {Object.entries(accountActionLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="search-field audit-date-field">
            <CalendarDays size={16} />
            <input
              aria-label="开始日期"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="search-field audit-date-field">
            <CalendarDays size={16} />
            <input
              aria-label="结束日期"
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <div className="table-summary">
          <span>
            {mode === "live"
              ? `后端筛选 ${range} / ${pagination.total} 条`
              : mode === "loading"
                ? "正在读取后端数据"
                : "后端数据暂不可用"}
          </span>
          <span>
            第 {pagination.page} / {pagination.totalPages} 页
          </span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>动作</th>
                <th>对象</th>
                <th>原因 / 说明</th>
              </tr>
            </thead>
            <tbody>
              {logs.length ? (
                logs.map((log, index) => (
                  <tr key={`${log.id}-${index}`}>
                    <td>{log.createdAt}</td>
                    <td>
                      <strong>{log.actor}</strong>
                    </td>
                    <td>
                      <div className="action-cell">
                        <FileClock size={14} />
                        {log.action}
                      </div>
                    </td>
                    <td>{log.target}</td>
                    <td>{log.reason}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5}>暂无匹配日志</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-summary">
          <span>每页 {pagination.pageSize} 条</span>
          <span className="row-actions">
            <button
              className="table-action"
              disabled={pagination.page <= 1}
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              上一页
            </button>
            <button
              className="table-action"
              disabled={pagination.page >= pagination.totalPages}
              type="button"
              onClick={() =>
                setPage((current) =>
                  Math.min(pagination.totalPages, current + 1),
                )
              }
            >
              下一页
            </button>
          </span>
        </div>
      </section>
    </div>
  );
}
