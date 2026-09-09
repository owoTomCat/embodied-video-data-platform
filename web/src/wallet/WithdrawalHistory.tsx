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
    <p>待打款金额继续预留。管理员自行转账后在平台勾选确认；人工确认已打款不代表银行到账验证，如收款有疑问请联系管理员。</p>
    {error ? <p role="alert">{error}</p> : <div className="table-scroll"><table className="data-table"><thead><tr><th>申请 / 时间</th><th>收款信息（脱敏）</th><th>金额</th><th>状态</th><th>结果</th></tr></thead><tbody>
      {data?.requests.map(row => <tr key={row.id}><td>{row.id}<small className="row-sub">{shanghaiTime(row.createdAt)}</small></td><td>{row.method === "bank" ? "银行账户" : "支付宝"} {row.accountMasked} / {row.nameMasked}</td><td>{row.amount.toFixed(2)} 元</td><td>{withdrawalLabels[row.status]}</td><td>{row.status === "paid" ? "管理员已在平台勾选确认打款；不代表银行到账验证" : row.status === "failed" || row.status === "rejected" ? "预留金额已退回可提现余额" : "等待管理员打款并勾选确认，金额继续预留"}</td></tr>)}
      {data?.requests.length === 0 && <tr><td colSpan={5}>暂无提现申请</td></tr>}
    </tbody></table></div>}
    <div className="card-heading"><button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {Math.max(1, data?.pagination.totalPages ?? 1)} 页</span><button type="button" className="button button-secondary" disabled={!data || page >= data.pagination.totalPages} onClick={() => setPage(page + 1)}>下一页</button></div>
  </section>;
}
