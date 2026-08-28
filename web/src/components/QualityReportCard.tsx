"use client";

import {
  AlertTriangle,
  ChevronDown,
  FileVideo,
} from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import {
  dimensionLabel,
  hardVetoReasonLabel,
} from "../ai-quality/dimensionLabels";
import type { BackendSubmissionPreview } from "../submissions/contracts";
import { effectiveDuration } from "../domain/calculations";
import type { Submission } from "../domain/types";
import { AiQualityProgress } from "./AiQualityProgress";

type EvidenceMap = Map<
  string,
  NonNullable<BackendSubmissionPreview["evidenceFrames"]>[number]
>;

function conclusion(submission: Submission): {
  label: string;
  tone: "success" | "danger" | "warning" | "info" | "neutral";
} {
  const quality = submission.qualityResult;
  if (quality?.status === "stuck" || submission.pipelineStage === "stuck") {
    return { label: "质检卡住", tone: "danger" };
  }
  if (submission.qualityStatus === "passed") {
    return { label: "质量通过", tone: "success" };
  }
  if (submission.qualityStatus === "failed") {
    return { label: "需要返工", tone: "danger" };
  }
  if (quality?.status === "review_pending") {
    return { label: "等待人工复核", tone: "warning" };
  }
  if (quality?.status === "system_failed") {
    return { label: "质检异常", tone: "danger" };
  }
  return { label: "等待质检", tone: "neutral" };
}

function formatSeconds(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return minutes > 0 ? `${minutes}分${String(rest).padStart(2, "0")}秒` : `${rest}秒`;
}

