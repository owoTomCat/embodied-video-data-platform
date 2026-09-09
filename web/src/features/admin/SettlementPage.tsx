"use client";

import {
  CircleDollarSign,
  Download,
  LockKeyhole,
  Plus,
  Receipt,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import {
  listPointCycles,
  getPointRule,
  pointCycleExportUrl,
} from "../../points/client/pointCycleApi";
import type {
  BackendPointCycle,
  BackendPointRule,
} from "../../points/contracts";
import { Modal } from "../../components/Modal";
import { listWallets } from "../../wallet/client/walletApi";
import type { WalletBalance } from "../../wallet/contracts";
import {
  createSceneCategoryPrice,
  deleteSceneCategoryPrice,
  listSceneCategoryPricing,
  updateSceneCategoryPrice,
} from "../../scene-pricing/client/scenePricingApi";
import type { SceneCategoryPricing } from "../../scene-pricing/contracts";
import { useInteractions } from "../../interactions/InteractionContext";
import { PointRuleModal } from "./PointRuleModal";
import { WalletDetailModal } from "./WalletDetailModal";
import { WalletStatsSection } from "./WalletStatsSection";
import { CycleDetailModal } from "./CycleDetailModal";

function formatDate(value: string): string {
  return value;
}

function formatSettleTime(timestamp: number | null): string {
  if (timestamp === null) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

export function SettlementPage({ navigate }: { navigate(path: string): void }) {
  const { notify } = useInteractions();
  const [ruleOpen, setRuleOpen] = useState(false);
  const [detailCycle, setDetailCycle] = useState<BackendPointCycle | null>(null);
  const [detailMember, setDetailMember] = useState<WalletBalance | null>(null);
  const [cycles, setCycles] = useState<BackendPointCycle[]>([]);
  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [pointRule, setPointRule] = useState<BackendPointRule | null>(null);
  const [categories, setCategories] = useState<SceneCategoryPricing[]>([]);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [savingPriceKey, setSavingPriceKey] = useState<string>();
  const [backendMode, setBackendMode] = useState<
    "loading" | "live" | "unavailable"
  >(
    "loading",
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ruleTriggerRef = useRef<HTMLButtonElement>(null);
  const lockedAmount = useMemo(
    () =>
      Math.round(
        cycles
          .filter((cycle) => cycle.status === "locked")
          .reduce((total, cycle) => total + cycle.totalPoints, 0) * 100,
      ) / 100,
    [cycles],
  );
  const totalWallet = useMemo(
    () => wallets.reduce((total, item) => total + item.totalBalance, 0),
    [wallets],
  );

  useEffect(() => {
    let active = true;
    Promise.all([
      listPointCycles(),
      getPointRule(),
      listWallets(),
      listSceneCategoryPricing(),
    ])
      .then(([nextCycles, nextRule, nextWallets, nextCategories]) => {
        if (!active) return;
        setCycles(nextCycles);
        setPointRule(nextRule);
        setWallets(nextWallets);
        setCategories(nextCategories);
        setBackendMode("live");
      })
      .catch(() => {
        if (!active) return;
        setCycles([]);
        setPointRule(null);
        setWallets([]);
        setBackendMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleSavePrice(key: string) {
    const raw = priceEdits[key]?.trim() ?? "";
    const parsed = Number(raw);
    if (raw === "" || !Number.isFinite(parsed)) {
      notify("error", "请输入有效的每小时单价");
      return;
    }
    if (parsed < 20 || parsed > 40) {
      notify("error", "场景单价范围：20 ~ 40 元/小时（家庭最低，上限 40）");
      return;
    }
    setSavingPriceKey(key);
    try {
      const next = await updateSceneCategoryPrice(key, { pricePerHour: parsed });
      setCategories((current) =>
        current.map((item) => (item.categoryKey === key ? next : item)),
      );
      setPriceEdits((current) => {
        const rest = { ...current };
        delete rest[key];
        return rest;
      });
      notify("success", `已更新「${next.name}」单价为 ${next.pricePerHour.toFixed(2)} 元/小时`);
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "保存失败，请重试");
    } finally {
      setSavingPriceKey(undefined);
    }
  }

  const [createCatOpen, setCreateCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatPrice, setNewCatPrice] = useState("20");
  const [savingCat, setSavingCat] = useState(false);
  const [deletingCatKey, setDeletingCatKey] = useState<string>();

  async function handleCreateCategory() {
    const name = newCatName.trim();
    const parsed = Number(newCatPrice);
    if (!name) {
      notify("error", "请填写大类名称");
      return;
    }
    if (!Number.isFinite(parsed) || parsed < 20 || parsed > 40) {
      notify("error", "场景单价范围：20 ~ 40 元/小时");
      return;
    }
    setSavingCat(true);
    try {
      const next = await createSceneCategoryPrice({
        name,
        pricePerHour: parsed,
      });
      setCategories((current) => [...current, next]);
      setCreateCatOpen(false);
      setNewCatName("");
      setNewCatPrice("20");
      notify("success", `已新增计费大类「${next.name}」（${next.pricePerHour.toFixed(2)} 元/小时）`);
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "新增失败，请重试");
    } finally {
      setSavingCat(false);
    }
  }

  async function handleDeleteCategory(categoryKey: string) {
    if (!window.confirm("确认删除该计费大类？若仍被场景/场景库/任务引用将无法删除。")) {
      return;
    }
    setDeletingCatKey(categoryKey);
    try {
      await deleteSceneCategoryPrice(categoryKey);
      setCategories((current) => current.filter((item) => item.categoryKey !== categoryKey));
      notify("success", "计费大类已删除");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "删除失败，请重试");
    } finally {
      setDeletingCatKey(undefined);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">质检通过入账 → 次日可提现</p><h1>结算与钱包</h1><span>质检通过且符合计费条件即进入结算中；北京时间次日02:00自动转为可提现，非满24小时</span></div><div className="page-heading-actions"><button ref={ruleTriggerRef} className="button button-secondary" disabled={backendMode === "unavailable"} onClick={() => setRuleOpen(true)}>发布单价规则</button></div></div>
      <div className="metric-grid"><MetricCard label="默认单价" value={pointRule ? `${pointRule.defaultPointsPerMinute.toLocaleString("zh-CN")} 元/小时` : "—"} detail={pointRule ? `${pointRule.version} · V${pointRule.revision}` : backendMode === "loading" ? "正在读取" : "规则服务不可用"} icon={CircleDollarSign}/><MetricCard label="结算中金额" value={`${lockedAmount.toLocaleString("zh-CN")} 元`} detail={`${cycles.filter((cycle) => cycle.status === "locked").length} 个周期结算中`} icon={LockKeyhole} tone="violet"/><MetricCard label="钱包总余额" value={`${totalWallet.toLocaleString("zh-CN")} 元`} detail={`${wallets.length} 个数采人员`} icon={Wallet} tone="green"/></div>
      <div className="audit-summary"><Receipt size={18}/><span><strong>{backendMode === "live" ? "结算周期数据已同步" : backendMode === "loading" ? "正在读取结算周期" : "结算服务暂不可用"}</strong><small>{backendMode === "live" ? "无需人工生成或结算；服务启动时补记符合条件的历史收益，并每分钟补结算已到期金额。实际提现付款仍由财务处理。" : backendMode === "loading" ? "页面会在接口返回后切换为真实数据。" : "数据服务暂不可用，请稍后重试。"}</small></span></div>
      <div className="dashboard-grid"><section className="content-card table-card"><div className="card-heading"><div><h2>结算周期</h2><p>按日汇总自动入账的视频及金额，保留条目和导出作为财务凭证</p></div></div><div className="table-scroll"><table className="data-table"><thead><tr><th>周期</th><th>日期</th><th>视频数</th><th>有效时长</th><th>金额</th><th>状态</th><th>结算时间（北京时间）</th><th/></tr></thead><tbody>{cycles.map((cycle) => <tr key={cycle.id}><td><strong>{cycle.id}</strong></td><td>{formatDate(cycle.businessDate)}</td><td>{cycle.submissionCount} 条</td><td>{cycle.effectiveMinutes} 分钟</td><td><strong>{cycle.totalPoints.toFixed(2)} 元</strong></td><td><StatusBadge label={cycle.status === "locked" ? "结算中" : "已结算"} tone={cycle.status === "locked" ? "info" : "success"}/></td><td className="nowrap-cell">{cycle.status === "locked" ? `预计 ${formatSettleTime(cycle.settleDueAt)}` : `已结算 ${formatSettleTime(cycle.settledAt)}`}</td><td><span className="row-actions"><button className="table-action" onClick={(event) => { triggerRef.current = event.currentTarget; setDetailCycle(cycle); }}>查看条目</button><a className="table-action" href={pointCycleExportUrl(cycle.id)}><Download size={14}/>导出</a></span></td></tr>)}</tbody></table></div></section><aside className="content-card"><div className="card-heading"><div><h2>质量系数</h2><p>{pointRule ? pointRule.description : "最终评分对应结算比例"}</p></div></div>{pointRule?.coefficientBands?.length ? <div className="coefficient-list">{pointRule.coefficientBands.map((band) => <div key={`${band.minScore}-${band.maxScore}`}><span>{band.minScore === 0 ? `低于 ${band.maxScore + 1} 分` : `${band.minScore} — ${band.maxScore} 分`}</span><strong>{band.ratio.toFixed(2)}</strong><em>{band.label}</em></div>)}</div> : <p className="form-message">单价规则暂不可用，无法展示质量系数。</p>}</aside></div>
      <section className="content-card table-card">
        <div className="card-heading"><div><h2>场景定价</h2><p>按场景大类计价（元/小时）：家庭最低 20，上限 40；同大类下的细分场景共用同一价格</p></div><button className="button button-secondary" onClick={() => setCreateCatOpen(true)}><Plus size={15}/>新增计费大类</button></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>场景大类</th><th>单价</th><th>说明</th><th/></tr></thead><tbody>
          {categories.map((item) => (
            <tr key={item.categoryKey}>
              <td><strong>{item.name}</strong></td>
              <td>
                {priceEdits[item.categoryKey] === undefined ? (
                  <strong>{item.pricePerHour.toFixed(2)} 元/小时</strong>
                ) : (
                  <div className="input-with-suffix price-inline-edit">
                    <input
                      aria-label={`${item.name}每小时单价`}
                      type="number"
                      inputMode="decimal"
                      min="20"
                      max="40"
                      step="0.01"
                      value={priceEdits[item.categoryKey]}
                      onChange={(event) => setPriceEdits((current) => ({ ...current, [item.categoryKey]: event.target.value }))}
                    />
                    <span>元/小时</span>
                  </div>
                )}
              </td>
              <td><small className="field-help">{item.description}</small></td>
              <td>
                <span className="row-actions">
                  {priceEdits[item.categoryKey] === undefined ? (
                    <button className="table-action" onClick={() => setPriceEdits((current) => ({ ...current, [item.categoryKey]: String(item.pricePerHour) }))}>修改</button>
                  ) : (
                    <>
                      <button className="table-action" disabled={savingPriceKey === item.categoryKey} onClick={() => void handleSavePrice(item.categoryKey)}>{savingPriceKey === item.categoryKey ? "保存中…" : "保存"}</button>
                      <button className="table-action" onClick={() => setPriceEdits((current) => { const rest = { ...current }; delete rest[item.categoryKey]; return rest; })}>取消</button>
                    </>
                  )}
                  <button className="table-action danger" disabled={deletingCatKey === item.categoryKey} onClick={() => void handleDeleteCategory(item.categoryKey)}>{deletingCatKey === item.categoryKey ? "删除中…" : "删除"}</button>
                </span>
              </td>
            </tr>
          ))}
          {categories.length === 0 && <tr><td colSpan={4}>暂无场景定价数据</td></tr>}
        </tbody></table></div>
      </section>
      <section className="content-card table-card">
        <div className="card-heading"><div><h2>数采人员钱包</h2><p>总余额（元）= 结算中 + 可提现 + 提现处理中（预留）+ 已提现；<button className="table-action" onClick={() => navigate("/admin/withdrawals")}>管理人工提现申请</button></p></div></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>数采人员</th><th>总余额</th><th>结算中</th><th>可提现</th><th>提现处理中（预留）</th><th>已提现</th><th>累计提现</th><th /></tr></thead><tbody>
          {wallets.map((wallet) => (
            <tr key={wallet.ownerId}><td><strong>{wallet.ownerName}</strong></td><td><strong>{wallet.totalBalance.toFixed(2)} 元</strong></td><td>{wallet.settlingBalance.toFixed(2)} 元</td><td>{wallet.availableBalance.toFixed(2)} 元</td><td>{wallet.reservedBalance.toFixed(2)} 元</td><td>{wallet.withdrawnBalance.toFixed(2)} 元</td><td>{wallet.cumulativeWithdrawn.toFixed(2)} 元</td><td><button className="table-action" onClick={(event) => { triggerRef.current = event.currentTarget; setDetailMember(wallet); }}>钱包明细</button></td></tr>
          ))}
          {wallets.length === 0 && <tr><td colSpan={8}>暂无钱包数据</td></tr>}
        </tbody></table></div>
      </section>
      <WalletStatsSection />
      <PointRuleModal open={ruleOpen} currentRule={pointRule ?? undefined} onCreated={setPointRule} onClose={() => setRuleOpen(false)} returnFocusRef={ruleTriggerRef} />
      {detailCycle && <CycleDetailModal key={detailCycle.id} open cycle={detailCycle} onClose={() => setDetailCycle(null)} returnFocusRef={triggerRef} />}
      {detailMember && <WalletDetailModal key={detailMember.ownerId} member={detailMember} onClose={() => setDetailMember(null)} returnFocusRef={triggerRef} />}
      {createCatOpen && (
        <Modal open title="新增计费大类" onClose={() => setCreateCatOpen(false)}>
          <div className="modal-form">
            <label className="form-label"><span>大类名称</span><input value={newCatName} onChange={(event) => setNewCatName(event.target.value)} maxLength={120} placeholder="如：医院" /></label>
            <label className="form-label"><span>每小时单价（元）</span><div className="input-with-suffix"><input type="number" inputMode="decimal" min="20" max="40" step="0.01" value={newCatPrice} onChange={(event) => setNewCatPrice(event.target.value)} /><span>元/小时</span></div><small className="field-help">范围 20 ~ 40 元/小时；类别 key 自动生成</small></label>
            <div className="modal-actions"><button className="button button-secondary" onClick={() => setCreateCatOpen(false)}>取消</button><button className="button button-primary" disabled={savingCat} onClick={() => void handleCreateCategory()}>{savingCat ? "新增中…" : "新增"}</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
