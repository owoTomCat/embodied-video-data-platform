"use client";

import { ArrowLeft, CopyCheck, FileVideo } from "lucide-react";
import { useEffect, useState } from "react";

import { QualityReportCard } from "../../components/QualityReportCard";
import { StatusBadge } from "../../components/StatusBadge";
import { useIdentity } from "../../auth/client/IdentityContext";
import { estimatePoints } from "../../domain/calculations";
import type { Submission } from "../../domain/types";
import { getPointRule } from "../../points/client/pointCycleApi";
import type { BackendPointRule } from "../../points/contracts";
import {
  getSubmission,
  getSubmissionPreview,
} from "../../submissions/client/submissionApi";
import type { BackendSubmissionPreview } from "../../submissions/contracts";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

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
  const { teams } = useIdentity();
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
      {duplicateCandidate && <div className="form-message warning"><CopyCheck size={14} />该视频疑似与 {duplicateCandidate.candidateFileName ?? duplicateCandidate.candidateSubmissionId} 重复，相似度 {Math.round(duplicateCandidate.similarity * 100)}%，管理员确认前不会进入积分锁定。</div>}
      <div className="detail-grid report-layout">
        <section className="video-preview">{preview ? <><video controls preload="metadata" poster={preview.thumbnail?.url} aria-label={`${preview.fileName} 预览`}>{preview.hls ? <source src={preview.hls.url} type={preview.hls.contentType} /> : null}<source src={preview.url} type={preview.contentType} /></video><span>{preview.hls ? `${preview.hls.qualities.map((quality) => quality.quality).join(" / ")}` : `${Math.floor(item.durationSeconds / 60)}:${String(item.durationSeconds % 60).padStart(2, "0")}`}</span></> : <div><FileVideo size={42} /><strong>{previewState === "loading" ? "正在生成预览地址" : "已保存原始视频"}</strong><small>{previewState === "unavailable" ? "预览暂时无法生成" : "视频已保存至平台对象存储"}</small></div>} {!preview ? <span>{Math.floor(item.durationSeconds / 60)}:{String(item.durationSeconds % 60).padStart(2, "0")}</span> : null}</section>
        <QualityReportCard
          submission={item}
          pointsLabel={pointsLabel}
          evidenceByRange={evidenceByRange}
        />
      </div>
    </div>
  );
}
