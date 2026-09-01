"use client";

import { ArrowLeft, CopyCheck, FileVideo } from "lucide-react";
import { useEffect, useState } from "react";

import { QualityReportCard } from "../../components/QualityReportCard";
import { StatusBadge } from "../../components/StatusBadge";
import { TaskSegmentDemo } from "../../components/TaskSegmentDemo";
import { useIdentity } from "../../auth/client/IdentityContext";
import { estimatePoints } from "../../domain/calculations";
import type { Submission } from "../../domain/types";
import { getPointRule } from "../../points/client/pointCycleApi";
import type { BackendPointRule } from "../../points/contracts";
import {
  getSubmission,
  getSubmissionPreview,
  listAnnotationRuns,
} from "../../submissions/client/submissionApi";
import type {
  BackendAnnotationRun,
  BackendSubmissionPreview,
} from "../../submissions/contracts";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

type AdminTaskTimelineItem = {
  actions: string[];
  completion: string;
  endMs: number;
  label: string;
  objects: string[];
  startMs: number;
  taskIndex: number;
};

type AdminTaskTimelineResult = {
  items: AdminTaskTimelineItem[];
  message: string | null;
  runId: string | null;
  status: "empty" | "failed" | "processing" | "ready" | "unpublished";
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.flatMap((item) =>
    typeof item === "string" && item.trim() ? [item.trim()] : []
  )));
}

function taskActions(task: Record<string, unknown>): string[] {
  const atomicActions = Array.isArray(task.atomic_action_sequence)
    ? task.atomic_action_sequence.flatMap((value) => {
        const action = record(value);
        return typeof action?.verb === "string" && action.verb.trim()
          ? [action.verb.trim()]
          : [];
      })
    : [];
  if (atomicActions.length > 0) return Array.from(new Set(atomicActions));
  const interactions = stringList(task.interaction_primitives);
  if (interactions.length > 0) return interactions;
  return typeof task.task_verb === "string" && task.task_verb.trim()
    ? [task.task_verb.trim()]
    : [];
}

function taskTimelineResult(runs: BackendAnnotationRun[]): AdminTaskTimelineResult {
  const run = runs.find(
    (item) =>
      item.executionStatus === "succeeded" &&
      (item.publicationStatus === "auto_accepted" ||
        item.publicationStatus === "human_verified"),
  );
  if (run) {
    const effective = run.reviewStatus === "accepted_corrected"
      ? record(record(run.humanResult)?.effective)
      : run.candidate?.status === "system_failed"
        ? null
        : record(run.candidate?.effective);
    const tasks = Array.isArray(effective?.tasks) ? effective.tasks : [];
    const items = tasks.flatMap((value, taskIndex) => {
      const task = record(value);
      const startMs = Number(task?.start_ms);
      const endMs = Number(task?.end_ms);
      const label = typeof task?.task_label === "string"
        ? task.task_label.trim()
        : "";
      return Number.isFinite(startMs) &&
        Number.isFinite(endMs) &&
        startMs >= 0 &&
        endMs > startMs &&
        label
        ? [{
            actions: taskActions(task!),
            completion: typeof task?.effective_completion === "string"
              ? task.effective_completion
              : typeof task?.completion === "string"
                ? task.completion
                : "",
            endMs,
            label,
            objects: stringList(task?.manipulated_objects).length > 0
              ? stringList(task?.manipulated_objects)
              : typeof task?.task_object === "string" && task.task_object.trim()
                ? [task.task_object.trim()]
                : [],
            startMs,
            taskIndex,
          }]
        : [];
    });
    return {
      items,
      message: null,
      runId: run.id,
      status: items.length > 0 ? "ready" : "empty",
    };
  }

  const latest = runs[0];
  if (!latest) {
    return { items: [], message: null, runId: null, status: "empty" };
  }
  if (["queued", "running", "retry_scheduled"].includes(latest.executionStatus)) {
    return {
      items: [],
      message: "Annotation 正在处理，完成后任务时间轴会自动更新。",
      runId: latest.id,
      status: "processing",
    };
  }
  if (["system_failed", "stuck", "cancelled"].includes(latest.executionStatus)) {
    return {
      items: [],
      message: latest.lastErrorMessage || "Annotation 处理失败，尚未生成正式任务描述。",
      runId: latest.id,
      status: "failed",
    };
  }
  if (latest.publicationStatus === "candidate_only") {
    return {
      items: [],
      message: "Annotation 已生成候选结果，等待管理员审核并正式发布。",
      runId: latest.id,
      status: "unpublished",
    };
  }
  return {
    items: [],
    message: latest.publicationStatus === "rejected"
      ? "最新 Annotation Run 已被拒绝，没有正式任务描述。"
      : "最新 Annotation Run 已被替代，没有当前正式任务描述。",
    runId: latest.id,
    status: "unpublished",
  };
}

function formatTimelineSeconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

export function SubmissionDetail({
  id,
  navigate,
  backPath = "/collector/submissions",
  backLabel = "返回我的数据",
}: {
  id: string;
  navigate(path: string): void;
  backPath?: string;
  backLabel?: string;
}) {
  const { currentAccount, teams } = useIdentity();
  const [loadedItem, setLoadedItem] = useState<Submission | null>(null);
  const [loadedDetailId, setLoadedDetailId] = useState<string | null>(null);
  const [loadedDetailState, setLoadedDetailState] = useState<"ready" | "missing">("missing");
  const [loadedPreview, setLoadedPreview] = useState<BackendSubmissionPreview | null>(null);
  const [loadedPreviewId, setLoadedPreviewId] = useState<string | null>(null);
  const [loadedPreviewState, setLoadedPreviewState] = useState<"ready" | "unavailable">("unavailable");
  const [pointRule, setPointRule] = useState<BackendPointRule | null>(null);
  const [pointRuleState, setPointRuleState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [loadedTimeline, setLoadedTimeline] = useState<AdminTaskTimelineResult>({
    items: [],
    message: null,
    runId: null,
    status: "empty",
  });
  const [loadedTimelineId, setLoadedTimelineId] = useState<string | null>(null);
  const [loadedTimelineState, setLoadedTimelineState] = useState<
    "ready" | "unavailable"
  >("ready");
  useEffect(() => {
    let active = true;
    getSubmission(id)
      .then((submission) => {
        if (!active) return;
        setLoadedItem(backendSubmissionToDomain(submission));
        setLoadedDetailId(id);
        setLoadedDetailState("ready");
      })
      .catch(() => {
        if (!active) return;
        setLoadedItem(null);
        setLoadedDetailId(id);
        setLoadedDetailState("missing");
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    let active = true;
    getSubmissionPreview(id)
      .then((nextPreview) => {
        if (!active) return;
        setLoadedPreview(nextPreview);
        setLoadedPreviewId(id);
        setLoadedPreviewState("ready");
      })
      .catch(() => {
        if (!active) return;
        setLoadedPreview(null);
        setLoadedPreviewId(id);
        setLoadedPreviewState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
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
  }, []);
  useEffect(() => {
    if (currentAccount.role !== "admin") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loadTimeline = () => {
      listAnnotationRuns(id)
        .then((runs) => {
          if (!active) return;
          const result = taskTimelineResult(runs);
          setLoadedTimeline(result);
          setLoadedTimelineId(id);
          setLoadedTimelineState("ready");
          if (result.status === "processing") {
            timer = setTimeout(loadTimeline, 5_000);
          }
        })
        .catch(() => {
          if (!active) return;
          setLoadedTimeline({
            items: [],
            message: null,
            runId: null,
            status: "empty",
          });
          setLoadedTimelineId(id);
          setLoadedTimelineState("unavailable");
        });
    };
    loadTimeline();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [currentAccount.role, id]);

  const item = loadedDetailId === id ? loadedItem : null;
  const detailState = loadedDetailId === id ? loadedDetailState : "loading";
  // 处理中或卡住时每 5 秒轮询一次，同步 AI 质检进度与状态流转。
  useEffect(() => {
    if (detailState !== "ready" || !item) return;
    const quality = item.qualityResult;
    const active =
      quality !== undefined
        ? ["queued", "running", "stuck"].includes(quality.status)
        : item.qualityStatus === "pending" &&
          item.processingStatus !== "completed" &&
          item.processingStatus !== "failed" &&
          item.processingStatus !== "stuck";
    if (!active) return;
    const timer = setInterval(() => {
      getSubmission(id)
        .then((next) => setLoadedItem(backendSubmissionToDomain(next)))
        .catch(() => undefined);
    }, 5_000);
    return () => clearInterval(timer);
  }, [detailState, id, item]);
  const preview = loadedPreviewId === id ? loadedPreview : null;
  const previewState = loadedPreviewId === id ? loadedPreviewState : "loading";
  const timeline = loadedTimelineId === id ? loadedTimeline : null;
  const timelineState = loadedTimelineId === id
    ? loadedTimelineState
    : "loading";
  if (detailState === "loading") {
    return (
      <div className="empty-state">
        <FileVideo size={28} />
        <strong>正在读取这条数据</strong>
        <span>请稍候</span>
      </div>
    );
  }
  if (!item) {
    return <div className="empty-state"><FileVideo size={28} /><strong>找不到这条数据</strong><button className="text-button" onClick={() => navigate(backPath)}>{backLabel}</button></div>;
  }
  const submissionTeam = teams.find((team) => team.id === item.teamId);
  const teamPointsPerMinute = submissionTeam?.unitPricePerMinute ?? 0;
  const points = pointRule
    ? item.qualityStatus === "passed"
      ? estimatePoints(
          teamPointsPerMinute > 0
            ? teamPointsPerMinute
            : pointRule.defaultPointsPerMinute,
          item.durationSeconds,
          item.invalidSeconds,
          item.finalScore,
          pointRule.coefficientBands,
        )
      : 0
    : null;
  const pointsLabel = item.qualityStatus === "pending"
    ? "—"
    : points === null
      ? pointRuleState === "loading"
        ? "规则读取中"
        : "规则不可用"
      : `${points.toFixed(2)} 分`;
  const duplicateCandidate = item.duplicateCandidates?.find(
    (candidate) => candidate.status === "candidate",
  );
  const evidenceByRange = new Map(
    (preview?.evidenceFrames ?? []).map((frame) => [
      `${Math.round(frame.startSeconds * 1_000)}-${Math.round(frame.endSeconds * 1_000)}`,
      frame,
    ]),
  );
  const label = item.qualityStatus === "passed"
    ? "质量通过"
    : item.qualityStatus === "failed"
      ? "需要返工"
      : item.qualityResult?.status === "review_pending"
        ? "等待人工复核"
        : item.qualityResult?.status === "scored"
          ? "质检完成"
          : item.qualityResult?.status === "stuck" || item.pipelineStage === "stuck"
            ? "质检卡住"
            : item.qualityResult?.status === "system_failed"
              ? "质检异常"
              : "等待质检";
  const tone = item.qualityStatus === "passed"
    ? "success"
    : item.qualityStatus === "failed" ||
        item.qualityResult?.status === "system_failed" ||
        item.qualityResult?.status === "stuck"
      ? "danger"
      : item.qualityResult?.status === "scored"
        ? "success"
        : "warning";

  return (
    <div className="page-stack">
      <button className="back-page" onClick={() => navigate(backPath)}><ArrowLeft size={16} />{backLabel}</button>
      <div className="page-heading"><div><p className="page-kicker">{item.id}</p><h1>{item.fileName}</h1><span>{item.createdAt} · {item.resolution} · {item.sizeMb} MB</span></div><StatusBadge label={label} tone={tone} /></div>
      {item.assetStatus === "quarantined" && <div className="form-message error">该视频已进入敏感隔离区：{item.quarantine?.reason ?? "敏感内容隔离"}</div>}
      {item.storageStatus === "deleted" && <div className="form-message error">该视频对象已删除：{item.storage?.deleteReason ?? "对象已删除"}</div>}
      {item.storageStatus === "delete_pending" && <div className="form-message warning">该视频对象正在删除，完成前不可预览或重新处理。</div>}
      {duplicateCandidate && <div className="form-message warning"><CopyCheck size={14} />该视频疑似与 {duplicateCandidate.candidateFileName ?? duplicateCandidate.candidateSubmissionId} 重复，相似度 {Math.round(duplicateCandidate.similarity * 100)}%，管理员确认前不会进入金额锁定。</div>}
      {item.qualityResult?.status === "review_pending" &&
        item.qualityResult.reviewReasons?.length ? (
        <div className="form-message warning">
          <CopyCheck size={14} />
          该视频需要人工复核：
          {item.qualityResult.reviewReasons.map((reason, index) => (
            <span key={`qc-reason-${index}`}>{index > 0 ? "；" : ""}{reason}</span>
          ))}
        </div>
      ) : null}
      <div className="detail-grid report-layout">
        <section className="video-preview">{preview ? <><video controls preload="metadata" poster={preview.thumbnail?.url} aria-label={`${preview.fileName} 预览`}>{preview.hls ? <source src={preview.hls.url} type={preview.hls.contentType} /> : null}<source src={preview.url} type={preview.contentType} /></video><span>{preview.hls ? `${preview.hls.qualities.map((quality) => quality.quality).join(" / ")}` : `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}`}</span></> : <div><FileVideo size={42} /><strong>{previewState === "loading" ? "正在生成预览地址" : "已保存原始视频"}</strong><small>{previewState === "unavailable" ? "预览暂时无法生成" : "视频已保存至平台对象存储"}</small></div>} {!preview ? <span>{Math.floor(item.durationSeconds / 60)}:{String(item.durationSeconds % 60).padStart(2, "0")}</span> : null}</section>
        <QualityReportCard
          submission={item}
          pointsLabel={pointsLabel}
          evidenceByRange={evidenceByRange}
        />
      </div>
      {currentAccount.role === "admin" ? (
        <section className="content-card admin-task-timeline" aria-label="任务时间轴">
          <div className="card-heading">
            <div>
              <h2>任务时间轴</h2>
              <p>当前正式 Annotation Run 中的任务边界与描述</p>
            </div>
          </div>
          {timelineState === "loading" ? (
            <p className="form-message">正在读取正式任务描述</p>
          ) : timelineState === "unavailable" ? (
            <p className="form-message error">任务描述暂时无法读取，视频详情的其他内容不受影响。</p>
          ) : timeline?.status === "processing" ? (
            <>
              <p className="form-message warning">{timeline.message}</p>
              <a className="text-button" href={`/admin/ai/annotation-runs/${encodeURIComponent(timeline.runId!)}/review`}>查看 Annotation Run</a>
            </>
          ) : timeline?.status === "failed" ? (
            <>
              <p className="form-message error">Annotation 处理失败：{timeline.message}</p>
              <a className="text-button" href={`/admin/ai/annotation-runs/${encodeURIComponent(timeline.runId!)}/review`}>查看失败详情</a>
            </>
          ) : timeline?.status === "unpublished" ? (
            <>
              <p className="form-message warning">{timeline.message}</p>
              <a className="text-button" href={`/admin/ai/annotation-runs/${encodeURIComponent(timeline.runId!)}/review`}>查看 Annotation Run</a>
            </>
          ) : timeline?.status === "empty" ? (
            <p className="form-message">暂无正式任务描述</p>
          ) : (
            <ol className="admin-task-timeline-list">
              {timeline!.items.map((task, index) => (
                <li key={`${task.startMs}-${task.endMs}-${index}`}>
                  <time>
                    {formatTimelineSeconds(task.startMs)}～{formatTimelineSeconds(task.endMs)}
                  </time>
                  <strong>“{task.label}”</strong>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
      {currentAccount.role === "admin" &&
      timelineState === "ready" &&
      timeline?.runId &&
      (timeline.status === "ready" || timeline.status === "empty") ? (
        <section className="content-card" aria-label="任务切片">
          <div className="card-heading">
            <div>
              <h2>任务切片</h2>
              <p>当前正式 Annotation Run 对应的片段状态、标注与预览</p>
            </div>
          </div>
          <TaskSegmentDemo
            annotationRunId={timeline.runId}
            submissionId={id}
            canGenerate
            presentation="structured"
            taskAnnotations={timeline.items}
          />
        </section>
      ) : null}
    </div>
  );
}
