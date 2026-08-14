"use client";

import { CalendarClock, CircleDollarSign, LockKeyhole, Receipt } from "lucide-react";
import { useRef, useState } from "react";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import { useDemoStore } from "../../data/DemoStoreContext";
import { SettlementConfirmModal } from "./SettlementConfirmModal";

export function SettlementPage() {
  const { state } = useDemoStore();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">日结批次与定价</p><h1>价格与结算</h1><span>平台默认价、团队覆盖价、质量系数与每日锁定批次</span></div><button ref={triggerRef} className="button button-primary" onClick={() => setConfirmOpen(true)}>生成演示批次</button></div>
      <div className="metric-grid"><MetricCard label="平台默认单价" value="¥12/分钟" detail="按有效计费时长" icon={CircleDollarSign}/><MetricCard label="今日待结算" value="¥6,842" detail="168 条数据" icon={CalendarClock} tone="amber"/><MetricCard label="本月已结算" value="¥148,260" detail={`${state.settlements.length} 个批次`} icon={Receipt} tone="green"/><MetricCard label="锁定后调整" value="禁止" detail="质量结果不可修改" icon={LockKeyhole} tone="violet"/></div>
      <div className="dashboard-grid"><section className="content-card table-card"><div className="card-heading"><div><h2>结算批次</h2><p>每日锁定有效时长和应付金额</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>批次</th><th>日期</th><th>视频数</th><th>有效时长</th><th>金额</th><th>状态</th></tr></thead><tbody>{state.settlements.map((batch) => <tr key={batch.id}><td><strong>{batch.id}</strong></td><td>{batch.date}</td><td>{batch.submissionCount} 条</td><td>{batch.effectiveMinutes} 分钟</td><td><strong>¥{batch.amount.toFixed(2)}</strong></td><td><StatusBadge label={batch.status === "locked" ? "已锁定" : "处理中"} tone={batch.status === "locked" ? "success" : "info"}/></td></tr>)}</tbody></table></div></section><aside className="content-card"><div className="card-heading"><div><h2>质量系数</h2><p>最终评分对应计价倍率</p></div></div><div className="coefficient-list"><div><span>80 — 100 分</span><strong>1.00</strong><em>优质</em></div><div><span>60 — 79 分</span><strong>0.80</strong><em>标准</em></div><div><span>40 — 59 分</span><strong>0.60</strong><em>较低</em></div><div><span>低于 40 分</span><strong>0.40</strong><em>最低档</em></div><div><span>硬性否决</span><strong>0.00</strong><em>不结算</em></div></div></aside></div>
      <SettlementConfirmModal open={confirmOpen} onClose={() => setConfirmOpen(false)} returnFocusRef={triggerRef} />
    </div>
  );
}
