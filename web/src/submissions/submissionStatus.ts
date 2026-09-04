import type { Submission } from "../domain/types";

export type SubmissionStatus = {
  label: string;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
};

export function submissionStatus(item: Submission): SubmissionStatus {
  if (
    item.qualityResult?.status === "review_pending" &&
    item.qualityResult.manualReview === undefined
  ) {
    return { label: "等待人工复核", tone: "warning" };
  }
  if (item.qualityStatus === "passed") {
    return { label: "质量通过", tone: "success" };
  }
  if (item.qualityStatus === "failed") {
    return { label: "需要返工", tone: "danger" };
  }
  if (item.qualityResult?.status === "stuck" || item.pipelineStage === "stuck") {
    return { label: "任务卡住", tone: "danger" };
  }
  if (
    item.qualityResult?.status === "system_failed" ||
    item.pipelineStage === "system_failed"
  ) {
    return { label: "质检异常", tone: "danger" };
  }
  if (item.qualityResult?.status === "scored") {
    return { label: "质检完成", tone: "success" };
  }
  if (item.pipelineStage === "probing") {
    return { label: "媒体分析中", tone: "info" };
  }
  if (item.pipelineStage === "ai_processing") {
    return { label: "AI 质检中", tone: "info" };
  }
  if (item.pipelineStage === "awaiting_ai") {
    return { label: "等待 AI 质检", tone: "warning" };
  }
  if (item.pipelineStage === "queued") {
    return { label: "等待媒体分析", tone: "warning" };
  }
  if (item.processingStatus === "uploading") {
    return { label: "上传中", tone: "info" };
  }
  if (item.processingStatus === "failed") {
    return { label: "处理失败", tone: "danger" };
  }
  if (item.processingStatus === "completed") {
    return { label: "处理完成", tone: "success" };
  }
  return { label: "等待处理", tone: "warning" };
}
