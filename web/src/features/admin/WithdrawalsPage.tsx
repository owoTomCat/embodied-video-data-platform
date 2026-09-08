"use client";

import { Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDollarSign, Copy, Inbox, Landmark, LoaderCircle, RefreshCw, Search, ShieldCheck, Wallet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { confirmPayout, listPayouts } from "../../wallet/client/walletApi";
import { shanghaiTime, withdrawalLabels, type PayoutList, type PayoutRequest, type PayoutStatus } from "../../wallet/contracts";

const tabs = { unpaid: "待打款", paid: "已打款", all: "全部" } as const;
const titles = { unpaid: "待打款申请", paid: "已打款记录", all: "全部提现记录" } as const;
const money = new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
const clock = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function PayoutTime({ value }: { value: string }) {
  const instant = new Date(value);
  return <time className="payout-time" dateTime={value} title={shanghaiTime(value)}><span>{date.format(instant)}</span><small>{clock.format(instant)} · 上海</small></time>;
}

export function WithdrawalsPage() {
  const [status, setStatus] = useState<PayoutStatus>("unpaid");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ viewKey: string; requestKey: string; data: PayoutList | null; error: string; loadedAt: number | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const viewKey = JSON.stringify([page, pageSize, status, q]);
  const requestKey = JSON.stringify([viewKey, revision]);
  const data = result?.viewKey === viewKey ? result.data : null;
  const error = result?.viewKey === viewKey ? result.error : "";
  const loading = result?.requestKey !== requestKey;
  const pageAmount = data?.requests.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
  const total = data?.pagination.total ?? 0;
  const totalPages = Math.max(1, data?.pagination.totalPages ?? 1);

  useEffect(() => {
    let active = true;
    listPayouts({ page, pageSize, status, q }).then(data => {
      if (!active) return;
      if (page > Math.max(1, data.pagination.totalPages)) { setPage(Math.max(1, data.pagination.totalPages)); return; }
      setResult({ viewKey, requestKey, data, error: "", loadedAt: Date.now() });
    }).catch(error => {
      if (active) setResult(current => ({ viewKey, requestKey, data: current?.viewKey === viewKey ? current.data : null, error: error instanceof Error ? error.message : "列表读取失败", loadedAt: current?.viewKey === viewKey ? current.loadedAt : null }));
    });
    return () => { active = false; };
  }, [viewKey, requestKey, page, pageSize, status, q]);

  function clearSearch() { setSearch(""); setQ(""); setPage(1); }
  async function confirm(row: PayoutRequest) {
    if (pending.current || loading || error || ["paid", "rejected", "failed"].includes(row.status)) return;
    pending.current = true;
    setBusy(row.id); setActionError(""); setMessage(""); setConfirmed(false);
    try {
      const { request } = await confirmPayout(row.id);
      setResult(current => current?.viewKey === viewKey && current.data ? { ...current, data: { ...current.data, requests: current.data.requests.map(item => item.id === request.id ? request : item) } } : current);
      setMessage(`${request.ownerName ?? request.ownerId} · ¥${money.format(request.amount)} 已记录为已打款，由 ${request.confirmedByName ?? request.confirmedById ?? "历史记录账号"} 确认。`);
      setConfirmed(true);
      setRevision(value => value + 1);
    } catch (error) { setActionError(error instanceof Error ? error.message : "暂时无法确认记录结果，请刷新核对，勿再次转账。"); }
    finally { pending.current = false; setBusy(null); }
  }
  async function copyAccount(row: PayoutRequest) {
    setActionError("");
    try { await navigator.clipboard.writeText(row.recipient.account); setCopiedId(row.id); setMessage(`${row.recipient.name} 的收款账号已复制。`); setConfirmed(false); }
    catch { setActionError("复制失败，请手动选择并复制表格中的收款账号。"); }
  }

  return <div className="page-stack payout-page">
    <div className="page-heading payout-heading">
      <div className="payout-heading-title"><span className="payout-heading-icon"><CircleDollarSign size={25} aria-hidden="true" /></span><div><p className="page-kicker">财务管理</p><h1>提现打款</h1><span>核对收款资料，线下转账后勾选已打款。</span></div></div>
      <span className="payout-security"><ShieldCheck size={15} aria-hidden="true" />管理员专属 · 操作留痕</span>
    </div>

    {message && <div className="payout-feedback payout-feedback-success" role="status"><CheckCircle2 size={18} aria-hidden="true" /><span>{message}</span>{confirmed && status !== "paid" && <button type="button" className="table-action" disabled={busy !== null} onClick={() => { setStatus("paid"); setPage(1); }}>查看已打款</button>}<button type="button" className="payout-dismiss" aria-label="关闭操作提示" onClick={() => setMessage("")}><X size={16} aria-hidden="true" /></button></div>}
    {actionError && <div className="payout-feedback payout-feedback-error" role="alert"><span>{actionError}</span><button type="button" className="payout-dismiss" aria-label="关闭错误提示" onClick={() => setActionError("")}><X size={16} aria-hidden="true" /></button></div>}

    <section className="content-card table-card payout-card" aria-label="提现申请">
      <div className="payout-card-heading"><div><h2>{titles[status]} <span className="payout-count">{data ? `${total} 笔` : "—"}</span></h2><p>{status === "paid" ? "每笔记录保留首次勾选的管理员账号与时间。" : status === "unpaid" ? "请先完成实际转账，再在对应申请右侧勾选。" : "集中查看提现申请与人工打款记录。"}</p></div><div className="payout-refresh"><span>{data && result?.loadedAt ? `更新于 ${clock.format(result.loadedAt)}` : ""}</span><button type="button" className="button button-secondary" disabled={busy !== null || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} className={loading ? "payout-spinning" : undefined} aria-hidden="true" />刷新</button></div></div>
      <div className="payout-toolbar">
        <div className="segmented-control" aria-label="打款状态">{Object.entries(tabs).map(([value, label]) => <button type="button" key={value} className={status === value ? "active" : undefined} aria-pressed={status === value} disabled={busy !== null} onClick={() => { setStatus(value as PayoutStatus); setPage(1); }}>{label}</button>)}</div>
        <form className="payout-search" role="search" onSubmit={event => { event.preventDefault(); if (pending.current) return; setQ(search.trim()); setPage(1); setRevision(value => value + 1); }}>
          <label className="sr-only" htmlFor="payout-search">搜索申请 / 用户 / 姓名 / 团队</label><Search size={16} aria-hidden="true" /><input id="payout-search" placeholder="搜索申请人、团队或申请号" value={search} disabled={busy !== null} onChange={event => setSearch(event.target.value)} />
          {search && <button type="button" className="payout-search-clear" aria-label="清除搜索" disabled={busy !== null} onClick={clearSearch}><X size={15} aria-hidden="true" /></button>}<button type="submit" className="button button-primary" disabled={busy !== null}>搜索</button>
        </form>
      </div>
      {q && <div className="payout-filter-note">搜索结果 <span>“{q}”</span><button type="button" disabled={busy !== null} onClick={clearSearch}>清除筛选</button></div>}
      {error && <div className="payout-feedback payout-feedback-error" role="alert"><span>{error}。请刷新核对最新状态。</span><button type="button" className="button button-secondary" disabled={loading} onClick={() => setRevision(value => value + 1)}>重新加载</button></div>}
      {loading && <p className="payout-loading" role="status"><LoaderCircle size={15} className="payout-spinning" aria-hidden="true" />{data ? "正在更新列表…" : "正在读取申请…"}</p>}
      <div className="table-scroll payout-table-scroll"><table className={`data-table payout-table${status !== "unpaid" ? " payout-table-history" : ""}`} aria-busy={loading}>
        <caption className="sr-only">提现收款明细，金额单位为人民币</caption>
        <thead><tr><th scope="col">申请人 / 团队</th><th scope="col">收款人</th><th scope="col">收款账号 / 开户行</th><th scope="col" className="payout-amount">提现金额</th><th scope="col">申请时间</th>{status !== "unpaid" && <th scope="col">勾选记录</th>}<th scope="col" className="payout-check">打款确认</th></tr></thead>
        <tbody>{data?.requests.map(row => {
          const paid = row.status === "paid";
          const closed = ["rejected", "failed"].includes(row.status);
          return <tr key={row.id} className={paid ? "payout-row-paid" : undefined}>
            <td><strong className="payout-person">{row.ownerName ?? row.ownerId}</strong><span className="payout-secondary">{row.teamName ?? "未分配团队"} · {row.ownerId}</span><span className="payout-request-id" title={`申请号：${row.id}`}>{row.id}</span></td>
            <td><strong className="payout-recipient">{row.recipient.name}</strong><StatusBadge label={row.recipient.method === "bank" ? "银行卡" : "支付宝"} tone={row.recipient.method === "bank" ? "neutral" : "info"} /></td>
            <td><div className="payout-account-line"><span className="payout-account">{row.recipient.account}</span><button type="button" className={`table-action payout-copy${copiedId === row.id ? " is-copied" : ""}`} aria-label={`复制收款账号 ${row.id}`} onClick={() => void copyAccount(row)}>{copiedId === row.id ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}{copiedId === row.id ? "已复制" : "复制"}</button></div><span className="payout-bank">{row.recipient.method === "bank" ? <Landmark size={12} aria-hidden="true" /> : <Wallet size={12} aria-hidden="true" />}{row.recipient.method === "bank" ? row.recipient.bankName || "银行信息未记录" : "支付宝收款账号"}</span></td>
            <td className="payout-amount"><strong><small>¥</small>{money.format(row.amount)}</strong></td>
            <td><PayoutTime value={row.createdAt} /></td>
            {status !== "unpaid" && <td>{row.confirmedById || row.confirmedByName ? <><strong className="payout-recipient">{row.confirmedByName ?? row.confirmedById}</strong><span className="payout-secondary">{row.confirmedById}</span></> : <span className="payout-secondary">{row.confirmedAt ? "历史账号未记录" : "—"}</span>}{row.confirmedAt && <PayoutTime value={row.confirmedAt} />}</td>}
            <td className="payout-check"><label className={`payout-confirm${paid ? " is-paid" : ""}${closed ? " is-closed" : ""}`}><input type="checkbox" aria-label={`已打款 ${row.id}`} checked={paid} disabled={busy !== null || loading || !!error || paid || closed} onChange={() => void confirm(row)} /><span>{busy === row.id ? "记录中…" : paid ? "已打款" : closed ? "已关闭" : "标记已打款"}</span></label>{(closed || ["review_pending", "investigating"].includes(row.status)) && <small className="payout-row-note">{withdrawalLabels[row.status]}</small>}</td>
          </tr>;
        })}{data?.requests.length === 0 && !loading && <tr><td colSpan={status === "unpaid" ? 6 : 7}><div className="empty-state payout-empty"><Inbox size={32} aria-hidden="true" /><strong>暂无匹配申请</strong><span>{q ? "试试申请人姓名、团队或完整申请号。" : status === "unpaid" ? "用户提交提现后，申请会显示在这里。" : "完成打款后，可在这里查询操作记录。"}</span>{q && <button type="button" className="table-action" onClick={clearSearch}>查看全部申请人</button>}</div></td></tr>}</tbody>
      </table></div>
      <div className="payout-footer"><div className="payout-page-total"><span>本页申请金额</span><strong>{pageAmount === undefined ? "—" : `¥${money.format(pageAmount / 100)}`}</strong></div><div className="payout-pagination"><label>每页<select aria-label="每页条数" value={pageSize} disabled={busy !== null || loading} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{[20, 50, 100].map(size => <option key={size} value={size}>{size} 条</option>)}</select></label><span>{data ? `${total ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, total)} / ${total} 笔` : "—"}</span><button type="button" className="button button-secondary" aria-label="上一页" disabled={busy !== null || loading || !data || page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></button><span>{page} / {totalPages}</span><button type="button" className="button button-secondary" aria-label="下一页" disabled={busy !== null || loading || !data || page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight size={16} aria-hidden="true" /></button></div></div>
    </section>
    <p className="payout-footnote"><ShieldCheck size={14} aria-hidden="true" /><span>收款资料仅供管理员打款使用，请勿外传。勾选后不可取消；勾选时间为平台记录时间，不代表银行到账核验。</span></p>
  </div>;
}
