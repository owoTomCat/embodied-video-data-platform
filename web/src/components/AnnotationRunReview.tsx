"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useIdentity } from "../auth/client/IdentityContext";
import {
  createAnnotationRun,
  discardAnnotationRun,
  getAnnotationRun,
  listAnnotationRuns,
  retryAnnotationRun,
  reviewAnnotationRun,
  SubmissionApiError,
} from "../submissions/client/submissionApi";
import type {
  BackendAnnotationRun,
  ReviewAnnotationRunInput,
} from "../submissions/contracts";
import { useInteractions } from "../interactions/InteractionContext";
import { StatusBadge } from "./StatusBadge";

type EditableRecord = Record<string, unknown>;
type ReviewDecision = "accepted" | "rejected" | "unable_to_judge";

const completionOptions = ["complete", "incomplete", "partial", "uncertain"];
const resultOptions = ["success", "failure", "partial", "not_applicable", "unknown"];
const recoveryOptions = [
  "none_observed",
  "failure_without_recovery",
  "failure_then_recovery",
  "possible_failure",
  "ambiguous",
  "not_assessable",
];

function record(value: unknown): EditableRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as EditableRecord)
    : null;
}

function cloneRecord(value: EditableRecord): EditableRecord {
  return JSON.parse(JSON.stringify(value)) as EditableRecord;
}

