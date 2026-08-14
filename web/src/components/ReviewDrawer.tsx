"use client";

import { AlertTriangle, CheckCircle2, Clock3, Coins, FileVideo, History, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { useDemoStore } from "../data/DemoStoreContext";
import {
  effectiveDuration,
  estimateIncome,
  qualityCoefficient,
  qualityStatus,
} from "../domain/calculations";
import type { Submission } from "../domain/types";
import { QualityBreakdown } from "./QualityBreakdown";
import { StatusBadge } from "./StatusBadge";

export function ReviewDrawer({ submission, onClose }: { submission: Submission; onClose(): void }) {
  const { adjustQuality, state } = useDemoStore();
  const [score, setScore] = useState(String(submission.finalScore));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const team = state.teams.find((item) => item.id === submission.teamId);
  const finalScore = Math.min(100, Math.max(0, Number(score) || 0));
  const settlementRatio =
    finalScore === submission.finalScore
      ? submission.qualityResult?.settlementRatio
      : qualityCoefficient(finalScore);
  const income = estimateIncome(
    team?.unitPricePerMinute ?? 12,
    submission.durationSeconds,
    submission.invalidSeconds,
    finalScore,
    settlementRatio,
  );
  const aiPassed = submission.qualityStatus === "passed";
  const aiStatusLabel = submission.qualityResult?.status === "review_pending"
    ? "AI 建议人工复核"
    : aiPassed
      ? "AI 判定通过"
      : "AI 判定未通过";
  const aiStatusTone = submission.qualityResult?.status === "review_pending"
    ? "warning"
    : aiPassed
      ? "success"
      : "danger";

  function save(event: FormEvent) {
    event.preventDefault();
    try {
      adjustQuality(submission.id, finalScore, reason);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    }
  }

  return (
    <>
      <button className="drawer-backdrop" aria-label="关闭复核" onClick={onClose} />
      <aside className="review-drawer" aria-label="质量复核面板">
        <header><div><span>结算前复核</span><h2>{submission.fileName}</h2><p>{submission.id} · {submission.ownerName} · {submission.teamName}</p></div><button className="icon-button" aria-label="关闭复核" onClick={onClose}><X size={18} /></button></header>
        <div className="drawer-body">
          <section className="review-video"><FileVideo size={34} /><strong>视频证据预览</strong><span>{submission.resolution} · {submission.durationSeconds} 秒</span></section>
          <section className="ai-conclusion">
            <div><span>AI 原始结论</span><StatusBadge label={aiStatusLabel} tone={aiStatusTone} /></div>
            <strong>{submission.aiScore}<small>/100</small></strong>
            <p>{submission.qualityResult?.summary.replace(/\bD1\b/gu,"第一人称与构图").replace(/\bD2\b/gu,"手部、前臂与对象完整性").replace(/\bD3\b/gu,"视频与画面质量").replace(/\bD4\b/gu,"任务真实性与完整度").replace(/\bD5\b/gu,"平台需求与稀缺度") || "AI 原始分保持不变，人工复核只写入最终评分和审计记录。"}</p>
            {submission.qualityResult && <p>{submission.qualityResult.initialModel} · 条件复核 {submission.qualityResult.reviewModel} · 提示词 V{submission.qualityResult.promptRevision}</p>}
          </section>
          {submission.qualityResult && <QualityBreakdown admin finalScore={submission.aiScore} quality={submission.qualityResult} />}
          <form className="review-form" onSubmit={save}>
            <label><span>最终评分</span><input aria-label="最终评分" min="0" max="100" type="number" value={score} onChange={(event) => setScore(event.target.value)} /></label>
            <div className="review-derived">
              <div><span>最终结论</span><strong className={qualityStatus(finalScore) === "passed" ? "success-text" : "danger-text"}>{qualityStatus(finalScore) === "passed" ? "通过" : "未通过"}</strong></div>
              <div><span>质量系数</span><strong>{settlementRatio === null ? "暂不结算" : (settlementRatio ?? qualityCoefficient(finalScore)).toFixed(2)}</strong></div>
              <div><span><Clock3 size={13} />有效时长</span><strong>{effectiveDuration(submission.durationSeconds, submission.invalidSeconds)} 秒</strong></div>
              <div><span><Coins size={13} />预计金额</span><strong>¥{income.toFixed(2)}</strong></div>
            </div>
            <label><span>调整原因</span><textarea aria-label="调整原因" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请说明人工复核依据，必填" rows={3} /></label>
            {submission.issues.length > 0 && <div className="review-issues"><AlertTriangle size={15} /><span>AI 标记 {submission.issues.length} 个问题区间，无效时长 {submission.invalidSeconds} 秒</span></div>}
            {error && <p className="form-message error">{error}</p>}
            <button className="button button-primary" type="submit"><CheckCircle2 size={16} />保存调整</button>
          </form>
          <section className="audit-timeline"><div className="card-heading"><div><h2>审计记录</h2><p>保留原始结果和每次人工调整</p></div><History size={17} /></div>{submission.audit.map((record) => <div key={record.id}><i /><span><strong>{record.action}</strong><small>{record.actor} · {record.createdAt}</small><em>{record.reason}</em></span></div>)}</section>
        </div>
      </aside>
    </>
  );
}
