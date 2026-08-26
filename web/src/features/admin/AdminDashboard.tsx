"use client";

import { useEffect, useState } from "react";
import { Archive, BadgeCheck, FileVideo, Users } from "lucide-react";

import { useIdentity } from "../../auth/client/IdentityContext";
import { getAiQualityPrompt } from "../../ai-quality/client/aiQualityApi";
import type { AiQualityPrompt } from "../../ai-quality/contracts";
import { MetricCard } from "../../components/MetricCard";
import type { Submission } from "../../domain/types";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

type PageMode = "loading" | "live" | "unavailable";

type DashboardSummary = {
  totalSubmissions: number;
  passRate: string;
  terminal: number;
  deliverableAssets: number;
  activeAccounts: number;
  queued: number;
  mediaRunning: number;
  aiRunning: number;
  finished: number;
  failed: number;
};

function summarize(submissions: Submission[], activeAccounts: number): DashboardSummary {
  const queued = submissions.filter(
    (item) =>
      item.pipelineStage === "queued" ||
      item.pipelineStage === "awaiting_ai" ||
      item.qualityResult?.status === "queued",
  ).length;
  const mediaRunning = submissions.filter(
    (item) => item.pipelineStage === "probing",
  ).length;
  const aiRunning = submissions.filter(
    (item) =>
      item.pipelineStage === "ai_processing" ||
      item.qualityResult?.status === "running",
  ).length;
  const finished = submissions.filter((item) =>
    ["scored", "hard_reject", "review_pending"].includes(
      item.qualityResult?.status ?? "",
    ),
  ).length;
  const failed = submissions.filter(
    (item) =>
      item.processingStatus === "failed" ||
      item.qualityResult?.status === "system_failed",
  ).length;
  const passed = submissions.filter(
    (item) => item.qualityStatus === "passed",
  ).length;
  const terminal = submissions.filter(
    (item) => item.qualityStatus !== "pending",
  ).length;
  return {
    totalSubmissions: submissions.length,
    passRate: terminal ? `${((passed / terminal) * 100).toFixed(1)}%` : "暂无",
    terminal,
    deliverableAssets: submissions.filter(
      (item) =>
        item.settlementStatus === "settled" &&
        item.qualityStatus === "passed",
    ).length,
    activeAccounts,
    queued,
    mediaRunning,
    aiRunning,
    finished,
    failed,
  };
}

export function AdminDashboard() {
  const { accounts } = useIdentity();
  const activeAccounts = accounts.filter(
    (account) => account.status === "active",
  ).length;
  const [summary, setSummary] = useState<DashboardSummary>(() =>
    summarize([], activeAccounts),
  );
  const [mode, setMode] = useState<PageMode>("loading");
  const [prompt, setPrompt] = useState<AiQualityPrompt>();

  useEffect(() => {
    let active = true;
    loadAllSubmissions({ status: "all" })
      .then((result) => {
        if (!active) return;
        const submissions = result.map(backendSubmissionToDomain);
        setSummary(summarize(submissions, activeAccounts));
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setSummary(summarize([], activeAccounts));
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [activeAccounts]);

  useEffect(() => {
    let active = true;
    getAiQualityPrompt()
      .then((result) => {
        if (active) setPrompt(result);
      })
      .catch(() => {
        if (active) setPrompt(undefined);
      });
    return () => {
      active = false;
    };
  }, []);

  const backendValue = (value: string | number) =>
    mode === "live" ? String(value) : "—";

  return (
    <div className="page-stack">
      <div className="page-heading"><div><p className="page-kicker">全平台运营态势</p><h1>运营总览</h1><span>AI 质检自动完成，任务与结果集中管理</span></div><span className="live-pill"><i />{mode === "live" ? "已连接后端数据" : mode === "loading" ? "正在读取数据" : "数据暂不可用"}</span></div>
      <div className="metric-grid">
        <MetricCard label="视频提交" value={mode === "live" ? `${summary.totalSubmissions} 条` : "—"} detail={mode === "live" ? "当前数据库可见范围" : "数据尚未加载"} icon={FileVideo} />
        <MetricCard label="质量通过率" value={mode === "live" ? summary.passRate : "—"} detail={mode === "live" ? `${summary.terminal} 条已有正式结论` : "数据尚未加载"} icon={BadgeCheck} tone="green" />
        <MetricCard label="可交付资产" value={backendValue(summary.deliverableAssets)} detail={mode === "live" ? "已通过且完成结算" : "数据尚未加载"} icon={Archive} tone="violet" />
        <MetricCard label="有效账号" value={String(summary.activeAccounts)} detail="包含管理员、团长和数采" icon={Users} tone="amber" />
      </div>
      <div className="dashboard-grid">
        <section className="content-card content-card-wide"><div className="card-heading"><div><h2>正式 AI 质检</h2><p>模型来自当前生效的 AI 质检提示词版本；运行并发由 Worker 部署配置控制</p></div></div><div className="pipeline-list"><div><span>初检模型</span><strong>{prompt?.initialModel ?? "未读取"}</strong><em>{prompt ? `提示词 V${prompt.revision}` : "配置暂不可用"}</em></div><div><span>条件复核</span><strong>{prompt?.reviewModel ?? "未读取"}</strong><em>按质量规则触发</em></div><div><span>并发上限</span><strong>Worker 配置</strong><em>以当前运行环境为准</em></div><div><span>结果存储</span><strong>PostgreSQL</strong><em>版本化持久保存</em></div></div></section>
        <aside className="content-card"><div className="card-heading"><div><h2>处理流水线</h2><p>当前正式任务状态</p></div></div><div className="pipeline-list"><div><span>等待处理</span><strong>{backendValue(summary.queued)}</strong><em>媒体或 AI 队列</em></div><div><span>媒体分析中</span><strong>{backendValue(summary.mediaRunning)}</strong><em>解析视频元数据</em></div><div><span>AI 执行中</span><strong>{backendValue(summary.aiRunning)}</strong><em>并发以 Worker 配置为准</em></div><div><span>已出结果</span><strong>{backendValue(summary.finished)}</strong><em>持久化完成</em></div><div><span>异常任务</span><strong className="danger-text">{backendValue(summary.failed)}</strong><em>可查看原因</em></div></div></aside>
      </div>
    </div>
  );
}
