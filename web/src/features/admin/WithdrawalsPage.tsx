"use client";
import { useEffect, useRef, useState } from "react";
import { claimWithdrawals, exportWithdrawalBatch, getWithdrawalSummary, listWithdrawals, WalletApiError } from "../../wallet/client/walletApi";
import { shanghaiTime, withdrawalLabels, type WithdrawalList, type WithdrawalStatus, type WithdrawalSummary } from "../../wallet/contracts";
import { useIdentity } from "../../auth/client/IdentityContext";
import { WithdrawalDetailPanel } from "./WithdrawalDetailPanel";

const tabs = { pending: "待领取", mine: "我的处理中", review_pending: "待复核", investigating: "调查中", completed: "已完成" } as const;
export function WithdrawalsPage() {
  const { accounts, teams } = useIdentity();
  const [allProcessing, setAllProcessing] = useState(false);
  const [tab, setTab] = useState<keyof typeof tabs>("pending");
  const [completedStatus, setCompletedStatus] = useState<WithdrawalStatus>("paid");
  const [page, setPage] = useState(1);
  const [ownerId, setOwnerId] = useState("");
  const [ownerSearch, setOwnerSearch] = useState("");
  const [overdue, setOverdue] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data: WithdrawalList | null; error: string; loadedAt: number } | null>(null);
  const [summary, setSummary] = useState<WithdrawalSummary | null>(null);
  const [summaryError, setSummaryError] = useState("");
  const [selected, setSelected] = useState<{ key: string; ids: string[] } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [exportId, setExportId] = useState("");
  const status = tab === "completed" ? completedStatus : tab === "mine" ? "processing" : tab;
  const key = JSON.stringify([page, status, tab, ownerId, overdue, revision, allProcessing]);
  const data = result?.key === key ? result.data : null;
  const error = result?.key === key ? result.error : "";
  const selection = selected?.key === key ? selected.ids : [];
  useEffect(() => {
    let active = true;
    listWithdrawals({ page, status, scope: tab === "mine" && !allProcessing ? "mine" : undefined, ownerId: ownerId || undefined, overdue: overdue || undefined }).then(data => { if (active) setResult({ key, data, error: "", loadedAt: Date.now() }); }).catch(error => { if (active) setResult({ key, data: null, error: error instanceof Error ? error.message : "列表读取失败", loadedAt: Date.now() }); });
    return () => { active = false; };
  }, [key, page, status, tab, ownerId, overdue, revision, allProcessing]);
  useEffect(() => {
    let active = true;
    getWithdrawalSummary().then(value => { if (active) { setSummary(value); setSummaryError(""); } }).catch(error => { if (active) { setSummary(null); setSummaryError(error instanceof Error ? error.message : "统计读取失败"); } });
    return () => { active = false; };
  }, [revision]);
  async function claim() {
    if (busy || !selection.length) return;
    setBusy(true); setActionError(""); setMessage("");
    try { const value = await claimWithdrawals(selection); setExportId(value.batchId); setRevision(value => value + 1); setTab("mine"); setPage(1); setMessage("申请已领取到我的处理中。打开详情核对收款信息，无需导出 CSV。"); }
    catch (error) { if (error instanceof WalletApiError && error.status === 409) { setRevision(value => value + 1); setSelected(null); setActionError("申请状态已改变，已刷新列表。请重新选择，勿重复领取或转账。"); } else setActionError(error instanceof Error ? error.message : "领取失败"); }
    finally { setBusy(false); }
  }
  async function exportBatch() {
    if (busy || !exportId.trim() || !window.confirm("文件包含完整收款信息，下载会记录审计。导出不是付款，禁止重复转账；请妥善保管并在核对后安全删除。继续？")) return;
    setBusy(true); setActionError(""); setMessage("");
    try { const blob = await exportWithdrawalBatch(exportId.trim()); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "manual-payouts.csv"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage("已下载敏感文件，未改变付款状态。"); }
    catch (error) { setActionError(error instanceof Error ? error.message : "导出失败"); }
    finally { setBusy(false); }
  }
  const candidates = accounts.filter(account => `${account.id} ${account.displayName} ${teams.find(team => team.id === account.teamId)?.name ?? ""}`.toLowerCase().includes(ownerSearch.trim().toLowerCase()));
  return <div className="page-stack">
    <div className="page-heading"><div><p className="page-kicker">管理员财务</p><h1>人工提现工作台</h1><span>领取 → 核对收款信息 → 平台外转账 → 上传凭证并登记 → 复核</span></div></div>
    <section className="content-card"><h2>全局待办统计</h2><p>超过 24 小时：自提交起满 24 小时且仍待领取、处理中、待复核或调查中。不自动交接或退款；本平台不调用支付接口。</p>{summaryError && <p role="alert">{summaryError}</p>}{summary ? <div className="card-heading">{([ ["pending", "待领取"], ["processing", "处理中"], ["reviewPending", "待复核"], ["investigating", "调查中"], ["overdue", "超过24小时"] ] as const).map(([key, label]) => <div key={key}><h3>{label}</h3><p>{summary[key].count} 笔 · {summary[key].amount.toFixed(2)} 元</p></div>)}</div> : !summaryError && <p role="status">正在读取全局统计…</p>}</section>
    {message && <p role="status">{message}</p>}{actionError && <p role="alert">{actionError}</p>}
    <section className="content-card table-card">
      <div className="filter-bar"><div className="segmented-control" aria-label="提现工作队列">{Object.entries(tabs).map(([key, label]) => <button className={tab === key ? "active" : undefined} type="button" key={key} aria-pressed={tab === key} onClick={() => { setTab(key as keyof typeof tabs); setPage(1); }}>{label}</button>)}</div></div>
      <div className="filter-bar modal-form wallet-withdraw-form">
        {tab === "mine" && <label className="checkbox-field"><input type="checkbox" checked={allProcessing} onChange={event => { setAllProcessing(event.target.checked); setPage(1); }} />查看全部处理中（监督与交接）</label>}
        {tab === "completed" && <label>完成结果<select value={completedStatus} onChange={event => { setCompletedStatus(event.target.value as WithdrawalStatus); setPage(1); }}>{(["paid", "rejected", "failed"] as const).map(status => <option key={status} value={status}>{withdrawalLabels[status]}</option>)}</select></label>}
        <label>查找申请人（姓名 / 用户 ID / 团队）<input value={ownerSearch} onChange={event => setOwnerSearch(event.target.value)} /></label>
        <label>按申请人筛选<select value={ownerId} onChange={event => { setOwnerId(event.target.value); setPage(1); }}><option value="">全部申请人</option>{candidates.map(account => <option key={account.id} value={account.id}>{account.displayName} · {teams.find(team => team.id === account.teamId)?.name ?? "未分配团队"} · {account.id}</option>)}</select></label>
        <p>输入姓名或团队，选择要查看的申请人。</p>
        <label className="checkbox-field"><input type="checkbox" checked={overdue} onChange={event => { setOverdue(event.target.checked); setPage(1); }} />仅超过24小时</label>
        <button className="button button-secondary" onClick={() => setRevision(value => value + 1)}>刷新</button>
      </div>
      {tab === "pending" && <button className="button button-primary" disabled={busy || !selection.length} onClick={claim}>领取所选申请（{selection.length}）</button>}
      {error && <p role="alert">{error}</p>}{!data && !error && <p role="status">正在读取申请…</p>}
      <div className="table-scroll"><table className="data-table"><thead><tr><th>选择</th><th>申请 / 用户 / 团队</th><th>提交 / 等待时间</th><th>收款信息（脱敏）</th><th>金额</th><th>经办人 / 状态</th><th>操作</th></tr></thead><tbody>{data?.requests.map(row => <tr key={row.id}>
        <td><input type="checkbox" aria-label={`选择 ${row.id}`} disabled={busy || row.status !== "pending"} checked={selection.includes(row.id)} onChange={event => setSelected({ key, ids: event.target.checked ? [...selection, row.id] : selection.filter(id => id !== row.id) })} /></td>
        <td>{row.id}<small className="row-sub">{row.ownerName ?? row.ownerId} · {row.teamName ?? "未分配团队"}</small></td><td>{shanghaiTime(row.createdAt)}<small className="row-sub">{["paid", "rejected", "failed"].includes(row.status) ? "已结束" : `截至刷新已等待 ${Math.max(0, Math.floor(((result?.loadedAt ?? 0) - new Date(row.createdAt).getTime()) / 60000))} 分钟`}{row.overdue && " · 超过24小时"}</small></td>
        <td>{row.method === "bank" ? "银行账户" : "支付宝"} · {row.nameMasked} · {row.accountMasked}</td><td>{row.amount.toFixed(2)} 元</td><td>{row.assigneeName ?? "未分配"}<small className="row-sub">{withdrawalLabels[row.status]}{row.reviewMode === "single" ? " · 单人确认，非独立复核" : row.reviewMode === "legacy" ? " · 历史确认" : row.reviewMode === "independent" ? " · 独立复核" : ""}</small></td>
        <td><div className="row-actions"><button className="table-action" aria-label={`处理详情 ${row.id}`} onClick={event => { detailTrigger.current = event.currentTarget; setDetailId(row.id); }}>处理详情</button>{row.batchId && <button className="table-action" onClick={() => setExportId(row.batchId!)}>辅助导出</button>}</div></td>
      </tr>)}{data?.requests.length === 0 && <tr><td colSpan={7}>暂无匹配申请</td></tr>}</tbody></table></div>
      <div className="card-heading"><button className="button button-secondary" disabled={!data || page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {data?.pagination.totalPages ?? 1} 页，共 {data?.pagination.total ?? 0} 条</span><button className="button button-secondary" disabled={!data || page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>下一页</button></div>
    </section>
    <details className="content-card"><summary>辅助批次导出（可选，含敏感信息）</summary><p>不是必经步骤，不用于自动支付导入。完整收款信息会写入文件；重复导出必须按申请 ID 核对，禁止重复转账。account_text 单引号用于文本保护，人工核对时去掉首个标记；完成后安全删除文件。</p><label>导出批次 ID<input value={exportId} onChange={event => setExportId(event.target.value)} maxLength={64} /></label><button className="button button-secondary" disabled={busy || !exportId.trim()} onClick={exportBatch}>授权导出 / 重新导出</button></details>
    {detailId && <WithdrawalDetailPanel key={detailId} id={detailId} onClose={() => setDetailId(null)} onChanged={() => setRevision(value => value + 1)} returnFocusRef={detailTrigger} />}
  </div>;
}
