"use client";

import { FileVideo, Play, RefreshCw, RotateCcw, Scissors } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  generateTaskSegments,
  getTaskSegmentAssets,
  getTaskSegmentPreview,
  retryTaskSegment,
} from "../operations/client/operationsApi";
import type { BackendTaskSegmentAsset } from "../operations/contracts";
import { StatusBadge } from "./StatusBadge";

export type TaskSegmentAnnotationSummary = {
  actions: string[];
  completion: string;
  objects: string[];
  taskIndex: number;
};

const ACTION_LABELS: Record<string, string> = {
  adjust: "调整",
  align: "对齐",
  assemble: "组装",
  bimanual_fix_and_operate: "双手固定并操作",
  carry: "搬运",
  close: "关闭",
  cut: "切割",
  disassemble: "拆卸",
  fold: "折叠",
  grasp: "抓取",
  hold: "握持",
  insert: "插入",
  move: "移动",
  open: "打开",
  other_visible_action: "其他可见动作",
  other_visible_contact: "其他接触",
  pick_and_place: "抓取并放置",
  pinch: "捏取",
  place: "放置",
  pour: "倾倒",
  press: "按压",
  pull: "拉动",
  push: "推动",
  release: "松开",
  remove: "取出",
  rub_or_wipe: "擦拭",
  spray: "喷洒",
  squeeze: "挤压",
  support: "托举",
  twist: "旋转",
  uncertain: "不确定",
  unfold: "展开",
  wash_or_rinse: "清洗",
};

function status(asset: BackendTaskSegmentAsset, structured: boolean) {
  switch (asset.generationStatus) {
    case "ready":
      return { label: structured ? "切片就绪" : "ready", tone: "success" as const };
    case "failed":
      return { label: structured ? "生成失败" : "failed", tone: "danger" as const };
    case "skipped":
      return { label: structured ? "已跳过" : "skipped", tone: "warning" as const };
    case "processing":
      return { label: structured ? "生成中" : "processing", tone: "info" as const };
    default:
      return { label: structured ? "等待生成" : "queued", tone: "neutral" as const };
  }
}

