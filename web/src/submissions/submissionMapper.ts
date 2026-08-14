import type { ProcessingStatus, Submission } from "../domain/types";
import type {
  BackendMediaSegment,
  BackendProcessingStatus,
  BackendSubmission,
} from "./contracts";

function processingStatus(status: BackendProcessingStatus): ProcessingStatus {
  if (status === "uploading") return "uploading";
  if (status === "queued") return "queued";
  if (
    status === "probing" ||
    status === "awaiting_ai" ||
    status === "ai_processing"
  ) {
    return "processing";
  }
  if (status === "completed") return "completed";
  return "failed";
}

function invalidSeconds(segments: BackendMediaSegment[]): number {
  const ranges = segments
    .filter((segment) => segment.invalid)
    .map((segment) => [segment.startSeconds, segment.endSeconds] as const)
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let start: number | null = null;
  let end: number | null = null;
  for (const [nextStart, nextEnd] of ranges) {
    if (start === null || end === null) {
      start = nextStart;
      end = nextEnd;
    } else if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      total += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  if (start !== null && end !== null) total += end - start;
  return Math.round(total * 1_000) / 1_000;
}

function createdAt(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function mappedQualityStatus(
  source: BackendSubmission,
): Submission["qualityStatus"] {
  if (source.quality?.status === "scored") return "passed";
  if (source.quality?.status === "hard_reject") return "failed";
  return "pending";
}

function aiIssues(source: BackendSubmission): Submission["issues"] {
  const invalid =
    source.quality?.invalidSegments.map((segment) => ({
      label: segment.reasonCode,
      start: Math.round(segment.startMs) / 1_000,
      end: Math.round(segment.endMs) / 1_000,
    })) ?? [];
  const deductions = (source.quality?.deductions ?? []).flatMap((item) => {
    const start = Number(item.start_ms);
    const end = Number(item.end_ms);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [];
    }
    return [
      {
        label:
          typeof item.description === "string"
            ? item.description
            : String(item.reason_code ?? "AI 质检问题"),
        start: start / 1_000,
        end: end / 1_000,
      },
    ];
  });
  return [...invalid, ...deductions];
}

export function backendSubmissionToDomain(
  source: BackendSubmission,
): Submission {
  const detected = source.quality?.detectedTask;
  const qualityInvalidSeconds = source.quality?.invalidDurationMs;
  const qualityIssues = aiIssues(source);
  return {
    id: source.id,
    fileName: source.fileName,
    ownerId: source.ownerId,
    ownerName: source.ownerName,
    teamId: source.teamId,
    teamName: source.teamName,
    scene: detected?.scene_id || "待 AI 识别",
    action:
      detected?.task_summary ||
      (source.processingStatus === "awaiting_ai"
        ? "等待 AI 质检"
        : source.processingStatus === "ai_processing"
          ? "AI 质检中"
          : "媒体处理中"),
    object: detected?.variant_id || "待 AI 识别",
    durationSeconds: source.media
      ? Math.round(source.media.durationSeconds)
      : 0,
    invalidSeconds:
      qualityInvalidSeconds === null || qualityInvalidSeconds === undefined
        ? invalidSeconds(source.segments)
        : Math.round(qualityInvalidSeconds) / 1_000,
    sizeMb:
      Math.round((Number(source.sizeBytes) / 1024 / 1024) * 10) / 10,
    resolution: source.media
      ? `${source.media.width}×${source.media.height}`
      : "解析中",
    processingStatus: processingStatus(source.processingStatus),
    pipelineStage: source.processingStatus,
    qualityStatus: mappedQualityStatus(source),
    aiScore: source.quality?.finalScore ?? 0,
    finalScore: source.quality?.finalScore ?? 0,
    qualityResult: source.quality
      ? {
          status: source.quality.status,
          summary: source.quality.summary,
          recommendations: source.quality.recommendations,
          reviewReasons: source.quality.reviewReasons,
          initialModel: source.quality.initialModel,
          reviewModel: source.quality.reviewModel,
          promptRevision: source.quality.promptRevision,
          promptContentSha256: source.quality.promptContentSha256,
          settlementRatio: source.quality.settlementRatio,
          qualityRawScore: source.quality.qualityRawScore,
          qualityScore: source.quality.qualityScore,
          demandCoefficient: source.quality.demandCoefficient,
          demandStatus: source.quality.demandStatus,
          ruleVersion: source.quality.ruleVersion,
          dimensions: source.quality.dimensions,
          deductions: source.quality.deductions,
          attempts: source.quality.attempts,
          lastError: source.quality.lastError,
          startedAt: source.quality.startedAt
            ? createdAt(source.quality.startedAt)
            : undefined,
          completedAt: source.quality.completedAt
            ? createdAt(source.quality.completedAt)
            : undefined,
        }
      : undefined,
    settlementStatus: "unsettled",
    createdAt: createdAt(source.createdAt),
    completedAt: source.quality?.completedAt
      ? createdAt(source.quality.completedAt)
      : undefined,
    tags: source.isTestData ? ["测试数据"] : [],
    issues:
      qualityIssues.length > 0
        ? qualityIssues
        : source.segments.map((segment) => ({
            label: segment.type === "black" ? "黑屏" : "画面冻结",
            start: segment.startSeconds,
            end: segment.endSeconds,
          })),
    audit: [],
  };
}
