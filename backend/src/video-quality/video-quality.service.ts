import type {
  ModelRunResult,
  ReviewVideoQualityRequest,
} from "./qwen-video-quality.provider.js";
import type { ReviewWindow } from "./media-preprocessor.js";
import { buildVideoQcInput } from "./video-qc-input.js";
import { normalizeVideoQcResult } from "./video-qc-rule-engine.js";
import type {
  NormalizedVideoQcResultV1,
  PreparedVideoEvidence,
  QualityStage,
  RawVideoQcResultV1,
  TimestampedFrame,
  VideoQcInputV1,
} from "./video-quality.types.js";

export interface VideoEvidencePreprocessor {
  prepare(
    filePath: string,
    workDirectory: string,
    signal?: AbortSignal,
  ): Promise<PreparedVideoEvidence>;
  extractReviewFrames(
    filePath: string,
    windows: ReviewWindow[],
    workDirectory: string,
    signal?: AbortSignal,
  ): Promise<TimestampedFrame[]>;
}

export interface VideoQualityModelProvider {
  analyze(
    request: { input: VideoQcInputV1; frames: TimestampedFrame[] },
    signal?: AbortSignal,
  ): Promise<ModelRunResult>;
  review(
    request: ReviewVideoQualityRequest,
    signal?: AbortSignal,
  ): Promise<ModelRunResult>;
}

export type EvaluateVideoQualityRequest = {
  videoId: string;
  filePath: string;
  workDirectory: string;
  registerSha256: (sha256: string) => boolean;
  demandContext?: {
    snapshotId: string;
    status: "紧缺" | "推荐" | "已饱和";
    coefficient: number;
  };
};

export type QualityProgressObserver = (stage: QualityStage) => void;

function needsReview(
  raw: RawVideoQcResultV1,
  normalized: NormalizedVideoQcResultV1,
): boolean {
  if (raw.evaluation_status === "review_pending") return true;
  if (raw.review_required || raw.hard_veto.triggered) return true;
  if (raw.detected_task.confidence < 0.75) return true;
  if (
    Object.values(raw.dimensions).some(
      (dimension) => dimension.confidence < 0.75,
    )
  ) {
    return true;
  }
  if (normalized.validation.errors.length > 0) return true;
  const similarity = raw.dimensions.task_value_uniqueness.similarity_total;
  return typeof similarity === "number" && similarity >= 0.92;
}

function reviewWindows(
  raw: RawVideoQcResultV1,
  durationMs: number,
): ReviewWindow[] {
  const candidates: ReviewWindow[] = [];
  for (const deduction of raw.deductions) {
    candidates.push({ startMs: deduction.start_ms, endMs: deduction.end_ms });
  }
  for (const segment of raw.billing_observations.candidate_invalid_segments) {
    candidates.push({ startMs: segment.start_ms, endMs: segment.end_ms });
  }
  for (const dimension of Object.values(raw.dimensions)) {
    for (const issue of dimension.issues) {
      candidates.push({ startMs: issue.start_ms, endMs: issue.end_ms });
    }
  }
  if (candidates.length === 0) {
    return [{ startMs: 0, endMs: Math.min(durationMs, 60_000) }];
  }
  const unique = new Map<string, ReviewWindow>();
  for (const candidate of candidates) {
    const startMs = Math.max(0, Math.min(durationMs, candidate.startMs));
    const endMs = Math.max(0, Math.min(durationMs, candidate.endMs));
    if (endMs <= startMs) continue;
    const key = `${Math.round(startMs / 1_000)}:${Math.round(endMs / 1_000)}`;
    unique.set(key, { startMs, endMs });
  }
  return [...unique.values()].slice(0, 8);
}

function reviewReasons(
  raw: RawVideoQcResultV1,
  normalized: NormalizedVideoQcResultV1,
): string[] {
  const reasons = [...raw.review_reasons];
  if (raw.hard_veto.triggered) reasons.push("初审模型检出硬性否决候选");
  if (raw.detected_task.confidence < 0.75) reasons.push("任务分类置信度不足");
  for (const [key, dimension] of Object.entries(raw.dimensions)) {
    if (dimension.confidence < 0.75) reasons.push(`${key} 置信度不足`);
  }
  reasons.push(...normalized.validation.errors);
  return [...new Set(reasons)];
}

export class VideoQualityService {
  private readonly preprocessor: VideoEvidencePreprocessor;
  private readonly provider: VideoQualityModelProvider;

  constructor(options: {
    preprocessor: VideoEvidencePreprocessor;
    provider: VideoQualityModelProvider;
  }) {
    this.preprocessor = options.preprocessor;
    this.provider = options.provider;
  }

  async evaluate(
    request: EvaluateVideoQualityRequest,
    observer: QualityProgressObserver = () => undefined,
    signal?: AbortSignal,
  ): Promise<NormalizedVideoQcResultV1> {
    observer("media_analysis");
    const evidence = await this.preprocessor.prepare(
      request.filePath,
      request.workDirectory,
      signal,
    );
    const exactBatchDuplicate = request.registerSha256(evidence.sha256);
    const videoInput = buildVideoQcInput({
      videoId: request.videoId,
      evidence,
      exactBatchDuplicate,
      demandContext: request.demandContext,
    });

    observer("initial_review");
    const initialRun = await this.provider.analyze(
      { input: videoInput, frames: evidence.fullVideoFrames },
      signal,
    );
    const initial = normalizeVideoQcResult({
      raw: initialRun.raw,
      sourceInput: videoInput,
      evidence,
      modelRuns: [initialRun.metadata],
    });
    if (!needsReview(initialRun.raw, initial)) {
      observer(initial.evaluationStatus === "review_pending" ? "review_pending" : "completed");
      return initial;
    }

    observer("secondary_review");
    try {
      const windows = reviewWindows(
        initialRun.raw,
        evidence.metadata.duration_ms,
      );
      const frames = await this.preprocessor.extractReviewFrames(
        request.filePath,
        windows,
        request.workDirectory,
        signal,
      );
      const reviewRun = await this.provider.review(
        {
          input: videoInput,
          frames,
          initialResult: initialRun.raw,
          reviewReasons: reviewReasons(initialRun.raw, initial),
        },
        signal,
      );
      const reviewed = normalizeVideoQcResult({
        raw: reviewRun.raw,
        sourceInput: videoInput,
        evidence,
        modelRuns: [initialRun.metadata, reviewRun.metadata],
      });
      observer(
        reviewed.evaluationStatus === "review_pending"
          ? "review_pending"
          : "completed",
      );
      return reviewed;
    } catch (error) {
      if (signal?.aborted) throw error;
      observer("review_pending");
      return {
        ...initial,
        evaluationStatus: "review_pending",
        settlementRatio: null,
        reviewRequired: true,
        reviewReasons: [
          ...initial.reviewReasons,
          `复核模型失败：${error instanceof Error ? error.message : "未知错误"}`,
        ],
      };
    }
  }
}
