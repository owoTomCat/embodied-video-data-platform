"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Coins,
  CopyCheck,
  FileVideo,
  History,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { useIdentity } from "../auth/client/IdentityContext";
import { dimensionLabel, hardVetoReasonLabel } from "../ai-quality/dimensionLabels";
import { formatDuration } from "../features/team/teamMetrics";
import {
  effectiveDuration,
  estimatePoints,
  qualityCoefficient,
  qualityStatus,
} from "../domain/calculations";
import type { Submission } from "../domain/types";
import { getPointRule } from "../points/client/pointCycleApi";
import type { BackendPointRule } from "../points/contracts";
import {
  clearDuplicateCandidate,
  getSubmissionPreview,
  reviewSubmissionQuality,
} from "../submissions/client/submissionApi";
import type { BackendSubmissionPreview } from "../submissions/contracts";
import { useInteractions } from "../interactions/InteractionContext";
import { StatusBadge } from "./StatusBadge";
import { AnnotationRunReview } from "./AnnotationRunReview";

type IssueDraft = {
  id: string;
  label: string;
  start: string;
  end: string;
};

function unionSeconds(issues: IssueDraft[]): number {
  const ranges = issues
    .map((issue) => ({
      start: Number(issue.start),
      end: Number(issue.end),
    }))
    .filter(
      (range) =>
        Number.isFinite(range.start) &&
        Number.isFinite(range.end) &&
        range.end > range.start,
    )
    .sort((left, right) => left.start - right.start);
  let total = 0;
  let current: { start: number; end: number } | null = null;
  for (const range of ranges) {
    if (!current) {
      current = { ...range };
    } else if (range.start <= current.end) {
      current.end = Math.max(current.end, range.end);
    } else {
      total += current.end - current.start;
      current = { ...range };
    }
  }
  if (current) total += current.end - current.start;
  return Math.round(total * 1_000) / 1_000;
}

function initialIssueDrafts(submission: Submission): IssueDraft[] {
  return submission.invalidIssues.map((issue, index) => ({
    id: `${submission.id}-${index}`,
    label: issue.label,
    start: String(issue.start),
    end: String(issue.end),
  }));
}