export function QualityReportCard({
  submission,
  pointsLabel,
  evidenceByRange,
}: {
  submission: Submission;
  pointsLabel: string;
  evidenceByRange: EvidenceMap;
}) {
  const quality = submission.qualityResult;
  const result = conclusion(submission);
  const [openDetail, setOpenDetail] = useState(false);
  const [openMore, setOpenMore] = useState(false);

  const dimensions = quality?.dimensions
    ? Object.entries(quality.dimensions)
    : [];
  const issues = submission.issues;
  const totalSeconds = Math.max(1, submission.durationSeconds);

  return (
    <section className="content-card report-card">
      {quality && (
        <AiQualityProgress
          stage={quality.progressStage}
          updatedAt={quality.progressUpdatedAt}
        />
      )}
      {quality?.status === "stuck" && (
        <div className="stuck-banner"><AlertTriangle size={15} /><span><strong>AI 质检任务已卡住</strong> · {quality.stuckReason ?? "任务运行超时或 Worker 心跳过期"}</span></div>
      )}
      {quality?.hardVeto?.triggered && (
        <div className="veto-banner"><AlertTriangle size={15} /><div><strong>硬性否决：</strong><ul>{quality.hardVeto.reasons.map((reason, index) => <li key={`veto-${index}`}>{hardVetoReasonLabel(reason)}</li>)}</ul></div></div>
      )}
      {quality?.manualReview && (
        <div className="manual-review-banner">
          <div className="manual-review-head">
            <strong>人工复核记录</strong>
            <span>{quality.manualReview.reviewedByName} · {quality.manualReview.reviewedAt}</span>
          </div>
          <p>{quality.manualReview.reason}</p>
          {quality.manualReview.finalScore !== null && quality.manualReview.finalScore !== undefined && (
            <small>复核后评分 {quality.manualReview.finalScore}/100</small>
          )}
        </div>
      )}
      <div className="report-head">
        <div className="report-score">
          <span className={`report-conclusion ${result.tone}`}>{result.label}</span>
          <strong className={`report-total ${result.tone}`}>{submission.finalScore || "—"}<small>/100</small></strong>
          {quality?.summary ? (
            <p className="report-summary">{quality.summary}</p>
          ) : quality?.lastError ? (
            <p className="form-message error">{quality.lastError}</p>
          ) : (
            <p className="report-summary muted">等待 AI 质检完成后生成质量结论</p>
          )}
        </div>
        <div className="report-dimensions">
          {dimensions.length > 0 ? (
            dimensions.map(([key, dimension]) => (
              <div className="report-dimension" key={key}>
                <span>{dimensionLabel(key)}</span>
                <i><b style={{ width: `${Math.min(100, Math.max(0, (dimension.score ?? 0) * 5))}%` }} /></i>
                <strong>{dimension.score ?? "—"}</strong>
              </div>
            ))
          ) : (
            <div className="report-dimensions-empty"><FileVideo size={18} /><span>质检完成后展示五维评分</span></div>
          )}
        </div>
      </div>
      <div className="report-metrics">
        <div><small>有效时长</small><strong>{formatSeconds(effectiveDuration(submission.durationSeconds, submission.invalidSeconds))}</strong></div>
        <div><small>无效时长</small><strong>{formatSeconds(submission.invalidSeconds)}</strong></div>
        <div><small>预计金额</small><strong>{pointsLabel}</strong></div>
        <div><small>问题区间</small><strong>{issues.length} 处</strong></div>
      </div>

      {issues.length > 0 && (
        <div className="report-timeline" aria-label="问题区间时间轴">
          <span style={{ left: 0 }}>0s</span>
          {issues.map((issue, index) => {
            const left = Math.max(0, Math.min(100, (issue.start / totalSeconds) * 100));
            const width = Math.max(
              0.5,
              Math.min(100 - left, ((issue.end - issue.start) / totalSeconds) * 100),
            );
            return <i key={`${issue.label}-${index}`} style={{ left: `${left}%`, width: `${width}%` }} />;
          })}
          <span style={{ right: 0 }}>{formatSeconds(totalSeconds)}</span>
        </div>
      )}

      <div className="report-fold">
        <button type="button" className="report-fold-toggle" onClick={() => setOpenDetail((v) => !v)}>
          <span>评分依据与扣分明细</span>
          <ChevronDown size={14} className={openDetail ? "open" : ""} />
        </button>
        {openDetail && (
          <div className="report-fold-body">
            {issues.length > 0 && (
              <div className="report-issue-group">
                <strong>问题区间明细</strong>
                <ul>
                  {issues.map((issue, index) => {
                    const evidence = evidenceByRange.get(
                      `${Math.round(issue.start * 1_000)}-${Math.round(issue.end * 1_000)}`,
                    );
                    return (
                      <li key={`issue-${index}`}>
                        {evidence ? <Image unoptimized width={96} height={54} src={evidence.url} alt={`${issue.label} 证据帧`} /> : null}
                        <span>
                          <em>{issue.label}</em>
                          <small>{issue.start}s — {issue.end}s</small>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {dimensions.some(([, dimension]) => dimension.issues.length > 0) ? (
              dimensions.map(([key, dimension]) => {
                if (dimension.issues.length === 0) return null;
                return (
                  <div className="report-issue-group" key={key}>
                    <strong>{dimensionLabel(key)}（{dimension.score ?? "—"}/20）</strong>
                    <ul>
                      {dimension.issues.map((issue, index) => {
                        const evidence = evidenceByRange.get(
                          `${Math.round(issue.start_ms ?? 0)}-${Math.round(issue.end_ms ?? 0)}`,
                        );
                        return (
                          <li key={`${key}-issue-${index}`}>
                            {evidence ? <Image unoptimized width={96} height={54} src={evidence.url} alt={`${issue.description} 证据帧`} /> : null}
                            <span>
                              <em>{issue.description}</em>
                              <small>{issue.end_ms !== null && issue.start_ms !== null ? `${Math.round(issue.start_ms / 1000)}s—${Math.round(issue.end_ms / 1000)}s` : ""}{issue.confidence ? ` · 确信度 ${Math.round(issue.confidence * 100)}%` : ""}</small>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })
            ) : (
              <p className="report-fold-empty">未发现需要说明的扣分问题</p>
            )}
            {quality?.reviewReasons && quality.reviewReasons.length > 0 && (
              <div className="report-issue-group">
                <strong>AI 建议人工复核</strong>
                <ul>{quality.reviewReasons.map((reason, index) => <li key={`reason-${index}`}><span><em>{reason}</em></span></li>)}</ul>
              </div>
            )}
            {quality?.taskCompliance && (
              <div className="report-issue-group">
                <strong>
                  任务符合度（D4）
                  {quality.taskCompliance.compliance_ratio !== null && (
                    <em className="report-compliance-ratio">
                      {Math.round(quality.taskCompliance.compliance_ratio * 100)}%
                    </em>
                  )}
                </strong>
                <ul className="compliance-list">
                  <li className={quality.taskCompliance.scene_match.matched ? "compliance-ok" : "compliance-warn"}>
                    <span>
                      <em>
                        场景匹配：{quality.taskCompliance.scene_match.matched ? "匹配" : "不匹配"}
                        {quality.taskCompliance.scene_match.note ? `（${quality.taskCompliance.scene_match.note}）` : ""}
                      </em>
                    </span>
                  </li>
                  {quality.taskCompliance.items.map((item, index) => (
                    <li
                      key={`compliance-${index}`}
                      className={
                        item.result === "met"
                          ? "compliance-ok"
                          : item.result === "partial"
                            ? "compliance-warn"
                            : "compliance-bad"
                      }
                    >
                      <span>
                        <em>
                          <b className={`req-badge ${item.type}`}>
                            {item.type === "hard" ? "硬性" : "一般"}
                          </b>
                          {item.requirement}
                        </em>
                        <small>
                          {item.result === "met"
                            ? "符合"
                            : item.result === "partial"
                              ? "部分符合"
                              : "不符合"}
                          {item.confidence ? ` · 确信度 ${Math.round(item.confidence * 100)}%` : ""}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="report-fold">
        <button type="button" className="report-fold-toggle" onClick={() => setOpenMore((v) => !v)}>
          <span>更多信息（内容理解）</span>
          <ChevronDown size={14} className={openMore ? "open" : ""} />
        </button>
        {openMore && (
          <div className="report-fold-body">
            <div className="metadata-grid">
              <div><small>任务摘要</small><strong>{quality?.detectedTask?.task_summary || submission.action || "未识别"}</strong></div>
              <div><small>置信度</small><strong>{quality?.detectedTask?.confidence === null || quality?.detectedTask?.confidence === undefined ? "—" : `${Math.round(quality.detectedTask.confidence * 100)}%`}</strong></div>
            </div>
            {quality?.recommendations && quality.recommendations.length > 0 && (
              <div className="recommend-list">
                {quality.recommendations.map((recommendation, index) => (
                  <div key={`${index}-${recommendation}`}><em>{String(index + 1).padStart(2, "0")}</em><span><strong>{recommendation}</strong></span></div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
