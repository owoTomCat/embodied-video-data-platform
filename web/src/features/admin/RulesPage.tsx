"use client";

import { BadgeCheck, Bot, CircleGauge, ScrollText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  getQualityRule,
  getScarcityConfig,
} from "../../ai-quality/client/aiQualityApi";
import type { AiQualityPrompt, QualityRule, ScarcityConfig } from "../../ai-quality/contracts";
import { StatusBadge } from "../../components/StatusBadge";
import { RuleFormModal } from "./RuleFormModal";
import { AiSystemPromptCard } from "./AiSystemPromptCard";
import { ScarcityConfigModal } from "./ScarcityConfigModal";

export function RulesPage() {
  const [qualityRule, setQualityRule] = useState<QualityRule>();
  const [scarcityConfig, setScarcityConfig] = useState<ScarcityConfig>();
  const [prompt, setPrompt] = useState<AiQualityPrompt>();
  const [ruleMode, setRuleMode] = useState<
    "loading" | "live" | "unavailable"
  >(
    "loading",
  );
  const [ruleOpen, setRuleOpen] = useState(false);
  const [scarcityOpen, setScarcityOpen] = useState(false);
  const ruleTriggerRef = useRef<HTMLButtonElement>(null);
  const scarcityTriggerRef = useRef<HTMLButtonElement>(null);
  const visibleRule = qualityRule ?? {
    version: "",
    passThreshold: 0,
    description: "",
    revision: 0,
    createdByName: "",
  };

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
        setRuleMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
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

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><p className="page-kicker">AI 质检运行配置</p><h1>规则与提示词</h1><span>模型版本、质量判定阈值与 AI 系统提示词；内容标签请到「标签体系」页管理</span></div>
        <button ref={ruleTriggerRef} className="button button-primary" disabled={ruleMode === "unavailable"} onClick={() => setRuleOpen(true)}>新建规则版本</button>
      </div>
      <div className="rule-cards">
        <article className="content-card"><span><Bot size={19}/></span><div><small>AI 模型</small><strong>{prompt?.initialModel ?? "正在读取"}</strong><em>{prompt ? `${prompt.reviewModel} 条件复核` : "以当前提示词版本为准"}</em></div></article>
        <article className="content-card"><span><CircleGauge size={19}/></span><div><small>通过阈值</small><strong>{ruleMode === "unavailable" ? "—" : `${visibleRule.passThreshold} 分`}</strong><em>{ruleMode === "unavailable" ? "规则服务不可用" : "质量系数分 3 档"}</em></div></article>
        <article className="content-card"><span><BadgeCheck size={19}/></span><div><small>当前规则</small><strong>{ruleMode === "unavailable" ? "读取失败" : visibleRule.version}</strong><em>{ruleMode === "live" ? `V${visibleRule.revision} · 已生效` : ruleMode === "loading" ? "正在读取后端规则" : "请检查后端服务"}</em></div></article>
        <article className="content-card"><span><ScrollText size={19}/></span><div><small>系统提示词</small><strong>版本化发布</strong><em>仅影响之后新开始的任务</em></div></article>
      </div>
      <AiSystemPromptCard onPromptChange={setPrompt} />
      <section className="content-card table-card">
        <div className="card-heading"><div><h2>稀缺奖励</h2><p>按场景/任务/变体有效存量分档计酬，存量越少奖励越高</p></div>{scarcityConfig ? <button ref={scarcityTriggerRef} className="button button-secondary" onClick={() => setScarcityOpen(true)}>编辑配置（V{scarcityConfig.revision}）</button> : null}</div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>档位</th><th>存量区间</th><th>系数</th><th>状态</th></tr></thead><tbody>
          {(scarcityConfig?.tiers ?? []).map((tier) => (
            <tr key={tier.id}><td><strong>{tier.label}</strong></td><td>{tier.minCount} — {tier.maxCount === null ? "∞" : tier.maxCount} 条</td><td>{tier.coefficient.toFixed(2)}</td><td><StatusBadge label={scarcityConfig?.enabled ? "启用" : "停用"} tone={scarcityConfig?.enabled ? "success" : "neutral"}/></td></tr>
          ))}
          {!scarcityConfig ? <tr><td colSpan={4}>稀缺奖励配置读取失败或不可用</td></tr> : null}
        </tbody></table></div>
      </section>
      {ruleOpen && <RuleFormModal open currentRule={qualityRule} onRulePublished={(rule) => { setQualityRule(rule); setRuleMode("live"); }} onClose={() => setRuleOpen(false)} returnFocusRef={ruleTriggerRef} />}
      {scarcityOpen && scarcityConfig && <ScarcityConfigModal open config={scarcityConfig} onPublished={setScarcityConfig} onClose={() => setScarcityOpen(false)} returnFocusRef={scarcityTriggerRef} />}
    </div>
  );
}
