"use client";
import { useEffect, useState } from "react";
import { listWithdrawals } from "./client/walletApi";
import { shanghaiTime, withdrawalLabels, type WithdrawalList } from "./contracts";

export function WithdrawalHistory({ revision = 0 }: { revision?: number }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ page: number; revision: number; data: WithdrawalList | null; error: string } | null>(null);
  const current = result?.page === page && result.revision === revision ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? "";
  useEffect(() => {
    let active = true;
    listWithdrawals({ page })
      .then(data => { if (active) setResult({ page, revision, data, error: "" }); })
      .catch(() => { if (active) setResult({ page, revision, data: null, error: "提现申请读取失败，请刷新重试" }); });
    return () => { active = false; };
  }, [page, revision]);
  return <section className="content-card table-card">
    <div className="card-heading"><h2>提现申请记录</h2></div>
    <p>处理中、等待复核和结果待查的金额继续预留。人工确认付款不是银行到账验证；如实际收款有疑问，请联系管理员核对。</p>
    {error ? <p role="alert">{error}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>申请 / 时间</th><th>收款信息（脱敏）</th><th>金额</th><th>状态</th><th>结果</th></tr></thead><tbody>
      {data?.requests.map(row => <tr key={row.id}><td>{row.id}<small className="row-sub">{shanghaiTime(row.createdAt)}</small></td><td>{row.method === "bank" ? "银行账户" : "支付宝"} {row.accountMasked} / {row.nameMasked}</td><td>{row.amount.toFixed(2)} 元</td><td>{withdrawalLabels[row.status]}</td><td>{row.status === "paid" ? `平台已人工确认付款${row.paidAt ? `，登记的转账时间 ${shanghaiTime(row.paidAt)}` : ""}；不代表银行到账验证` : row.status === "review_pending" ? "转账已登记，等待复核；资金继续预留" : row.status === "investigating" ? "结果正在核查；资金继续预留，请勿重复申请" : row.status === "failed" || row.status === "rejected" ? "预留金额已退回可提现余额" : "等待人工处理"}</td></tr>)}
      {data?.requests.length === 0 && <tr><td colSpan={5}>暂无提现申请</td></tr>}
    </tbody></table></div>}
    <div className="card-heading"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {data?.pagination.totalPages ?? 1} 页</span><button type="button" disabled={!data || page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>下一页</button></div>
  </section>;
}