function timestamp(milliseconds: number): string {
  const safe = Math.max(0, milliseconds);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const millis = Math.round(safe % 1_000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function compactTimestamp(milliseconds: number): string {
  return `${(Math.max(0, milliseconds) / 1_000).toFixed(1)}s`;
}

function completionLabel(value: string): string {
  switch (value) {
    case "complete":
    case "completed":
      return "已完成";
    case "incomplete":
      return "未完成";
    case "partial":
      return "部分完成";
    case "uncertain":
      return "不确定";
    default:
      return "未知";
  }
}

function fileSize(value: string | null): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
}

export function TaskSegmentDemo({
  annotationRunId,
  submissionId,
  canGenerate,
  presentation = "technical",
  taskAnnotations = [],
}: {
  annotationRunId: string;
  submissionId: string;
  canGenerate: boolean;
  presentation?: "structured" | "technical";
  taskAnnotations?: TaskSegmentAnnotationSummary[];
}) {
  const [assets, setAssets] = useState<BackendTaskSegmentAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const structured = presentation === "structured";
  const annotationsByTask = useMemo(
    () => new Map(taskAnnotations.map((annotation) => [annotation.taskIndex, annotation])),
    [taskAnnotations],
  );

  const load = useCallback(async (quiet = false) => {
    try {
      const result = await getTaskSegmentAssets({
        annotationRunId,
        page: 1,
        pageSize: 50,
      });
      setAssets(result.assets);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "任务片段读取失败");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [annotationRunId]);

  async function refresh() {
    setLoading(true);
    await load();
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const hasActiveAssets = useMemo(
    () => assets.some(
      (asset) =>
        asset.generationStatus === "queued" ||
        asset.generationStatus === "processing",
    ),
    [assets],
  );

  useEffect(() => {
    if (!hasActiveAssets) return;
    const timer = window.setInterval(() => void load(true), 2_000);
    return () => window.clearInterval(timer);
  }, [hasActiveAssets, load]);

  const displayedAssets = [...assets].sort(
    (left, right) =>
      left.taskIndex - right.taskIndex || left.clipStartMs - right.clipStartMs,
  );

  async function generate() {
    try {
      setSaving(true);
      setError("");
      const result = await generateTaskSegments(annotationRunId);
      setMessage(
        `任务 ${result.taskCount} 个：新建 ${result.created}，已有 ${result.existing}，跳过 ${result.skipped}`,
      );
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "任务片段生成触发失败");
    } finally {
      setSaving(false);
    }
  }

  async function retry(assetId: string) {
    try {
      setSaving(true);
      setError("");
      await retryTaskSegment(assetId);
      setMessage("失败片段已重新排队");
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "片段重试失败");
    } finally {
      setSaving(false);
    }
  }

  async function play(assetId: string) {
    try {
      setError("");
      const preview = await getTaskSegmentPreview(assetId);
      setPreviewUrls((current) => ({ ...current, [assetId]: preview.url }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "片段预览失败");
    }
  }

  return (
    <section
      className={`task-segment-demo${structured ? " task-segment-demo-structured" : ""}`}
      aria-label={structured ? "任务片段" : "任务片段 Demo"}
    >
      {!structured ? (
        <>
          <div className="ai-conclusion-head">
            <span><Scissors size={14} />任务片段 Demo</span>
            <StatusBadge label="internal_only" tone="info" />
          </div>
          <small className="field-hint">
            {annotationRunId} · task_segment_demo_policy_v1 · DEMO_DEFAULT
          </small>
        </>
      ) : null}
      <div className="task-segment-actions">
        <button
          className="table-action"
          type="button"
          disabled={saving || !canGenerate}
          onClick={() => void generate()}
        >
          <Scissors size={15} />生成任务片段
        </button>
        <button
          className="table-action"
          type="button"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} />刷新
        </button>
      </div>
      {!canGenerate ? (
        <p className="form-message info">
          {structured
            ? "正式标注发布后才可以生成任务切片。"
            : "只有正式 auto_accepted 或 human_verified Run 可以生成。"}
        </p>
      ) : null}
      {message ? <p className="form-message info">{message}</p> : null}
      {error ? <p className="form-message error">{error}</p> : null}
      {loading ? (
        <p><FileVideo size={15} />正在读取任务片段…</p>
      ) : assets.length === 0 ? (
        <p>尚未生成任务片段。</p>
      ) : (
        <div className="task-segment-list">
          {displayedAssets.map((asset) => {
            const currentStatus = status(asset, structured);
            const annotation = annotationsByTask.get(asset.taskIndex);
            const objects = annotation?.objects.length
              ? annotation.objects.join("、")
              : "—";
            const actions = (annotation?.actions.length
              ? annotation.actions
              : [asset.taskVerb])
              .map((action) => ACTION_LABELS[action] ?? action)
              .join("、");
            const completion = completionLabel(
              annotation?.completion || asset.completion,
            );
            return (
              <fieldset className="issue-editor task-segment-card" key={asset.id}>
                <legend>
                  {structured
                    ? <><span className="submission-task-number">任务 {asset.taskIndex + 1}</span>{" "}<span>{compactTimestamp(asset.clipStartMs)}～{compactTimestamp(asset.clipEndMs)} {asset.taskLabel}</span></>
                    : `Task #${asset.taskIndex} · ${asset.taskLabel}`}
                </legend>
                <div className="issue-editor-heading">
                  {structured ? (
                    <div className="task-segment-meta">
                      <span className="task-segment-meta-item"><em>对象</em>{objects}</span>
                      <span className="task-segment-meta-item"><em>动作</em>{actions || "—"}</span>
                      <span className="task-segment-meta-item"><em>完成状态</em>{completion}</span>
                    </div>
                  ) : (
                    <span>{timestamp(asset.clipStartMs)} → {timestamp(asset.clipEndMs)}</span>
                  )}
                  <StatusBadge label={currentStatus.label} tone={currentStatus.tone} />
                </div>
                {!structured ? (
                  <>
                    <details>
                      <summary>边界技术信息</summary>
                      <small>
                        粗边界：{timestamp(asset.coarseStartMs)} → {timestamp(asset.coarseEndMs)}
                      </small>
                      <small>
                        精修边界：{asset.refinedStartMs === null ? "—" : timestamp(asset.refinedStartMs)} → {asset.refinedEndMs === null ? "—" : timestamp(asset.refinedEndMs)}
                      </small>
                      <small>
                        实际切片：{asset.actualClipStartMs === null ? "—" : timestamp(asset.actualClipStartMs)} → {asset.actualClipEndMs === null ? "—" : timestamp(asset.actualClipEndMs)}
                      </small>
                      <small>
                        来源：{asset.boundarySource} · 精修状态：{asset.boundaryRefinementStatus ?? "未启用"} · {asset.boundaryRefinementPolicyVersion ?? "—"}
                      </small>
                    </details>
                    <small>{asset.completion} / {asset.resultStatus} · {asset.taskVerb}</small>
                    <small>
                      Run：<a href={`/admin/ai/annotation-runs/${encodeURIComponent(asset.annotationRunId)}/review`}>{asset.annotationRunId}</a>
                    </small>
                    <small>
                      Submission：<a href={`/admin/submissions/${encodeURIComponent(submissionId)}`}>{submissionId}</a>
                    </small>
                    <small>MinIO Key：<code>{asset.clipObjectKey ?? "—"}</code></small>
                    <small>SHA-256：<code>{asset.clipSha256 ?? "—"}</code></small>
                    <small>
                      时长 {asset.clipDurationMs === null ? "—" : `${asset.clipDurationMs}ms`} · {fileSize(asset.clipSizeBytes)}
                      {asset.codec
                        ? ` · ${asset.codec} ${asset.width}×${asset.height} @ ${asset.frameRate?.toFixed(2)}fps`
                        : ""}
                      {asset.hasAudio === null ? "" : asset.hasAudio ? " · 含音频" : " · 无音频"}
                    </small>
                  </>
                ) : null}
                {!structured && asset.validationWarnings.length > 0 ? (
                  <details>
                    <summary>技术校验 warning（{asset.validationWarnings.length}）</summary>
                    <pre>{asset.validationWarnings.join("\n")}</pre>
                  </details>
                ) : null}
                {asset.failureMessage ? (
                  <p className="form-message error">{asset.failureCode}：{asset.failureMessage}</p>
                ) : null}
                {asset.generationStatus === "ready" ? (
                  <button className="table-action" type="button" onClick={() => void play(asset.id)}>
                    <Play size={14} />播放片段
                  </button>
                ) : null}
                {asset.generationStatus === "failed" || asset.generationStatus === "skipped" ? (
                  <button
                    className="table-action"
                    disabled={saving}
                    type="button"
                    onClick={() => void retry(asset.id)}
                  >
                    <RotateCcw size={14} />重新生成
                  </button>
                ) : null}
                {previewUrls[asset.id] ? (
                  <video className="task-segment-player" controls preload="metadata">
                    <source src={previewUrls[asset.id]} type="video/mp4" />
                  </video>
                ) : null}
              </fieldset>
            );
          })}
        </div>
      )}
    </section>
  );
}
