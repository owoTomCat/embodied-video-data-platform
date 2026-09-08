"use client";
import { useEffect, useRef, useState } from "react";
import { confirmPayout, listPayouts } from "../../wallet/client/walletApi";
import { shanghaiTime, withdrawalLabels, type PayoutList, type PayoutRequest, type PayoutStatus } from "../../wallet/contracts";

const tabs = { unpaid: "待打款", paid: "已打款", all: "全部" } as const;
export function WithdrawalsPage() {
  const [status, setStatus] = useState<PayoutStatus>("unpaid");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data: PayoutList | null; error: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const key = JSON.stringify([page, status, q, revision]);
  const data = result?.key === key ? result.data : null;
  const error = result?.key === key ? result.error : "";
  useEffect(() => {
    let active = true;
    listPayouts({ page, pageSize: 20, status, q }).then(data => {
      if (!active) return;
      if (page > Math.max(1, data.pagination.totalPages)) { setPage(Math.max(1, data.pagination.totalPages)); return; }
      setResult({ key, data, error: "" });
    }).catch(error => { if (active) setResult({ key, data: null, error: error instanceof Error ? error.message : "列表读取失败" }); });
    return () => { active = false; };
  }, [key, page, status, q, revision]);
  async function confirm(row: PayoutRequest) {
    if (pending.current || ["paid", "rejected", "failed"].includes(row.status)) return;
    pending.current = true;
    setBusy(row.id); setActionError(""); setMessage("");
    try {
      const { request } = await confirmPayout(row.id);
      setResult(current => current?.key === key && current.data ? { ...current, data: { ...current.data, requests: current.data.requests.map(item => item.id === request.id ? request : item) } } : current);
      setMessage(`${request.ownerName ?? request.ownerId} · ${request.amount.toFixed(2)} 元已记为已打款 · ${request.confirmedByName ?? request.confirmedById ?? "历史记录未记录账号"}${request.confirmedAt ? ` · ${shanghaiTime(request.confirmedAt)}` : ""}`);
      setRevision(value => value + 1);
    } catch (error) { setActionError(error instanceof Error ? error.message : "确认失败，请重试"); }
    finally { pending.current = false; setBusy(null); }
  }
  async function copyAccount(row: PayoutRequest) {
    setActionError(""); setMessage("");
    try { await navigator.clipboard.writeText(row.recipient.account); setMessage(`${row.id} 收款账号已复制，请核对收款人和金额。`); }
    catch { setActionError("复制失败，请手动选择并复制表格中的收款账号。"); }
  }
  return <div className="page-stack">
    <div className="page-heading"><div><p className="page-kicker">管理员财务</p><h1>提现打款</h1><span>先自行转账，完成后勾选；平台仅记录人工确认，不发起支付，也不验证银行到账。</span></div></div>
    <section className="content-card table-card">
      <p>完整收款资料仅供管理员打款使用，访问会记录审计，请勿外传。勾选时间是平台记录时间，不是银行转账时间；已打款不能取消。</p>
      <div className="filter-bar"><div className="segmented-control" aria-label="打款状态">{Object.entries(tabs).map(([value, label]) => <button type="button" key={value} className={status === value ? "active" : undefined} aria-pressed={status === value} disabled={busy !== null} onClick={() => { setStatus(value as PayoutStatus); setPage(1); }}>{label}</button>)}</div></div>
      <form className="filter-bar modal-form wallet-withdraw-form" onSubmit={event => { event.preventDefault(); setQ(search.trim()); setPage(1); setRevision(value => value + 1); }}>
        <label>搜索申请 / 用户 / 姓名 / 团队<input value={search} onChange={event => setSearch(event.target.value)} /></label>
        <button type="submit" className="button button-secondary" disabled={busy !== null}>搜索</button>
        <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => setRevision(value => value + 1)}>刷新</button>
      </form>
      {message && <p role="status">{message}</p>}{actionError && <p role="alert">{actionError}</p>}
      {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">正在读取申请…</p>}
      <div className="table-scroll"><table className="data-table payout-table"><thead><tr><th>申请人 / 团队</th><th>收款人姓名</th><th>渠道</th><th>完整收款账号</th><th>银行</th><th>金额</th><th>申请时间</th>{status !== "unpaid" && <><th>勾选管理员</th><th>勾选时间（平台记录）</th></>}<th className="payout-check">已打款</th></tr></thead><tbody>{data?.requests.map(row => <tr key={row.id}>
        <td title={`申请号：${row.id}`}><strong>{row.ownerName ?? row.ownerId}</strong><small className="row-sub">{row.teamName ?? "未分配团队"}</small><small className="row-sub">{row.ownerId}</small></td>
        <td>{row.recipient.name}</td><td>{row.recipient.method === "bank" ? "银行卡" : "支付宝"}</td>
        <td><span className="payout-account">{row.recipient.account}</span><div><button type="button" className="table-action" aria-label={`复制收款账号 ${row.id}`} onClick={() => void copyAccount(row)}>复制账号</button></div></td>
        <td>{row.recipient.bankName || "—"}</td><td>{row.amount.toFixed(2)} 元</td><td>{shanghaiTime(row.createdAt)}</td>
        {status !== "unpaid" && <><td>{row.confirmedByName ?? row.confirmedById ?? "—"}{row.confirmedByName && row.confirmedById && <small className="row-sub">{row.confirmedById}</small>}</td><td>{row.confirmedAt ? shanghaiTime(row.confirmedAt) : "—"}</td></>}
        <td className="payout-check"><input type="checkbox" aria-label={`已打款 ${row.id}`} checked={row.status === "paid"} disabled={busy !== null || ["paid", "rejected", "failed"].includes(row.status)} onChange={() => void confirm(row)} /><small className="row-sub">{busy === row.id ? "正在记录…" : withdrawalLabels[row.status]}</small></td>
      </tr>)}{data?.requests.length === 0 && <tr><td colSpan={status === "unpaid" ? 8 : 10}>暂无匹配申请</td></tr>}</tbody></table></div>
      <div className="card-heading"><button type="button" className="button button-secondary" disabled={busy !== null || !data || page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {Math.max(1, data?.pagination.totalPages ?? 1)} 页，共 {data?.pagination.total ?? 0} 条</span><button type="button" className="button button-secondary" disabled={busy !== null || !data || page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>下一页</button></div>
    </section>
  </div>;
}