function editableResult(run: BackendAnnotationRun | undefined): EditableRecord | null {
  if (!run?.candidate || run.candidate.status === "system_failed") return null;
  const candidate = record(run.candidate.raw);
  if (!candidate) return null;
  const corrected = record(record(run.humanResult)?.raw);
  return cloneRecord(corrected ?? candidate);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function annotationStatus(run: BackendAnnotationRun) {
  if (run.publicationStatus === "superseded") {
    return { label: "已废弃或替代", tone: "neutral" as const };
  }
  if (run.executionStatus === "succeeded") {
    if (run.publicationStatus === "human_verified") {
      return { label: "人工已确认", tone: "success" as const };
    }
    if (run.publicationStatus === "auto_accepted") {
      return run.auditStatus === "pending"
        ? { label: "自动发布·待抽检", tone: "info" as const }
        : { label: "自动发布", tone: "success" as const };
    }
    if (run.reviewStatus === "rejected") {
      return { label: "人工已拒绝", tone: "danger" as const };
    }
    if (run.reviewStatus === "unable_to_judge") {
      return { label: "人工无法判断", tone: "warning" as const };
    }
    return { label: "等待标注复核", tone: "warning" as const };
  }
  if (run.executionStatus === "system_failed" || run.executionStatus === "stuck") {
    return { label: "标注执行异常", tone: "danger" as const };
  }
  if (run.executionStatus === "cancelled") {
    return { label: "标注已取消", tone: "neutral" as const };
  }
  return {
    label: run.executionStatus === "running" ? "标注生成中" : "等待标注 Worker",
    tone: "info" as const,
  };
}

function editablePaths(raw: EditableRecord): string[] {
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  return [
    "video_summary",
    "scene.coarse_label",
    "scene.fine_label",
    ...tasks.flatMap((_task, index) => [
      `tasks[${index}].task_label`,
      `tasks[${index}].task_object`,
      `tasks[${index}].manipulated_objects`,
      `tasks[${index}].tools`,
      `tasks[${index}].completion`,
      `tasks[${index}].result_status`,
      `tasks[${index}].visible_postcondition`,
      `tasks[${index}].failure_recovery`,
    ]),
  ];
}

function valueAtPath(raw: EditableRecord, path: string): unknown {
  if (path === "video_summary") return raw.video_summary;
  if (path.startsWith("scene.")) return record(raw.scene)?.[path.slice(6)];
  const match = /^tasks\[(\d+)\]\.(.+)$/u.exec(path);
  if (!match) return undefined;
  const tasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  return record(tasks[Number(match[1])])?.[match[2]!];
}

function correctionTarget(
  path: string,
): NonNullable<ReviewAnnotationRunInput["corrections"]>[number] {
  const taskMatch = /^tasks\[(\d+)\]\.(.+)$/u.exec(path);
  if (path.startsWith("scene.")) {
    return {
      targetType: "scene",
      targetId: "scene",
      fieldPath: path,
      reasonCode: "HUMAN_SEMANTIC_CORRECTION",
    };
  }
  if (!taskMatch) {
    return {
      targetType: "annotation",
      targetId: "video",
      fieldPath: path,
      reasonCode: "HUMAN_SEMANTIC_CORRECTION",
    };
  }
  const field = taskMatch[2]!;
  const targetType = field === "tools"
    ? "tool"
    : field === "manipulated_objects"
      ? "object"
      : field === "completion"
        ? "completion"
        : field === "result_status" || field === "visible_postcondition"
          ? "outcome"
          : field === "failure_recovery"
            ? "failure_recovery"
            : "task_segment";
  return {
    targetType,
    targetId: `task-${taskMatch[1]}`,
    fieldPath: path,
    reasonCode: "HUMAN_SEMANTIC_CORRECTION",
  };
}

export function AnnotationRunReview({
  submissionId,
  runId,
  readOnly,
  onIndependentState,
  onReviewed,
}: {
  submissionId: string;
  runId?: string;
  readOnly: boolean;
  onIndependentState?(hasRuns: boolean): void;
  onReviewed?(): void;
}) {
  const { currentAccount } = useIdentity();
  const { notify } = useInteractions();
  const [runs, setRuns] = useState<BackendAnnotationRun[] | null>(null);
  const [editedRaw, setEditedRaw] = useState<EditableRecord | null>(null);
  const [decision, setDecision] = useState<ReviewDecision>("accepted");
  const [reasonCode, setReasonCode] = useState("HUMAN_VERIFIED");
  const [discardReasonCode, setDiscardReasonCode] = useState<
    "version_replaced" | "configuration_error" | "operator_cancelled"
  >("operator_cancelled");
  const [reason, setReason] = useState("");
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reviewStartedAt, setReviewStartedAt] = useState(() => Date.now());

  const fetchRuns = useCallback(async () => {
    return runId ? [await getAnnotationRun(runId)] : await listAnnotationRuns(submissionId);
  }, [runId, submissionId]);

  const load = useCallback(async () => {
    try {
      const next = await fetchRuns();
      setRuns(next);
      setEditedRaw(editableResult(next[0]));
      setReviewStartedAt(Date.now());
      setLoadError("");
      setError("");
      onIndependentState?.(next.length > 0);
    } catch (caught) {
      setRuns([]);
      setLoadError(caught instanceof Error ? caught.message : "标注运行读取失败");
    }
  }, [fetchRuns, onIndependentState]);

  useEffect(() => {
    let cancelled = false;
    void fetchRuns()
      .then((next) => {
        if (cancelled) return;
        setRuns(next);
        setEditedRaw(editableResult(next[0]));
        setReviewStartedAt(Date.now());
        setLoadError("");
        setError("");
        onIndependentState?.(next.length > 0);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setRuns([]);
        setEditedRaw(null);
        setLoadError(caught instanceof Error ? caught.message : "标注运行读取失败");
      });
    return () => {
      cancelled = true;
    };
  }, [fetchRuns, onIndependentState]);

  const run = runs?.[0] ?? null;
  const candidateRaw = useMemo(() => {
    if (!run?.candidate || run.candidate.status === "system_failed") return null;
    return record(run.candidate.raw);
  }, [run]);

  function updateRoot(field: string, value: unknown) {
    setEditedRaw((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateScene(field: string, value: unknown) {
    setEditedRaw((current) =>
      current
        ? { ...current, scene: { ...(record(current.scene) ?? {}), [field]: value } }
        : current,
    );
  }

  function updateTask(index: number, field: string, value: unknown) {
    setEditedRaw((current) => {
      if (!current || !Array.isArray(current.tasks)) return current;
      return {
        ...current,
        tasks: current.tasks.map((task, taskIndex) =>
          taskIndex === index ? { ...(record(task) ?? {}), [field]: value } : task,
        ),
      };
    });
  }

  async function submitReview() {
    if (!run || !candidateRaw || !editedRaw) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 2) {
      setError("请填写标注审核依据");
      return;
    }
    const reviewedFields = editablePaths(candidateRaw);
    const changed = reviewedFields.filter(
      (path) => !sameValue(valueAtPath(candidateRaw, path), valueAtPath(editedRaw, path)),
    );
    const disposition = decision === "accepted"
      ? changed.length > 0
        ? "accepted_corrected"
        : "accepted_unchanged"
      : decision;
    try {
      setSaving(true);
      setError("");
      await reviewAnnotationRun(run.id, {
        expectedReviewRevision: run.reviewRevision,
        disposition,
        reviewedFields,
        reasonCodes: [reasonCode],
        reviewDurationMs: Math.max(0, Date.now() - reviewStartedAt),
        reason: trimmedReason,
        ...(disposition === "accepted_corrected"
          ? {
              correctedResult: editedRaw,
              corrections: changed.map((path) => ({
                ...correctionTarget(path),
                comment: trimmedReason,
              })),
            }
          : {}),
      });
      notify("success", "结构化标注审核已保存");
      if (onReviewed) onReviewed();
      else await load();
    } catch (caught) {
      if (caught instanceof SubmissionApiError && caught.status === 409 && runId) {
        await load();
        setError("该 Run 已被更新、复核或替代，已重新读取当前状态，不能覆盖提交。");
      } else {
        setError(caught instanceof Error ? caught.message : "标注审核保存失败");
      }
    } finally {
      setSaving(false);
    }
  }

  async function discard() {
    if (!run) return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 2) {
      setError("请填写废弃候选的原因");
      return;
    }
    try {
      setSaving(true);
      setError("");
      await discardAnnotationRun(run.id, {
        expectedReviewRevision: run.reviewRevision,
        reasonCode: discardReasonCode,
        reason: trimmedReason,
      });
      notify("success", "候选 Run 已废弃，不计入人工拒绝统计");
      if (onReviewed) onReviewed();
      else await load();
    } catch (caught) {
      if (caught instanceof SubmissionApiError && caught.status === 409 && runId) {
        await load();
        setError("该 Run 已被更新、复核或替代，不能重复废弃。");
      } else {
        setError(caught instanceof Error ? caught.message : "候选废弃失败");
      }
    } finally {
      setSaving(false);
    }
  }

  async function rerun(mode: "retry" | "new") {
    if (!run && mode === "retry") return;
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 2) {
      setError("请先填写重跑原因");
      return;
    }
    try {
      setSaving(true);
      setError("");
      if (mode === "retry") await retryAnnotationRun(run!.id, trimmedReason);
      else await createAnnotationRun(submissionId, trimmedReason);
      notify("success", mode === "retry" ? "原标注运行已重新排队" : "新版本标注运行已创建");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "标注重跑失败");
    } finally {
      setSaving(false);
    }
  }

  if (runs === null) {
    return <section className="ai-conclusion"><p>正在读取独立结构化标注运行…</p></section>;
  }
  if (loadError) {
    return (
      <section className="review-form" aria-label="独立结构化标注运行读取失败">
        <p className="form-message error">{loadError}</p>
        <button className="table-action" type="button" onClick={() => void load()}>
          <RotateCcw size={15} />重新读取标注运行
        </button>
      </section>
    );
  }
  if (!run) {
    if (readOnly || currentAccount.role !== "admin") return null;
    return (
      <section className="review-form" aria-label="独立结构化标注运行">
        <div className="ai-conclusion-head"><span>结构化内容标注 · 独立运行</span><StatusBadge label="尚未运行" tone="neutral" /></div>
        <label><span>新版本运行原因</span><textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {error ? <p className="form-message error">{error}</p> : null}
        <button className="table-action" disabled={saving} type="button" onClick={() => void rerun("new")}><RotateCcw size={15} />创建首个标注运行</button>
      </section>
    );
  }
  const status = annotationStatus(run);
  const candidate = run.candidate?.status === "system_failed" ? null : run.candidate;
  const rawScene = editedRaw ? record(editedRaw.scene) : null;
  const rawTasks = editedRaw && Array.isArray(editedRaw.tasks) ? editedRaw.tasks : [];
  const canReview =
    !readOnly &&
    run.executionStatus === "succeeded" &&
    ((run.reviewStatus === "pending" && run.publicationStatus === "candidate_only") ||
      (run.reviewStatus === "not_required" &&
        run.publicationStatus === "auto_accepted" &&
        run.auditStatus === "pending")) &&
    candidateRaw !== null &&
    editedRaw !== null;

  return (
    <section className="review-form" aria-label="独立结构化标注审核">
      <div className="ai-conclusion-head">
        <span>结构化内容标注 · 独立运行</span>
        <StatusBadge label={status.label} tone={status.tone} />
      </div>
      <small className="field-hint">
        {run.id} · {run.promptVersion ?? "配置待锁定"} · 尝试 {run.attemptCount} 次
      </small>
      {run.lastErrorMessage ? <p className="form-message error">{run.lastErrorMessage}</p> : null}
      {run.auditStatus === "pending" ? (
        <p className="form-message info">这是自动发布结果的抽检；等待抽检不会阻塞当前交付，提交结论后会立即影响后续交付。</p>
      ) : null}
      {run.autoGateIssues.length > 0 ? (
        <details open={run.autoGateIssues.some((issue) => issue.level === "manual_review" || (issue.level === "retryable" && issue.resolution === "unresolved"))}>
          <summary>Auto Gate 判定（{run.autoGateVersion ?? "未评估"}）</summary>
          <div className="review-issues">
            {run.autoGateIssues.map((issue, index) => (
              <p key={`${issue.code}-${issue.fieldPath ?? "result"}-${index}`}>
                <strong>{issue.code}</strong> · {issue.fieldPath ?? "全局"}
                {issue.taskIndex === null ? "" : ` · Task ${issue.taskIndex + 1}`}
                {issue.evidenceTimestampsMs.length ? ` · ${issue.evidenceTimestampsMs.join("、")}ms` : ""}
                <br/>{issue.message}
              </p>
            ))}
          </div>
        </details>
      ) : null}
      {candidate ? (
        <>
          <p>{candidate.effective.video_summary}</p>
          {candidate.validation.errors.length > 0 ? (
            <div className="review-issues">
              候选存在 {candidate.validation.errors.length} 项结构或证据错误，只能修正后接受。
            </div>
          ) : null}
          {canReview ? (
            <>
              <label>
                <span>视频摘要</span>
                <textarea
                  aria-label="标注视频摘要"
                  rows={3}
                  value={stringValue(editedRaw!.video_summary)}
                  onChange={(event) => updateRoot("video_summary", event.target.value)}
                />
              </label>
              <label>
                <span>场景（粗粒度）</span>
                <input
                  aria-label="标注粗粒度场景"
                  value={stringValue(rawScene?.coarse_label)}
                  onChange={(event) => updateScene("coarse_label", event.target.value || null)}
                />
              </label>
              <label>
                <span>场景（细粒度）</span>
                <input
                  aria-label="标注细粒度场景"
                  value={stringValue(rawScene?.fine_label)}
                  onChange={(event) => updateScene("fine_label", event.target.value || null)}
                />
              </label>
              {rawTasks.map((taskValue, index) => {
                const task = record(taskValue) ?? {};
                return (
                  <fieldset className="issue-editor" key={`annotation-task-${index}`}>
                    <legend>任务 {index + 1} · {Math.round(Number(task.start_ms) / 1_000)}s—{Math.round(Number(task.end_ms) / 1_000)}s</legend>
                    <label><span>任务名称</span><input value={stringValue(task.task_label)} onChange={(event) => updateTask(index, "task_label", event.target.value)} /></label>
                    <label><span>操作对象</span><input value={stringValue(task.task_object)} onChange={(event) => updateTask(index, "task_object", event.target.value)} /></label>
                    <label><span>被操作对象（逗号分隔）</span><input value={stringArray(task.manipulated_objects).join("，")} onChange={(event) => updateTask(index, "manipulated_objects", event.target.value.split(/[，,]/u).map((value) => value.trim()).filter(Boolean))} /></label>
                    <label><span>工具（逗号分隔）</span><input value={stringArray(task.tools).join("，")} onChange={(event) => updateTask(index, "tools", event.target.value.split(/[，,]/u).map((value) => value.trim()).filter(Boolean))} /></label>
                    <label><span>完成度</span><select value={stringValue(task.completion)} onChange={(event) => updateTask(index, "completion", event.target.value)}>{completionOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                    <label><span>结果状态</span><select value={stringValue(task.result_status)} onChange={(event) => updateTask(index, "result_status", event.target.value)}>{resultOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                    <label><span>可见后状态</span><textarea rows={2} value={stringValue(task.visible_postcondition)} onChange={(event) => updateTask(index, "visible_postcondition", event.target.value)} /></label>
                    <label><span>失败与恢复</span><select value={stringValue(task.failure_recovery)} onChange={(event) => updateTask(index, "failure_recovery", event.target.value)}>{recoveryOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
                    <small className="field-hint">时间边界、coverage、证据时间戳和原子动作在当前 schema 下只读。</small>
                  </fieldset>
                );
              })}
              <label>
                <span>审核结论</span>
                <select value={decision} onChange={(event) => setDecision(event.target.value as ReviewDecision)}>
                  <option value="accepted">接受（字段变更会自动记为修正后接受）</option>
                  <option value="rejected">拒绝候选标注</option>
                  <option value="unable_to_judge">当前无法判断</option>
                </select>
              </label>
              <label>
                <span>原因类型</span>
                <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
                  <option value="HUMAN_VERIFIED">人工核验通过</option>
                  <option value="SEMANTIC_ERROR">语义错误</option>
                  <option value="MISSING_DETAIL">信息缺失</option>
                  <option value="ONTOLOGY_MISMATCH">标签体系不匹配</option>
                  <option value="INSUFFICIENT_EVIDENCE">证据不足</option>
                  <option value="OTHER">其他</option>
                </select>
              </label>
              <label><span>标注审核依据</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              {currentAccount.role === "admin" && run.publicationStatus === "candidate_only" ? (
                <label>
                  <span>废弃候选原因类型</span>
                  <select value={discardReasonCode} onChange={(event) => setDiscardReasonCode(event.target.value as typeof discardReasonCode)}>
                    <option value="operator_cancelled">操作员取消</option>
                    <option value="version_replaced">版本替换</option>
                    <option value="configuration_error">配置错误</option>
                  </select>
                </label>
              ) : null}
              {error ? <p className="form-message error">{error}</p> : null}
              <button className="button button-primary" disabled={saving} type="button" onClick={() => void submitReview()}><CheckCircle2 size={16} />{saving ? "保存中" : "保存标注审核"}</button>
              {currentAccount.role === "admin" && run.publicationStatus === "candidate_only" ? <button className="table-action" disabled={saving} type="button" onClick={() => void discard()}>废弃当前候选</button> : null}
            </>
          ) : null}
          <details>
            <summary>查看完整候选 JSON（只读）</summary>
            <pre>{JSON.stringify(run.humanResult ?? candidate, null, 2)}</pre>
          </details>
        </>
      ) : null}
      {run.review ? <small>审核：{run.review.reviewerName} · {run.review.reason} · {run.review.reasonCodes.join("、")}</small> : null}
      {!readOnly && currentAccount.role === "admin" ? (
        <>
          {!canReview ? <label><span>运行操作原因</span><textarea rows={2} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : null}
          {(run.executionStatus === "system_failed" || run.executionStatus === "stuck") ? <button className="table-action" disabled={saving} type="button" onClick={() => void rerun("retry")}><RotateCcw size={15} />重试同一运行（保留配置快照）</button> : null}
          {!runId && !["queued", "running", "retry_scheduled"].includes(run.executionStatus) ? <button className="table-action" disabled={saving} type="button" onClick={() => void rerun("new")}><RotateCcw size={15} />创建新版本运行</button> : null}
        </>
      ) : null}
      {error && !canReview ? <p className="form-message error">{error}</p> : null}
    </section>
  );
}
