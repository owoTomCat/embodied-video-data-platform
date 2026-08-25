"use client";

import {
  CalendarClock,
  CircleDollarSign,
  Download,
  LockKeyhole,
  Receipt,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import {
  listPointCycles,
  getPointRule,
  pointCycleExportUrl,
  previewPointCycle,
} from "../../points/client/pointCycleApi";
import type {
  BackendPointCycle,
  BackendPointCyclePreview,
  BackendPointRule,
} from "../../points/contracts";
import { PointRuleModal } from "./PointRuleModal";
import { SettlementConfirmModal } from "./SettlementConfirmModal";
import { CycleDetailModal } from "./CycleDetailModal";

function formatDate(value: string): string {
  return value;
}

export function SettlementPage() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [detailCycle, setDetailCycle] = useState<BackendPointCycle | null>(null);
  const [cycles, setCycles] = useState<BackendPointCycle[]>([]);
  const [preview, setPreview] = useState<BackendPointCyclePreview | null>(null);
  const [pointRule, setPointRule] = useState<BackendPointRule | null>(null);
  const [backendMode, setBackendMode] = useState<
    "loading" | "live" | "unavailable"
  >(
    "loading",
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ruleTriggerRef = useRef<HTMLButtonElement>(null);
  const lockedPoints = useMemo(
    () =>
      Math.round(
        cycles.reduce((total, cycle) => total + cycle.totalPoints, 0) * 100,
      ) / 100,
    [cycles],
  );
  const pendingPoints = preview?.totalPoints ?? 0;
  const pendingCount = preview?.submissionCount ?? 0;

  useEffect(() => {
    let active = true;
    Promise.all([listPointCycles(), previewPointCycle(), getPointRule()])
      .then(([nextCycles, nextPreview, nextRule]) => {
        if (!active) return;
        setCycles(nextCycles);
        setPreview(nextPreview);
        setPointRule(nextRule);
        setBackendMode("live");
      })
      .catch(() => {
        if (!active) return;
        setCycles([]);
        setPreview(null);
        setPointRule(null);
        setBackendMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  function handleCreated(cycle: BackendPointCycle) {
    setCycles((current) => [cycle, ...current]);
    setPreview({
      submissionCount: 0,
      effectiveDurationMs: 0,
      effectiveMinutes: 0,
      totalPoints: 0,
      teamSummaries: [],
    });
    setBackendMode("live");
  }

  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">积分规则与周期锁定</p><h1>积分规则</h1><span>平台默认积分、团队覆盖规则、质量系数与周期锁定批次</span></div><div className="page-heading-actions"><button ref={ruleTriggerRef} className="button button-secondary" disabled={backendMode === "unavailable"} onClick={() => setRuleOpen(true)}>发布积分规则</button><button ref={triggerRef} className="button button-primary" disabled={backendMode === "unavailable"} onClick={() => setConfirmOpen(true)}>生成积分周期</button></div></div>
      <div className="metric-grid"><MetricCard label="默认积分规则" value={pointRule ? `${pointRule.defaultPointsPerMinute.toLocaleString("zh-CN")} 分/分钟` : "—"} detail={pointRule ? `${pointRule.version} · V${pointRule.revision}` : backendMode === "loading" ? "正在读取" : "规则服务不可用"} icon={CircleDollarSign}/><MetricCard label="待锁定积分" value={`${pendingPoints.toLocaleString("zh-CN")} 分`} detail={`${pendingCount} 条数据`} icon={CalendarClock} tone="amber"/><MetricCard label="已锁定积分" value={`${lockedPoints.toLocaleString("zh-CN")} 分`} detail={`${cycles.length} 个周期`} icon={Receipt} tone="green"/><MetricCard label="锁定后调整" value="需留痕" detail="质量结果与积分变更进入审计" icon={LockKeyhole} tone="violet"/></div>
      <div className="audit-summary"><Receipt size={18}/><span><strong>{backendMode === "live" ? "积分周期数据已同步" : backendMode === "loading" ? "正在读取积分周期" : "积分服务暂不可用"}</strong><small>{backendMode === "live" ? "锁定后的周期进入结算，质量与积分变更全程留痕。" : backendMode === "loading" ? "页面会在接口返回后切换为真实数据。" : "数据服务暂不可用，请稍后重试。"}</small></span></div>
      <div className="dashboard-grid"><section className="content-card table-card"><div className="card-heading"><div><h2>积分周期</h2><p>按周期锁定有效时长和积分结果</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>周期</th><th>日期</th><th>视频数</th><th>有效时长</th><th>积分</th><th>状态</th><th/></tr></thead><tbody>{cycles.map((cycle) => <tr key={cycle.id}><td><strong>{cycle.id}</strong></td><td>{formatDate(cycle.businessDate)}</td><td>{cycle.submissionCount} 条</td><td>{cycle.effectiveMinutes} 分钟</td><td><strong>{cycle.totalPoints.toFixed(2)} 分</strong></td><td><StatusBadge label={cycle.status === "locked" ? "已锁定" : "处理中"} tone={cycle.status === "locked" ? "success" : "info"}/></td><td><span className="row-actions"><button className="table-action" onClick={() => setDetailCycle(cycle)}>查看条目</button><a className="table-action" href={pointCycleExportUrl(cycle.id)}><Download size={14}/>导出</a></span></td></tr>)}</tbody></table></div></section><aside className="content-card"><div className="card-heading"><div><h2>质量系数</h2><p>{pointRule ? pointRule.description : "最终评分对应积分倍率"}</p></div></div>{pointRule?.coefficientBands?.length ? <div className="coefficient-list">{pointRule.coefficientBands.map((band) => <div key={`${band.minScore}-${band.maxScore}`}><span>{band.minScore === 0 ? `低于 ${band.maxScore + 1} 分` : `${band.minScore} — ${band.maxScore} 分`}</span><strong>{band.ratio.toFixed(2)}</strong><em>{band.label}</em></div>)}</div> : <p className="form-message">积分规则暂不可用，无法展示质量系数。</p>}</aside></div>
      <SettlementConfirmModal open={confirmOpen} onClose={() => setConfirmOpen(false)} returnFocusRef={triggerRef} preview={preview} onCreated={handleCreated} />
      <PointRuleModal open={ruleOpen} currentRule={pointRule ?? undefined} onCreated={setPointRule} onClose={() => setRuleOpen(false)} returnFocusRef={ruleTriggerRef} />
      {detailCycle && <CycleDetailModal open cycle={detailCycle} onAdjusted={(nextCycle) => { setCycles((current) => current.map((entry) => entry.id === nextCycle.id ? nextCycle : entry)); setDetailCycle(nextCycle); }} onClose={() => setDetailCycle(null)} returnFocusRef={triggerRef} />}
    </div>
  );
}