export function ReviewDrawer({
  submission,
  onClose,
  readOnly = false,
  variant = "drawer",
  annotationOnly = false,
  annotationRunId,
  onAnnotationReviewed,
}: {
  submission: Submission;
  onClose(): void;
  readOnly?: boolean;
  variant?: "drawer" | "page";
  annotationOnly?: boolean;
  annotationRunId?: string;
  onAnnotationReviewed?(): void;
}) {
  const { teams } = useIdentity();
  const { notify } = useInteractions();
  const [score, setScore] = useState(String(submission.finalScore));
  const [reason, setReason] = useState("");
  const [quarantine, setQuarantine] = useState(
    submission.assetStatus === "quarantined",
  );
  const [issues, setIssues] = useState<IssueDraft[]>(() =>
    initialIssueDrafts(submission),
  );
  const [error, setError] = useState("");
  const [duplicateSaving, setDuplicateSaving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasIndependentAnnotation, setHasIndependentAnnotation] = useState<
    boolean | null
  >(null);
  const [pointRule, setPointRule] = useState<BackendPointRule | null>(null);
  const [pointRuleState, setPointRuleState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [preview, setPreview] = useState<BackendSubmissionPreview | null>(null);
  const [previewState, setPreviewState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const team = teams.find((item) => item.id === submission.teamId);
  const duplicateCandidate = submission.duplicateCandidates?.find(
    (candidate) => candidate.status === "candidate",
  );
  const finalScore = Math.min(100, Math.max(0, Number(score) || 0));
  const passThreshold =
    submission.qualityResult?.passThreshold ?? 60;
  const finalInvalidSeconds = unionSeconds(issues);
  const teamPointsPerMinute = team?.unitPricePerMinute ?? 0;
  const pointsPerMinute =
    teamPointsPerMinute > 0
      ? teamPointsPerMinute
      : pointRule?.defaultPointsPerMinute ?? 0;
  const estimatePassed = readOnly
    ? submission.qualityStatus === "passed"
    : qualityStatus(finalScore, passThreshold) === "passed";
  const coefficient = pointRule
    ? estimatePassed
      ? qualityCoefficient(finalScore, pointRule.coefficientBands)
      : 0
    : null;
  const points = pointRule
    ? estimatePassed
      ? estimatePoints(
          pointsPerMinute,
          submission.durationSeconds,
          readOnly ? submission.invalidSeconds : finalInvalidSeconds,
          finalScore,
          pointRule.coefficientBands,
        )
      : 0
    : null;
  const unavailableEstimateLabel =
    pointRuleState === "loading" ? "规则读取中" : "规则不可用";
  const aiPassed =
    submission.qualityResult?.passed ??
    qualityStatus(submission.aiScore, passThreshold) === "passed";
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

  useEffect(() => {
    if (annotationOnly) return;
    let active = true;
    getPointRule()
      .then((rule) => {
        if (!active) return;
        setPointRule(rule);
        setPointRuleState("ready");
      })
      .catch(() => {
        if (active) setPointRuleState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [annotationOnly]);

  useEffect(() => {
    let active = true;
    getSubmissionPreview(submission.id)
      .then((next) => {
        if (!active) return;
        setPreview(next);
        setPreviewState("ready");
      })
      .catch(() => {
        if (active) setPreviewState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [submission.id]);

  function updateIssue(id: string, values: Partial<IssueDraft>) {
    setIssues((current) =>
      current.map((issue) =>
        issue.id === id ? { ...issue, ...values } : issue,
      ),
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("请填写调整原因");
      return;
    }
    const nextIssues = issues.map((issue) => ({
      label: issue.label.trim(),
      start: Number(issue.start),
      end: Number(issue.end),
    }));
    try {
      setSaving(true);
      if (!submission.qualityResult) {
        throw new Error("质检结果尚未就绪，当前不能人工复核");
      }
      await reviewSubmissionQuality(submission.id, {
        finalScore,
        reason: trimmedReason,
        issues: nextIssues,
        expectedReviewRevision: submission.qualityResult.reviewRevision,
        quarantine,
      });
      notify("success", "复核结果已保存");
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function clearDuplicate() {
    setError("");
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("请填写调整原因");
      return;
    }
    if (!duplicateCandidate) return;
    try {
      setDuplicateSaving(true);
      await clearDuplicateCandidate(
        submission.id,
        duplicateCandidate.id,
        { reason: trimmedReason },
      );
      notify("success", "近似重复候选已解除");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "解除失败");
    } finally {
      setDuplicateSaving(false);
    }
  }

  const videoPreview = (
    <section className="video-preview">
      {preview ? (
        <>
          <video controls preload="metadata" poster={preview.thumbnail?.url} aria-label={`${submission.fileName} 预览`}>
            {preview.hls ? <source src={preview.hls.url} type={preview.hls.contentType} /> : null}
            <source src={preview.url} type={preview.contentType} />
          </video>
          <span>{preview.hls ? `${preview.hls.qualities.map((quality) => quality.quality).join(" / ")}` : `${Math.floor(submission.durationSeconds / 60)}:${String(submission.durationSeconds % 60).padStart(2, "0")}`}</span>
        </>
      ) : (
        <div>
          <FileVideo size={42} />
          <strong>{previewState === "loading" ? "正在生成预览地址" : "已保存原始视频"}</strong>
          <small>{previewState === "unavailable" ? "预览暂时无法生成" : "视频已保存至平台对象存储"}</small>
        </div>
      )}
      {!preview ? <span>{Math.floor(submission.durationSeconds / 60)}:{String(submission.durationSeconds % 60).padStart(2, "0")}</span> : null}
    </section>
  );

  if (annotationOnly) {
    const annotationContent = annotationRunId ? (
      <AnnotationRunReview
        submissionId={submission.id}
        runId={annotationRunId}
        readOnly={readOnly}
        onReviewed={onAnnotationReviewed}
      />
    ) : (
      <p className="form-message error">缺少 Annotation Run ID</p>
    );
    if (variant === "page") {
      return (
        <div className="page-stack review-page">
          <button className="back-page" onClick={onClose}><ArrowLeft size={16} />返回 AI 标注</button>
          <div className="page-heading">
            <div>
              <p className="page-kicker">{annotationRunId}</p>
              <h1>{submission.fileName}</h1>
              <span>{submission.id} · {submission.ownerName} · {submission.teamName} · {submission.durationSeconds} 秒</span>
            </div>
            <StatusBadge label={readOnly ? "标注结果" : "结构化标注复核"} tone={readOnly ? "info" : "warning"} />
          </div>
          <div className="detail-grid report-layout review-page-layout">
            {videoPreview}
            <div className="review-page-side">{annotationContent}</div>
          </div>
        </div>
      );
    }
    return (
      <>
        <button className="drawer-backdrop" aria-label="关闭标注复核" onClick={onClose} />
        <aside className="review-drawer" aria-label="结构化标注复核面板">
          <header><div><span>结构化标注复核</span><h2>{submission.fileName}</h2><p>{annotationRunId}</p></div><button className="icon-button" aria-label="关闭标注复核" onClick={onClose}><X size={18} /></button></header>
          <div className="drawer-body">{videoPreview}{annotationContent}</div>
        </aside>
      </>
    );
  }

  const bodyContent = (
    <>
      <section className="ai-conclusion">
        <div className="ai-conclusion-head">
          <span className={`report-conclusion ${aiStatusTone}`}>{aiStatusLabel}</span>
          <strong className={`report-total ${aiStatusTone}`}>{submission.aiScore}<small>/100</small></strong>
        </div>
        <p className="report-summary">{submission.qualityResult?.summary || "AI 原始分保持不变，人工复核只写入最终评分和审计记录。"}</p>
        {submission.qualityResult?.hardVeto?.triggered && (
          <div className="veto-banner"><AlertTriangle size={15} /><div><strong>硬性否决：</strong><ul>{submission.qualityResult.hardVeto.reasons.map((reason, index) => <li key={`veto-${index}`}>{hardVetoReasonLabel(reason)}</li>)}</ul></div></div>
        )}
        {submission.qualityResult?.dimensions ? (
          <div className="report-dimensions">
            {Object.entries(submission.qualityResult.dimensions).map(([key, dimension]) => (
              <div className="report-dimension" key={key}>
                <span>{dimensionLabel(key)}</span>
                <i><b style={{ width: `${Math.min(100, Math.max(0, (dimension.score ?? 0) * 5))}%` }} /></i>
                <strong>{dimension.score ?? "—"}</strong>
              </div>
            ))}
          </div>
        ) : null}
        {submission.qualityResult?.reviewReasons?.length ? <div className="review-reasons"><strong>AI 建议人工复核：</strong><ul>{submission.qualityResult.reviewReasons.map((reason, index) => <li key={`reason-${index}`}>{reason}</li>)}</ul></div> : null}
      </section>
      {submission.qualityResult?.manualReview && (
        <div className="manual-review-banner">
          <div className="manual-review-head">
            <strong>人工复核记录</strong>
            <span>{submission.qualityResult.manualReview.reviewedByName} · {submission.qualityResult.manualReview.reviewedAt}</span>
          </div>
          <p>{submission.qualityResult.manualReview.reason}</p>
          {submission.qualityResult.manualReview.finalScore !== null && submission.qualityResult.manualReview.finalScore !== undefined && (
            <small>复核后评分 {submission.qualityResult.manualReview.finalScore}/100</small>
          )}
        </div>
      )}
      <AnnotationRunReview
        submissionId={submission.id}
        readOnly={readOnly}
        onIndependentState={setHasIndependentAnnotation}
      />
      {submission.qualityResult?.candidateAnnotation &&
        hasIndependentAnnotation === false &&
        submission.qualityResult.candidateAnnotation.status !== "system_failed" && (
          <section className="ai-conclusion">
            <div className="ai-conclusion-head">
              <span>结构化内容标注（旧影子结果，只读）</span>
              <StatusBadge
                label={submission.qualityResult.candidateAnnotation.status === "candidate" ? "候选可用" : "待确认"}
                tone={submission.qualityResult.candidateAnnotation.status === "candidate" ? "info" : "warning"}
              />
            </div>
            <p>{submission.qualityResult.candidateAnnotation.effective.video_summary}</p>
            {submission.qualityResult.candidateAnnotation.effective.assessability_reason && (
              <small>可判定性：{submission.qualityResult.candidateAnnotation.effective.model_assessability === "assessable" ? "可判定" : "需要复核"} · {submission.qualityResult.candidateAnnotation.effective.assessability_reason}</small>
            )}
            <ul>
              {submission.qualityResult.candidateAnnotation.effective.tasks.map((task, index) => (
                <li key={`review-annotation-task-${index}`}>
                  <strong>{task.task_label}</strong> · {Math.round(task.start_ms / 1000)}s—{Math.round(task.end_ms / 1000)}s · {Math.round(task.confidence * 100)}%
                  <small>
                    完成度 {task.effective_completion} · 结果 {task.effective_result_status}
                    {task.execution_pattern ? ` · ${task.execution_pattern}` : ""}
                  </small>
                  {(task.atomic_action_sequence?.length ?? 0) > 0 && (
                    <small>原子步骤：{task.atomic_action_sequence!.map((action) => action.verb).join(" → ")}</small>
                  )}
                  {task.visible_postcondition && <small>可见后状态：{task.visible_postcondition}</small>}
                  {task.policy_reasons.length > 0 && <small>证据策略：{task.policy_reasons.join("、")}</small>}
                </li>
              ))}
            </ul>
            {submission.qualityResult.annotationReview && (
              <small>
                上次标注复核：{submission.qualityResult.annotationReview.correctedAnnotation ? "已修正并接受" : submission.qualityResult.annotationReview.decision === "accepted" ? "已接受" : "需要修正"} · {submission.qualityResult.annotationReview.reviewedByName}
              </small>
            )}
          </section>
        )}
      {duplicateCandidate && (
        <section className="ai-conclusion duplicate-review">
          <div className="ai-conclusion-head"><span>近似重复候选</span><StatusBadge label="待确认" tone="warning" /></div>
          <strong>{Math.round(duplicateCandidate.similarity * 100)}<small>%</small></strong>
          <p>疑似与 {duplicateCandidate.candidateFileName ?? duplicateCandidate.candidateSubmissionId} 重复，解除前不会进入金额锁定。</p>
          {!readOnly && <button className="table-action" disabled={duplicateSaving} type="button" onClick={clearDuplicate}><CopyCheck size={15} />{duplicateSaving ? "处理中" : "解除重复标记"}</button>}
        </section>
      )}
      {readOnly ? (
        <section className="review-form" aria-label="最终质检结果">
          <div className="review-derived">
            <div><span>最终评分</span><strong>{submission.finalScore}/100</strong></div>
            <div><span>最终结论</span><strong className={submission.qualityStatus === "passed" ? "success-text" : "danger-text"}>{submission.qualityStatus === "passed" ? "通过" : submission.qualityStatus === "failed" ? "未通过" : "待质检"}</strong></div>
            <div><span><Clock3 size={13} />有效时长</span><strong>{formatDuration(effectiveDuration(submission.durationSeconds, submission.invalidSeconds))}</strong></div>
            <div><span><Coins size={13} />预估金额</span><strong>{submission.qualityStatus === "pending" ? "—" : points === null ? unavailableEstimateLabel : `${points.toFixed(2)} 元`}</strong></div>
          </div>
          {submission.qualityResult?.manualReview ? (
            <p className="form-message">复核原因已在上方「人工复核记录」中展示。</p>
          ) : (
            <p className="form-message">团长仅可查看结果。如需人工修正，请联系平台管理员处理。</p>
          )}
        </section>
      ) : <form className="review-form" onSubmit={save}>
        <div className="review-guide">
          <strong>本次复核可以调整什么</strong>
          <p className="form-message info">质量分数用于计算视频价值；人工复核只决定视频是否有用。分数已预填 AI 结果，无需调整时直接确认放行或隔离。</p>
          <ul>
            <li><b>最终评分</b>：修改 AI 给出的分数，保存后按新分数判定是否通过并计算金额。</li>
            <li><b>问题区间</b>：仅标记真正没有任务内容的片段（黑屏、冻结、与任务无关的空镜）。分辨率、模糊、遮挡等质量扣分请通过最终评分体现，不要标记为无效。</li>
            <li><b>敏感隔离</b>：勾选后该视频不进入普通资产、交付包和公开统计。</li>
            <li><b>解除重复标记</b>：近似重复若是误报，可在上方解除，解除后进入正常流程。</li>
          </ul>
        </div>
        <label><span>最终评分</span><input aria-label="最终评分" min="0" max="100" step="0.1" type="number" value={score} onChange={(event) => setScore(event.target.value)} /><small className="field-hint">AI 原始分 {submission.aiScore}，可调整为 0–100 的整数或一位小数</small></label>
        <div className="review-derived">
          <div><span>最终结论</span><strong className={qualityStatus(finalScore, passThreshold) === "passed" ? "success-text" : "danger-text"}>{qualityStatus(finalScore, passThreshold) === "passed" ? "通过" : "未通过"}</strong></div>
          <div><span>质量系数</span><strong>{coefficient === null ? unavailableEstimateLabel : coefficient.toFixed(2)}</strong></div>
          <div><span><Clock3 size={13} />有效时长</span><strong>{formatDuration(effectiveDuration(submission.durationSeconds, finalInvalidSeconds))}</strong></div>
          <div><span><Coins size={13} />预计金额</span><strong>{points === null ? unavailableEstimateLabel : `${points.toFixed(2)} 元`}</strong></div>
        </div>
        <div className="issue-editor" aria-label="问题区间">
          <div className="issue-editor-heading">
            <span>问题区间</span>
            <button
              aria-label="新增问题区间"
              className="icon-button"
              type="button"
              onClick={() =>
                setIssues((current) => [
                  ...current,
                  {
                    id: `${submission.id}-${Date.now()}`,
                    label: "人工标记问题",
                    start: "0",
                    end: "1",
                  },
                ])
              }
            >
              <Plus size={15} />
            </button>
          </div>
          <small className="field-hint">仅标记没有任务内容的片段（黑屏、冻结、与任务无关的空镜）；区间会从有效时长中扣除，请勿把分辨率、模糊等质量扣分标成无效</small>
          {issues.length ? issues.map((issue) => (
            <div className="issue-editor-row" key={issue.id}>
              <input aria-label="问题类型" value={issue.label} onChange={(event) => updateIssue(issue.id, { label: event.target.value })} />
              <input aria-label="开始秒" min="0" step="0.1" type="number" value={issue.start} onChange={(event) => updateIssue(issue.id, { start: event.target.value })} />
              <input aria-label="结束秒" min="0" step="0.1" type="number" value={issue.end} onChange={(event) => updateIssue(issue.id, { end: event.target.value })} />
              <button aria-label="删除问题区间" className="icon-button" type="button" onClick={() => setIssues((current) => current.filter((item) => item.id !== issue.id))}><Trash2 size={15} /></button>
            </div>
          )) : <p className="form-message">未标记无效区间，系统会按全片有效计算。</p>}
        </div>
        <label><span>调整原因</span><textarea aria-label="调整原因" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请说明人工复核依据，必填" rows={3} /><small className="field-hint">必填，将写入审计记录留痕</small></label>
        <label className="checkbox-line"><input type="checkbox" checked={quarantine} onChange={(event) => setQuarantine(event.target.checked)} />敏感内容隔离，不进入普通资产和交付候选</label>
        {issues.length > 0 && <div className="review-issues"><AlertTriangle size={15} /><span>当前有 {issues.length} 个无效区间，人工确认无效时长 {finalInvalidSeconds} 秒</span></div>}
        {error && <p className="form-message error">{error}</p>}
        <button className="button button-primary" disabled={saving} type="submit"><CheckCircle2 size={16} />{saving ? "保存中" : quarantine ? "确认隔离（视频无用）" : "确认放行（视频有用）"}</button>
      </form>}
      <section className="audit-timeline"><div className="card-heading"><div><h2>审计记录</h2><p>保留原始结果和每次人工调整</p></div><History size={17} /></div>{submission.audit.length ? submission.audit.map((record) => <div key={record.id}><i /><span><strong>{record.action}</strong><small>{record.actor} · {record.createdAt}</small><em>{record.reason}</em></span></div>) : <p className="form-message">暂无人工调整记录。</p>}</section>
    </>
  );

  if (variant === "page") {
    return (
      <div className="page-stack review-page">
        <button className="back-page" onClick={onClose}><ArrowLeft size={16} />返回质量复核</button>
        <div className="page-heading"><div><p className="page-kicker">{submission.id}</p><h1>{submission.fileName}</h1><span>{submission.ownerName} · {submission.teamName} · {submission.resolution} · {submission.durationSeconds} 秒</span></div>{readOnly ? <StatusBadge label="质检结果" tone="info" /> : <StatusBadge label="待人工复核" tone="warning" />}</div>
        <div className="detail-grid report-layout review-page-layout">
          {videoPreview}
          <div className="review-page-side">{bodyContent}</div>
        </div>
      </div>
    );
  }

  return (
    <>
      <button className="drawer-backdrop" aria-label="关闭复核" onClick={onClose} />
      <aside className="review-drawer" aria-label="质量复核面板">
        <header><div><span>{readOnly ? "质检结果查看" : "结算前复核"}</span><h2>{submission.fileName}</h2><p>{submission.id} · {submission.ownerName} · {submission.teamName}</p></div><button className="icon-button" aria-label="关闭复核" onClick={onClose}><X size={18} /></button></header>
        <div className="drawer-body">
          {videoPreview}
          {bodyContent}
        </div>
      </aside>
    </>
  );
}
