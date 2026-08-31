"use client";

import { CheckCircle2, CircleX, Clock3, CopyCheck, Cpu, RotateCcw, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import { stageLabel, stagePercent } from "../../components/AiQualityProgress";
import type { Submission } from "../../domain/types";
import {
  getQueueSnapshot,
  getAnnotationOperations,
  pruneInactiveWorkers,
  reclaimWorkerTimeouts,
} from "../../operations/client/operationsApi";
import type {
  BackendQueueJob,
  BackendQueueSnapshot,
  BackendWorkerHeartbeat,
  BackendAnnotationOperations,
  BackendAnnotationRunListItem,
  AnnotationOperationsView,
} from "../../operations/contracts";
import {
  loadAllSubmissions,
} from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";
import { useInteractions } from "../../interactions/InteractionContext";
import { AiRerunModal } from "./AiRerunModal";

type QueueMode = "loading" | "live" | "unavailable";

function jobStatus(item: Submission): {
  label: string;
  tone: "success" | "danger" | "warning" | "info";
} {
  const status = item.qualityResult?.status;
  if (status === "stuck" || item.pipelineStage === "stuck") {
    return { label: "任务卡住", tone: "danger" };
  }
  if (status === "scored") return { label: "质检完成", tone: "success" };
  if (status === "hard_reject") return { label: "硬性退回", tone: "danger" };
  if (status === "review_pending") return { label: "等待人工复核", tone: "warning" };
  if (status === "system_failed" || item.processingStatus === "failed") {
    return { label: "执行异常", tone: "danger" };
  }
  if (status === "running" || item.pipelineStage === "ai_processing") {
    return { label: "AI 质检中", tone: "info" };
  }
  if (item.pipelineStage === "probing") {
    return { label: "媒体分析中", tone: "info" };
  }
  if (status === "queued" || item.pipelineStage === "awaiting_ai") {
    return { label: "等待 AI 质检", tone: "warning" };
  }
  if (item.pipelineStage === "uploading") {
    return { label: "上传中", tone: "info" };
  }
  if (item.pipelineStage === "queued") {
    return { label: "等待媒体分析", tone: "warning" };
  }
  return { label: "等待处理", tone: "warning" };
}

function queueJobStatus(job: BackendQueueJob): {
  label: string;
  tone: "success" | "danger" | "warning" | "info";
} {
  if (job.lastError) return { label: "发布异常", tone: "danger" };
  if (job.status === "published") return { label: "已发布", tone: "success" };
  if (job.attempts > 0 && job.availableAt > Date.now()) {
    return { label: "等待重试", tone: "warning" };
  }
  return { label: "等待发布", tone: "warning" };
}

function eventLabel(eventType: string): string {
  if (eventType === "media.probe.v1") return "媒体分析";
  if (eventType === "ai.quality.v1") return "AI 质检";
  if (eventType === "ai.annotation.v1") return "结构化标注";
  return eventType;
}

function workerKindLabel(kind: BackendWorkerHeartbeat["kind"]): string {
  if (kind === "media") return "媒体 Worker";
  if (kind === "ai_annotation") return "结构化标注 Worker";
  return "AI 质检 Worker";
}

function workerStatus(worker: BackendWorkerHeartbeat): {
  label: string;
  tone: "success" | "danger" | "warning" | "info" | "neutral";
} {
  if (worker.stale) return { label: "心跳过期", tone: "danger" };
  if (worker.runningTooLong) return { label: "运行过久", tone: "warning" };
  if (worker.status === "running") return { label: "运行中", tone: "info" };
  if (worker.status === "stopped") return { label: "已停止", tone: "neutral" };
  return { label: "空闲", tone: "success" };
}

function formatQueueTime(timestamp?: number): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatDurationMs(milliseconds?: number): string {
  if (milliseconds === undefined) return "—";
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

const annotationViews: Array<{ value: AnnotationOperationsView; label: string }> = [
  { value: "pending_review", label: "待人工复核" },
  { value: "audit_pending", label: "待抽检" },
  { value: "auto_published", label: "自动发布" },
  { value: "execution_failed", label: "执行失败" },
  { value: "in_progress", label: "执行中" },
  { value: "resolved", label: "已处理" },
  { value: "all", label: "全部" },
];

function annotationRunStatus(run: BackendAnnotationRunListItem) {
  if (run.publicationStatus === "human_verified") return { label: "正式发布", tone: "success" as const };
  if (run.publicationStatus === "auto_accepted") {
    return run.auditStatus === "pending"
      ? { label: "自动发布·待抽检", tone: "info" as const }
      : { label: "自动发布", tone: "success" as const };
  }
  if (run.publicationStatus === "superseded") return { label: "已替代/废弃", tone: "neutral" as const };
  if (run.reviewStatus === "rejected") return { label: "人工拒绝", tone: "danger" as const };
  if (run.reviewStatus === "unable_to_judge") return { label: "无法判断", tone: "warning" as const };
  if (run.executionStatus === "succeeded") return { label: "待复核", tone: "warning" as const };
  if (["system_failed", "stuck"].includes(run.executionStatus)) return { label: "执行失败", tone: "danger" as const };
  if (run.executionStatus === "cancelled") return { label: "已取消", tone: "neutral" as const };
  return { label: "执行中", tone: "info" as const };
}

export function AiQueuePage({ navigate }: { navigate?(path: string): void } = {}) {
  const { notify } = useInteractions();
  const [liveSubmissions, setLiveSubmissions] = useState<Submission[] | null>(null);
  const jobs = useMemo(() => liveSubmissions ?? [], [liveSubmissions]);
  const [snapshot, setSnapshot] = useState<BackendQueueSnapshot | null>(null);
  const [queueMode, setQueueMode] = useState<QueueMode>("loading");
  const [tasksMode, setTasksMode] = useState<QueueMode>("loading");
  const [reclaiming, setReclaiming] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [rerunTarget, setRerunTarget] = useState<Submission | null>(null);
  const [annotationView, setAnnotationView] = useState<AnnotationOperationsView>("pending_review");
  const [annotationPage, setAnnotationPage] = useState(1);
  const [annotationSnapshot, setAnnotationSnapshot] = useState<BackendAnnotationOperations | null>(null);
  const [annotationStale, setAnnotationStale] = useState(false);
  const annotationRequestRunning = useRef(false);
  const annotationSummaryCache = useRef<Pick<BackendAnnotationOperations, "summary" | "coverage"> | null>(null);

  const loadTasks = useCallback(() => {
    loadAllSubmissions({ status: "all" })
      .then((list) => {
        setLiveSubmissions(list.map(backendSubmissionToDomain));
        setTasksMode("live");
      })
      .catch(() => setTasksMode("unavailable"));
  }, []);

  const loadSnapshot = useCallback(() => {
    getQueueSnapshot()
      .then((result) => {
        setSnapshot(result);
        setQueueMode("live");
      })
      .catch(() => {
        setSnapshot(null);
        setQueueMode("unavailable");
      });
  }, []);

  useEffect(() => {
    loadTasks();
    loadSnapshot();
    const timer = setInterval(() => {
      loadTasks();
      loadSnapshot();
    }, 10_000);
    return () => clearInterval(timer);
  }, [loadTasks, loadSnapshot]);

  const loadAnnotationRuns = useCallback(async (includeSummary: boolean) => {
    if (document.hidden || annotationRequestRunning.current) return;
    annotationRequestRunning.current = true;
    try {
      const next = await getAnnotationOperations({
        view: annotationView,
        page: annotationPage,
        includeSummary,
      });
      if (includeSummary) {
        annotationSummaryCache.current = {
          summary: next.summary,
          coverage: next.coverage,
        };
      }
      const cached = annotationSummaryCache.current;
      setAnnotationSnapshot({
        ...next,
        ...(cached?.summary ? { summary: cached.summary } : {}),
        ...(cached?.coverage ? { coverage: cached.coverage } : {}),
      });
      setAnnotationStale(false);
    } catch {
      setAnnotationStale(true);
    } finally {
      annotationRequestRunning.current = false;
    }
  }, [annotationPage, annotationView]);

  useEffect(() => {
    void loadAnnotationRuns(annotationSummaryCache.current === null);
    const listTimer = setInterval(() => void loadAnnotationRuns(false), 10_000);
    const summaryTimer = setInterval(() => void loadAnnotationRuns(true), 60_000);
    const onVisibilityChange = () => {
      if (!document.hidden) void loadAnnotationRuns(true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(listTimer);
      clearInterval(summaryTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadAnnotationRuns]);

  const fallbackMetrics = useMemo(() => {
    const queued = jobs.filter(
      (item) =>
        item.pipelineStage === "queued" ||
        item.pipelineStage === "awaiting_ai" ||
        item.qualityResult?.status === "queued",
    ).length;
    const mediaRunning = jobs.filter(
      (item) => item.pipelineStage === "probing",
    ).length;
    const aiRunning = jobs.filter(
      (item) =>
        item.pipelineStage === "ai_processing" ||
        item.qualityResult?.status === "running",
    ).length;
    const completed = jobs.filter((item) =>
      ["scored", "hard_reject", "review_pending"].includes(
        item.qualityResult?.status ?? "",
      ),
    ).length;
    const failed = jobs.filter(
      (item) =>
        item.processingStatus === "failed" ||
        item.qualityResult?.status === "system_failed",
    ).length;
    const stuck = jobs.filter(
      (item) =>
        item.pipelineStage === "stuck" ||
        item.qualityResult?.status === "stuck",
    ).length;
    return { queued, mediaRunning, aiRunning, completed, failed, stuck };
  }, [jobs]);
  const liveSummary = snapshot?.summary;
  const liveWorkers = snapshot?.workers ?? [];
  const inactiveWorkers = snapshot?.inactive ?? [];
  const inactiveCount = snapshot?.inactiveCount ?? inactiveWorkers.length;
  const stuckTasks = jobs.filter(
    (item) =>
      item.pipelineStage === "stuck" ||
      item.qualityResult?.status === "stuck",
  );
  const needsReclaim =
    liveWorkers.some((worker) => worker.runningTooLong || worker.stale) ||
    inactiveWorkers.some(
      (worker) => worker.stale && worker.currentSubmissionId,
    ) ||
    stuckTasks.length > 0;
  const failedSubmissions = jobs.filter(
    (item) =>
      item.settlementStatus === "unsettled" &&
      (item.pipelineStage === "system_failed" ||
        item.processingStatus === "failed" ||
        item.qualityResult?.status === "system_failed"),
  );

  async function handleReclaimTimeouts() {
    setReclaiming(true);
    try {
      const result = await reclaimWorkerTimeouts();
      await Promise.all([loadSnapshot(), loadTasks()]);
      const stuckCount = result.stuck?.length ?? 0;
      const reclaimedCount = result.reclaimed.length;
      if (reclaimedCount > 0 || stuckCount > 0) {
        notify(
          "success",
          `已标记 ${stuckCount} 个卡住任务，重新排队 ${reclaimedCount} 个`,
        );
      } else {
        notify("success", "暂无需要处理的卡住/超时任务");
      }
    } catch {
      notify("error", "卡住任务处理失败，请稍后重试");
    } finally {
      setReclaiming(false);
    }
  }

  async function handlePrune() {
    setPruning(true);
    try {
      const result = await pruneInactiveWorkers();
      await loadSnapshot();
      notify(
        "success",
        result.removed > 0
          ? `已清理 ${result.removed} 条历史心跳记录`
          : "没有可清理的历史记录",
      );
    } catch {
      notify("error", "清理历史记录失败，请稍后重试");
    } finally {
      setPruning(false);
    }
  }

  const stuckCount = liveSubmissions ? stuckTasks.length : fallbackMetrics.stuck;
  const taskMetricValue = (value: number) =>
    tasksMode === "live" ? String(value) : "—";

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div><p className="page-kicker">AI Worker 实时队列</p><h1>AI 任务</h1><span>AI 质检任务与结果均来自持久化数据，队列状态每 10 秒刷新</span></div>
        <div className="page-heading-actions">
          {snapshot ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={reclaiming || !needsReclaim}
              onClick={() => void handleReclaimTimeouts()}
            >
              <RotateCcw size={16} />
              {reclaiming ? "处理中" : "处理卡住/超时任务"}
            </button>
          ) : null}
          <span className="live-pill"><i />{queueMode === "live" ? "队列快照已连接后端" : queueMode === "loading" ? "正在读取队列快照" : "队列暂不可用"}</span>
        </div>
      </div>
      <div className="metric-grid metric-grid-5">
        {liveSummary ? (
          <>
            <MetricCard label="等待发布" value={String(liveSummary.pending)} detail={`最近 ${liveSummary.total} 条队列记录`} icon={Clock3} tone="amber" />
            <MetricCard label="AI 质检事件" value={String(liveSummary.ai)} detail={`结构化标注 ${liveSummary.annotation ?? 0} 条 · 媒体分析 ${liveSummary.media} 条`} icon={Cpu} />
            <MetricCard label="已发布" value={String(liveSummary.published)} detail={`平均发布 ${formatDurationMs(liveSummary.averagePublishLatencyMs)}`} icon={CheckCircle2} tone="green" />
            <MetricCard label="发布异常" value={String(liveSummary.failed)} detail="保留失败原因和重试次数" icon={CircleX} tone="red" />
          </>
        ) : (
          <>
            <MetricCard label="等待处理" value={taskMetricValue(fallbackMetrics.queued)} detail={tasksMode === "live" ? "等待媒体或 AI 队列" : "任务数据尚未加载"} icon={Clock3} tone="amber" />
            <MetricCard label="AI 执行中" value={taskMetricValue(fallbackMetrics.aiRunning)} detail={tasksMode === "live" ? `并发以 Worker 配置为准 · 媒体分析中 ${fallbackMetrics.mediaRunning} 条` : "任务数据尚未加载"} icon={Cpu} />
            <MetricCard label="已出结果" value={taskMetricValue(fallbackMetrics.completed)} detail={tasksMode === "live" ? "包含通过、退回和待复核" : "任务数据尚未加载"} icon={CheckCircle2} tone="green" />
            <MetricCard label="异常任务" value={taskMetricValue(fallbackMetrics.failed)} detail={tasksMode === "live" ? "已持久化失败原因" : "任务数据尚未加载"} icon={CircleX} tone="red" />
          </>
        )}
        <MetricCard label="卡住任务" value={taskMetricValue(stuckCount)} detail={tasksMode === "live" ? "超时或心跳过期，可重新排队" : "任务数据尚未加载"} icon={CircleX} tone={stuckCount > 0 ? "amber" : "green"} />
      </div>
      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h2>结构化内容标注</h2>
            <p>独立 AnnotationRun 的执行、人工复核与发布状态；不解析旧影子标注，也不改变质检或结算</p>
          </div>
          {annotationStale ? <span className="form-message error">数据可能已过期，保留上次成功结果</span> : null}
        </div>
        <div className="metric-grid metric-grid-5">
          <MetricCard
            label="Run 覆盖率"
            value={annotationSnapshot?.coverage?.anyRunRate == null ? "—" : `${Math.round(annotationSnapshot.coverage.anyRunRate * 100)}%`}
            detail={annotationSnapshot?.coverage ? `${annotationSnapshot.coverage.submissionsWithAnyRun}/${annotationSnapshot.coverage.eligibleSubmissions} 条可执行视频 · 成功 ${Math.round((annotationSnapshot.coverage.succeededRate ?? 0) * 100)}%` : "按标注可执行视频去重统计"}
            icon={Cpu}
          />
          <MetricCard
            label="历史 Run"
            value={annotationSnapshot?.summary ? String(annotationSnapshot.summary.runs.historicalTotal) : "—"}
            detail={annotationSnapshot?.summary ? `成功 ${annotationSnapshot.summary.runs.succeeded} · 失败 ${annotationSnapshot.summary.runs.systemFailed + annotationSnapshot.summary.runs.stuck} · 取消 ${annotationSnapshot.summary.runs.cancelled}` : "按 Run 统计"}
            icon={CheckCircle2}
          />
          <MetricCard
            label="待人工复核"
            value={annotationSnapshot?.summary ? String(annotationSnapshot.summary.reviews.pending) : "—"}
            detail="仅统计具有确定 reason code 的 manual_required Run"
            icon={Clock3}
            tone={(annotationSnapshot?.summary?.reviews.pending ?? 0) > 0 ? "amber" : "green"}
          />
          <MetricCard
            label="人工已处理"
            value={annotationSnapshot?.summary ? String(annotationSnapshot.summary.reviews.acceptedUnchanged + annotationSnapshot.summary.reviews.acceptedCorrected + annotationSnapshot.summary.reviews.rejected + annotationSnapshot.summary.reviews.unableToJudge) : "—"}
            detail={annotationSnapshot?.summary ? `原样 ${annotationSnapshot.summary.reviews.acceptedUnchanged} · 修正 ${annotationSnapshot.summary.reviews.acceptedCorrected} · 拒绝/无法判断 ${annotationSnapshot.summary.reviews.rejected + annotationSnapshot.summary.reviews.unableToJudge}` : "废弃候选不计入人工结论"}
            icon={CopyCheck}
          />
          <MetricCard
            label="模型调用"
            value={annotationSnapshot?.summary ? String(annotationSnapshot.summary.usage.providerCalls) : "—"}
            detail={annotationSnapshot?.summary ? `成功 ${annotationSnapshot.summary.usage.succeededCalls} · 失败 ${annotationSnapshot.summary.usage.failedCalls} · 修复 ${annotationSnapshot.summary.usage.schemaRepairCalls + annotationSnapshot.summary.usage.targetedRepairCalls}；所有已报告调用累计` : "包含失败与修复调用"}
            icon={Cpu}
          />
        </div>
        <div className="segmented-control" aria-label="结构化标注视图">
          {annotationViews.map((item) => (
            <button
              key={item.value}
              type="button"
              className={annotationView === item.value ? "active" : ""}
              onClick={() => {
                setAnnotationView(item.value);
                setAnnotationPage(1);
                setAnnotationSnapshot(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="table-summary">
          <span>{annotationSnapshot ? `${annotationSnapshot.pagination.total} 个 Run` : "正在读取独立标注数据"}</span>
          <span>第 {annotationSnapshot?.pagination.page ?? annotationPage} / {Math.max(1, annotationSnapshot?.pagination.totalPages ?? 1)} 页</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Run / Submission</th><th>视频</th><th>状态</th><th>模型 / Prompt</th><th>尝试</th><th>时间</th><th>最近错误</th><th/></tr></thead>
            <tbody>
              {(annotationSnapshot?.runs ?? []).map((run) => {
                const status = annotationRunStatus(run);
                return (
                  <tr key={run.id}>
                    <td><strong>{run.id}</strong><br/><small>{run.submissionId}</small></td>
                    <td>{run.fileName}</td>
                    <td><StatusBadge label={status.label} tone={status.tone} /><br/><small>{run.executionStatus} / {run.reviewStatus} / {run.publicationStatus}</small></td>
                    <td>{run.model ?? "待锁定"}<br/><small>{run.promptVersion ?? "待锁定"}</small></td>
                    <td>{run.attemptCount}<br/><small>模型 {run.fullModelAttempts} · 调用 {run.providerCallCount} · 基础设施重试 {run.infrastructureRetryCount}</small></td>
                    <td>{formatQueueTime(run.updatedAt)}<br/><small>入队 {formatQueueTime(run.queuedAt)}</small></td>
                    <td>{run.lastErrorMessage ?? "—"}</td>
                    <td><button className="table-action" type="button" onClick={() => {
                      const path = `/admin/ai/annotation-runs/${encodeURIComponent(run.id)}/review`;
                      if (navigate) navigate(path);
                      else window.location.assign(path);
                    }}>{run.executionStatus === "succeeded" && ((run.reviewStatus === "pending" && run.publicationStatus === "candidate_only") || run.auditStatus === "pending") ? "打开复核" : "查看 Run"}</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {annotationSnapshot && annotationSnapshot.runs.length === 0 ? <div className="empty-state compact-empty"><CopyCheck size={26} /><strong>当前视图暂无 Run</strong><span>独立标注运行产生后会显示在这里</span></div> : null}
        </div>
        <div className="table-summary">
          <span>每页 {annotationSnapshot?.pagination.pageSize ?? 50} 条</span>
          <span className="row-actions">
            <button className="table-action" type="button" disabled={annotationPage <= 1} onClick={() => setAnnotationPage((current) => Math.max(1, current - 1))}>上一页</button>
            <button className="table-action" type="button" disabled={!annotationSnapshot || annotationPage >= annotationSnapshot.pagination.totalPages} onClick={() => setAnnotationPage((current) => current + 1)}>下一页</button>
          </span>
        </div>
      </section>
      {snapshot && (
        <section className="content-card table-card">
          <div className="card-heading"><div><h2>当前 Worker</h2><p>仅展示存活且心跳正常的处理进程；已停止或心跳过期的记录收进下方历史区</p></div></div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Worker</th><th>状态</th><th>当前任务</th><th>运行耗时</th><th>处理统计</th><th>耗时统计</th><th>最近心跳</th><th>机器</th><th>最近错误</th></tr></thead>
              <tbody>
                {liveWorkers.map((worker) => {
                  const status = workerStatus(worker);
                  return (
                    <tr key={worker.id}>
                      <td><strong>{workerKindLabel(worker.kind)}</strong><br/><small>{worker.id}</small></td>
                      <td><StatusBadge label={status.label} tone={status.tone} /></td>
                      <td>{worker.currentSubmissionId ?? "等待任务"}</td>
                      <td>{worker.currentTaskAgeMs === undefined ? "—" : formatDurationMs(worker.currentTaskAgeMs)}<br/><small>阈值 {formatDurationMs(worker.taskTimeoutMs)}</small></td>
                      <td>{worker.completedTaskCount} 完成 / {worker.failedTaskCount} 失败</td>
                      <td>平均 {formatDurationMs(worker.averageTaskDurationMs)}<br/><small>最近 {formatDurationMs(worker.lastTaskDurationMs)} · 最长 {formatDurationMs(worker.maxTaskDurationMs)}</small></td>
                      <td>{formatQueueTime(worker.lastSeenAt)}</td>
                      <td>{worker.hostName}<br/><small>PID {worker.processId}</small></td>
                      <td>{worker.lastError ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!liveWorkers.length && <div className="empty-state compact-empty"><Server size={26} /><strong>暂无活跃 Worker</strong><span>启动媒体分析或 AI 质检 Worker 后会显示运行状态</span></div>}
          </div>
          {inactiveCount > 0 && (
            <div className="worker-history">
              <div className="worker-history-actions">
                <button type="button" className="table-action" onClick={() => setShowHistory((visible) => !visible)}>
                  {showHistory ? "收起" : "展开"}历史记录（{inactiveCount} 条）
                </button>
                <button type="button" className="table-action" disabled={pruning} onClick={() => void handlePrune()}>
                  <Trash2 size={14} />
                  {pruning ? "清理中" : "清理历史记录"}
                </button>
              </div>
              <p className="worker-history-hint">已停止或心跳过期的进程不再处理任务，仅作历史留痕，可随时清理。</p>
              {showHistory && (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Worker</th><th>状态</th><th>最近心跳</th><th>机器</th><th>最后任务</th></tr></thead>
                    <tbody>
                      {inactiveWorkers.map((worker) => {
                        const status = workerStatus(worker);
                        return (
                          <tr key={worker.id}>
                            <td><strong>{workerKindLabel(worker.kind)}</strong><br/><small>{worker.id}</small></td>
                            <td><StatusBadge label={status.label} tone={status.tone} /></td>
                            <td>{formatQueueTime(worker.lastSeenAt)}</td>
                            <td>{worker.hostName}<br/><small>PID {worker.processId}</small></td>
                            <td>{worker.currentSubmissionId ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {snapshot && (
        <section className="content-card table-card">
          <div className="card-heading"><div><h2>后台队列发布记录</h2><p>最近 100 条后台队列发布记录</p></div></div>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>任务</th><th>事件</th><th>关联提交</th><th>下次处理</th><th>发布时间</th><th>耗时</th><th>尝试次数</th><th>状态</th></tr></thead>
              <tbody>
                {snapshot.jobs.map((job) => {
                  const status = queueJobStatus(job);
                  return (
                    <tr key={job.id}>
                      <td><strong>{job.id}</strong></td>
                      <td>{eventLabel(job.eventType)}</td>
                      <td>{job.aggregateId}</td>
                      <td>{formatQueueTime(job.availableAt)}</td>
                      <td>{formatQueueTime(job.publishedAt)}</td>
                      <td>{job.publishedAt ? formatDurationMs(job.publishLatencyMs) : job.waitMs > 0 ? `等待 ${formatDurationMs(job.waitMs)}` : formatDurationMs(job.ageMs)}</td>
                      <td>{job.attempts}</td>
                      <td><StatusBadge label={status.label} tone={status.tone} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!snapshot.jobs.length && <div className="empty-state"><Cpu size={26} /><strong>暂无后台队列记录</strong><span>视频上传完成后会自动进入媒体分析和 AI 质检队列</span></div>}
          </div>
        </section>
      )}
      <section className="content-card table-card">
        <div className="card-heading"><div><h2>任务队列</h2><p>{liveSubmissions ? `真实任务状态，共 ${jobs.length} 条 · 每 10 秒自动刷新` : "任务数据暂不可用，请检查后端服务"}</p></div></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>提交</th><th>视频文件</th><th>质检进度</th><th>模型路由</th><th>尝试</th><th>状态</th></tr></thead>
            <tbody>
              {jobs.slice(0, 200).map((job) => {
                const status = jobStatus(job);
                const progressStage = job.qualityResult?.progressStage;
                const percent = stagePercent(progressStage);
                return (
                  <tr key={job.id}>
                    <td><strong>{job.id}</strong></td>
                    <td>{job.fileName}</td>
                    <td>
                      {progressStage ? (
                        <div className="progress-cell">
                          <span>{stageLabel(progressStage)}</span>
                          <div className="mini-progress"><i><b style={{ width: `${percent}%` }} /></i><small>{status.label}</small></div>
                        </div>
                      ) : (
                        <span style={{ color: "#97a1b1", fontSize: 8 }}>{job.qualityResult ? "等待开始" : "等待媒体分析"}</span>
                      )}
                    </td>
                    <td>{job.qualityResult ? `${job.qualityResult.initialModel} → ${job.qualityResult.reviewModel}` : "等待锁定模型"}</td>
                    <td>{job.qualityResult?.attempts ?? 0}</td>
                    <td><StatusBadge label={status.label} tone={status.tone} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!jobs.length && <div className="empty-state"><Cpu size={26} /><strong>{tasksMode === "loading" ? "正在读取 AI 任务" : tasksMode === "unavailable" ? "任务数据暂不可用" : "暂无正式 AI 任务"}</strong><span>{tasksMode === "unavailable" ? "请检查后端服务后重试" : "视频上传并完成媒体解析后会自动进入这里"}</span></div>}
        </div>
      </section>
      <section className="content-card table-card">
        <div className="card-heading"><div><h2>卡住任务</h2><p>运行超时或 Worker 心跳过期的任务已自动标记为卡住，可一键重新排队恢复</p></div></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>提交</th><th>视频文件</th><th>卡住原因</th><th>最后进度</th><th>尝试</th><th/></tr></thead>
            <tbody>
              {stuckTasks.map((job) => (
                <tr key={job.id}>
                  <td><strong>{job.id}</strong></td>
                  <td>{job.fileName}</td>
                  <td>{job.qualityResult?.stuckReason ?? job.qualityResult?.lastError ?? "任务运行超时"}</td>
                  <td>{job.qualityResult?.progressStage ? stageLabel(job.qualityResult.progressStage) : "—"}</td>
                  <td>{job.qualityResult?.attempts ?? 0}</td>
                  <td>
                    <button
                      type="button"
                      className="table-action"
                      onClick={() => setRerunTarget(job)}
                    >
                      <RotateCcw size={14} />
                      重新排队
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!stuckTasks.length && <div className="empty-state compact-empty"><CircleX size={26} /><strong>{tasksMode === "unavailable" ? "卡住任务数据暂不可用" : "暂无卡住任务"}</strong><span>{tasksMode === "unavailable" ? "请检查后端服务后重试" : "任务卡住后会自动出现在这里，并触发通知提醒"}</span></div>}
        </div>
      </section>
      <section className="content-card table-card">
        <div className="card-heading"><div><h2>异常任务重跑</h2><p>失败任务需填写原因后重新进入 AI 质检队列</p></div></div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>提交</th><th>视频文件</th><th>失败原因</th><th>尝试次数</th><th>状态</th><th/></tr></thead>
            <tbody>
              {failedSubmissions.map((job) => (
                <tr key={job.id}>
                  <td><strong>{job.id}</strong></td>
                  <td>{job.fileName}</td>
                  <td>{job.qualityResult?.lastError ?? "后台处理失败"}</td>
                  <td>{job.qualityResult?.attempts ?? 0}</td>
                  <td><StatusBadge label="执行异常" tone="danger" /></td>
                  <td>
                    <button
                      type="button"
                      className="table-action"
                      onClick={() => setRerunTarget(job)}
                    >
                      <RotateCcw size={14} />
                      重新执行
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!failedSubmissions.length && <div className="empty-state compact-empty"><Cpu size={26} /><strong>{tasksMode === "unavailable" ? "异常任务数据暂不可用" : "暂无异常任务"}</strong><span>{tasksMode === "unavailable" ? "请检查后端服务后重试" : "AI 质检失败后会在这里提供重跑入口"}</span></div>}
        </div>
      </section>
      {rerunTarget && (
        <AiRerunModal
          open
          submission={rerunTarget}
          onClose={() => setRerunTarget(null)}
          onRerun={() => void loadTasks()}
        />
      )}
    </div>
  );
}
