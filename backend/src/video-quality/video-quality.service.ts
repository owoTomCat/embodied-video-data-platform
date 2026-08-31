import type {
  ModelRunResult,
  ReviewVideoQualityRequest,
} from "./qwen-video-quality.provider.js";
import type { ReviewWindow } from "./media-preprocessor.js";
import { buildVideoQcInput } from "./video-qc-input.js";
import { normalizeVideoQcResult } from "./video-qc-rule-engine.js";
import type {
  InventoryContextInput,
  NormalizedVideoQcResultV1,
  PreparedVideoEvidence,
  QualityStage,
  RawVideoQcResultV1,
  TimestampedFrame,
  VideoQcInputV1,
} from "./video-quality.types.js";
import type { VideoAnnotationProvider } from "../video-annotation/qwen-video-annotation.provider.js";
import type { VideoAnnotationCandidate } from "../video-annotation/video-annotation.js";

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
  /** 库存稀缺度上下文（D5 维度）；缺省时 cold_start 不惩罚不奖励 */
  inventoryContext?: InventoryContextInput;
  /** 场景/动作/对象标签字典（供模型结构化分类） */
  labelDictionary?: string[];
  /** 候选内容标注使用的带类型标签；不包含任务合同或任务要求。 */
  annotationLabels?: Array<{
    id: string;
    name: string;
    type: "scene" | "action" | "object";
  }>;
};

export type QualityProgressObserver = (stage: QualityStage) => void;

function needsReview(
  raw: RawVideoQcResultV1,
  normalized: NormalizedVideoQcResultV1,
): boolean {
  if (raw.evaluation_status === "review_pending") return true;
  if (raw.review.review_required || raw.hard_reject.triggered) return true;
  if (raw.hard_reject.candidates.length > 0) return true;
  if (
    Object.values(raw.dimensions).some(
      (dimension) => dimension.confidence < 0.75,
    )
  ) {
    return true;
  }
  if (normalized.validation.errors.length > 0) return true;
  const similarity = raw.dimensions.D5.metrics.S_total ?? null;
  return typeof similarity === "number" && similarity >= 0.92;
}

function reviewWindows(
  raw: RawVideoQcResultV1,
  durationMs: number,
): ReviewWindow[] {
  const candidates: ReviewWindow[] = [];
  for (const dimension of Object.values(raw.dimensions)) {
    for (const issue of dimension.issues) {
      if (issue.start_ms !== null && issue.end_ms !== null) {
        candidates.push({ startMs: issue.start_ms, endMs: issue.end_ms });
      }
    }
  }
  for (const segment of raw.duration_result.invalid_segments) {
    if (segment.start_ms !== null && segment.end_ms !== null) {
      candidates.push({ startMs: segment.start_ms, endMs: segment.end_ms });
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
  const reasons = [...raw.review.review_reasons];
  if (raw.hard_reject.triggered) reasons.push("初审模型检出硬性否决候选");
  for (const [key, dimension] of Object.entries(raw.dimensions)) {
    if (dimension.confidence < 0.75) reasons.push(`${key} 置信度不足`);
  }
  reasons.push(...normalized.validation.errors);
  return [...new Set(reasons)];
}

function supplementReviewFrames(
  reviewFrames: TimestampedFrame[],
  fullVideoFrames: TimestampedFrame[],
): TimestampedFrame[] {
  const framesByTimestamp = new Map<number, TimestampedFrame>();
  for (const frame of reviewFrames) {
    framesByTimestamp.set(frame.timestampMs, frame);
  }
  for (const frame of fullVideoFrames) {
    if (framesByTimestamp.size >= 4) break;
    if (!framesByTimestamp.has(frame.timestampMs)) {
      framesByTimestamp.set(frame.timestampMs, frame);
    }
  }
  return [...framesByTimestamp.values()].sort(
    (left, right) => left.timestampMs - right.timestampMs,
  );
}

export function isInDeterministicSample(
  videoId: string,
  sampleRate: number,
): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  let hash = 2_166_136_261;
  for (const character of videoId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296 < sampleRate;
}

export class VideoQualityService {
  private readonly preprocessor: VideoEvidencePreprocessor;
  private readonly provider: VideoQualityModelProvider;
  private readonly annotationProvider?: VideoAnnotationProvider;
  private readonly annotationSampleRate: number;

  constructor(options: {
    preprocessor: VideoEvidencePreprocessor;
    provider: VideoQualityModelProvider;
    annotationProvider?: VideoAnnotationProvider;
    annotationSampleRate?: number;
  }) {
    this.preprocessor = options.preprocessor;
    this.provider = options.provider;
    this.annotationProvider = options.annotationProvider;
    this.annotationSampleRate = options.annotationSampleRate ?? 1;
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
      inventoryContext: request.inventoryContext,
      labelDictionary: request.labelDictionary,
    });
    const annotationPromise:
      | Promise<VideoAnnotationCandidate | undefined>
      | undefined =
      this.annotationProvider &&
      isInDeterministicSample(request.videoId, this.annotationSampleRate)
        ? this.annotationProvider.annotate(
            {
              videoId: request.videoId,
              durationMs: evidence.metadata.duration_ms,
              frames: evidence.fullVideoFrames,
              enabledLabels: request.annotationLabels ?? [],
            },
            signal,
          ).catch(() => undefined)
        : undefined;

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
      return this.attachCandidateAnnotation(initial, annotationPromise, signal);
    }

    observer("secondary_review");
    try {
      const windows = reviewWindows(
        initialRun.raw,
        evidence.metadata.duration_ms,
      );
      const extractedFrames = await this.preprocessor.extractReviewFrames(
        request.filePath,
        windows,
        request.workDirectory,
        signal,
      );
      const frames = supplementReviewFrames(
        extractedFrames,
        evidence.fullVideoFrames,
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
      return this.attachCandidateAnnotation(reviewed, annotationPromise, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      observer("review_pending");
      return this.attachCandidateAnnotation(
        {
          ...initial,
          evaluationStatus: "review_pending",
          settlementRatio: null,
          reviewRequired: true,
          reviewReasons: [
            ...initial.reviewReasons,
            `复核模型失败：${error instanceof Error ? error.message : "未知错误"}`,
          ],
        },
        annotationPromise,
        signal,
      );
    }
  }

  private async attachCandidateAnnotation(
    result: NormalizedVideoQcResultV1,
    annotationPromise:
      | Promise<VideoAnnotationCandidate | undefined>
      | undefined,
    signal?: AbortSignal,
  ): Promise<NormalizedVideoQcResultV1> {
    if (!annotationPromise) return result;
    try {
      const candidateAnnotation = await annotationPromise;
      if (!candidateAnnotation) return result;
      return { ...result, candidateAnnotation };
    } catch (error) {
      if (signal?.aborted) throw error;
      // Shadow annotation must never change the authoritative quality outcome.
      return result;
    }
  }
}
