"use client";

import { BadgeCheck, Bot, CircleGauge, Tags } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  deleteQualityLabel,
  getLabelSet,
  getQualityRule,
  getScarcityConfig,
} from "../../ai-quality/client/aiQualityApi";
import type { LabelSet, QualityRule, ScarcityConfig } from "../../ai-quality/contracts";
import { StatusBadge } from "../../components/StatusBadge";
import { demoFallbackEnabled } from "../../config/demoFallback";
import { useDemoStore } from "../../data/DemoStoreContext";
import type { LabelConfig } from "../../domain/types";
import { useInteractions } from "../../interactions/InteractionContext";
import { RuleFormModal } from "./RuleFormModal";
import { AiSystemPromptCard } from "./AiSystemPromptCard";
import { ScarcityConfigModal } from "./ScarcityConfigModal";

const typeLabel = { scene: "场景", action: "动作", object: "对象", issue: "质量问题" };

export function RulesPage() {
  const { state } = useDemoStore();
  const { notify } = useInteractions();
  const [qualityRule, setQualityRule] = useState<QualityRule>();
  const [labelSet, setLabelSet] = useState<LabelSet>();
  const [scarcityConfig, setScarcityConfig] = useState<ScarcityConfig>();
  const [ruleMode, setRuleMode] = useState<
    "loading" | "live" | "demo" | "unavailable"
  >(
    "loading",
  );
  const [ruleOpen, setRuleOpen] = useState(false);
  const [labelCreateOpen, setLabelCreateOpen] = useState(false);
  const [scarcityOpen, setScarcityOpen] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<LabelConfig>();
  const [deletingLabelId, setDeletingLabelId] = useState<string>();
  const ruleTriggerRef = useRef<HTMLButtonElement>(null);
  const labelTriggerRef = useRef<HTMLButtonElement>(null);
  const labelCreateTriggerRef = useRef<HTMLButtonElement>(null);
  const scarcityTriggerRef = useRef<HTMLButtonElement>(null);
  const visibleRule = qualityRule ?? {
    version: state.rule.version,
    passThreshold: state.rule.passThreshold,
    description: state.rule.description,
    revision: 0,
    createdByName: "系统",
  };
  const visibleLabels = labelSet?.labels ?? state.labels;

  useEffect(() => {
    let active = true;
    getQualityRule()
      .then((rule) => {
        if (!active) return;
        setQualityRule(rule);
        setRuleMode("live");
      })
      .catch(() => {
        if (!active) return;
        setQualityRule(undefined);
        setRuleMode(demoFallbackEnabled ? "demo" : "unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getLabelSet()
      .then((nextLabelSet) => {
        if (!active) return;
        setLabelSet(nextLabelSet);
      })
      .catch(() => {
        if (!active) return;
        setLabelSet(undefined);
      });
    getScarcityConfig()
      .then((config) => {
        if (!active) return;
        setScarcityConfig(config);
      })
      .catch(() => {
        if (!active) return;
        setScarcityConfig(undefined);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleDeleteLabel(label: LabelConfig) {
    if (!window.confirm(`确定删除标签「${label.name}」？该操作会发布一个新的标签体系版本。`)) {
      return;
    }
    setDeletingLabelId(label.id);
    try {
      const next = await deleteQualityLabel(label.id);
      setLabelSet(next);
      notify("success", "标签已删除");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "删除失败，请重试");
    } finally {
      setDeletingLabelId(undefined);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><p className="page-kicker">版本化配置中心</p><h1>标签与规则</h1><span>统一管理内容标签、模型版本和质量判定阈值</span></div>
        <button ref={ruleTriggerRef} className="button button-primary" disabled={ruleMode === "unavailable"} onClick={() => setRuleOpen(true)}>新建规则版本</button>
      </div>
      <div className="rule-cards">
        <article className="content-card"><span><Tags size={19}/></span><div><small>标签体系</small><strong>{labelSet ? `V${labelSet.revision}` : demoFallbackEnabled ? state.rule.version : "—"}</strong><em>{visibleLabels.filter((label) => label.enabled).length} 个核心标签启用</em></div></article>
        <article className="content-card"><span><Bot size={19}/></span><div><small>AI 模型</small><strong>Qwen3.7</strong><em>Plus 初检 · Flash 条件复核</em></div></article>
        <article className="content-card"><span><CircleGauge size={19}/></span><div><small>通过阈值</small><strong>{ruleMode === "unavailable" ? "—" : `${visibleRule.passThreshold} 分`}</strong><em>{ruleMode === "unavailable" ? "规则服务不可用" : "质量系数分 3 档"}</em></div></article>
        <article className="content-card"><span><BadgeCheck size={19}/></span><div><small>当前规则</small><strong>{ruleMode === "unavailable" ? "读取失败" : visibleRule.version}</strong><em>{ruleMode === "live" ? `V${visibleRule.revision} · 已生效` : ruleMode === "loading" ? "正在读取后端规则" : ruleMode === "demo" ? "本地示例配置" : "请检查后端服务"}</em></div></article>
      </div>
      <AiSystemPromptCard />
      <section className="content-card table-card">
        <div className="card-heading"><div><h2>核心标签</h2><p>场景、动作、对象和质量问题标签（AI 质检据此做任务分类）</p></div><button ref={labelCreateTriggerRef} className="button button-secondary" onClick={() => setLabelCreateOpen(true)}>新增标签</button></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>编号</th><th>标签名称</th><th>类型</th><th>关联视频</th><th>状态</th><th/></tr></thead><tbody>
          {visibleLabels.map((label) => (
            <tr key={label.id}><td>{label.id}</td><td><strong>{label.name}</strong></td><td>{typeLabel[label.type]}</td><td>{label.associationCount} 条</td><td><StatusBadge label={label.enabled ? "启用" : "停用"} tone={label.enabled ? "success" : "neutral"}/></td><td><span className="row-actions"><button className="table-action" onClick={(event) => { labelTriggerRef.current = event.currentTarget; setSelectedLabel(label); }}>编辑</button><button className="table-action table-action-danger" disabled={deletingLabelId === label.id} onClick={() => void handleDeleteLabel(label)}>{deletingLabelId === label.id ? "删除中…" : "删除"}</button></span></td></tr>
          ))}
        </tbody></table></div>
      </section>
      <section className="content-card table-card">
        <div className="card-heading"><div><h2>稀缺奖励</h2><p>按场景/任务/变体有效存量分档计酬，存量越少奖励越高</p></div>{scarcityConfig ? <button ref={scarcityTriggerRef} className="button button-secondary" onClick={() => setScarcityOpen(true)}>编辑配置（V{scarcityConfig.revision}）</button> : null}</div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>档位</th><th>存量区间</th><th>系数</th><th>状态</th></tr></thead><tbody>
          {(scarcityConfig?.tiers ?? []).map((tier) => (
            <tr key={tier.id}><td><strong>{tier.label}</strong></td><td>{tier.minCount} — {tier.maxCount === null ? "∞" : tier.maxCount} 条</td><td>{tier.coefficient.toFixed(2)}</td><td><StatusBadge label={scarcityConfig?.enabled ? "启用" : "停用"} tone={scarcityConfig?.enabled ? "success" : "neutral"}/></td></tr>
          ))}
          {!scarcityConfig ? <tr><td colSpan={4}>稀缺奖励配置读取失败或不可用</td></tr> : null}
        </tbody></table></div>
      </section>
      {ruleOpen && <RuleFormModal open mode="rule" currentRule={qualityRule} onRulePublished={(rule) => { setQualityRule(rule); setRuleMode("live"); }} onClose={() => setRuleOpen(false)} returnFocusRef={ruleTriggerRef} />}
      {labelCreateOpen && <RuleFormModal open mode="label-create" onLabelSetPublished={setLabelSet} onClose={() => setLabelCreateOpen(false)} returnFocusRef={labelCreateTriggerRef} />}
      {selectedLabel && <RuleFormModal open mode="label" label={selectedLabel} onLabelSetPublished={setLabelSet} onClose={() => setSelectedLabel(undefined)} returnFocusRef={labelTriggerRef} />}
      {scarcityOpen && scarcityConfig && <ScarcityConfigModal open config={scarcityConfig} onPublished={setScarcityConfig} onClose={() => setScarcityOpen(false)} returnFocusRef={scarcityTriggerRef} />}
    </div>
  );
}
