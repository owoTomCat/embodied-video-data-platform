import { describe, expect, it, vi } from "vitest";

import {
  VideoQualityService,
  isInDeterministicSample,
  type VideoEvidencePreprocessor,
  type VideoQualityModelProvider,
} from "../src/video-quality/video-quality.service.js";
import type {
  PreparedVideoEvidence,
  RawVideoQcResultV1,
} from "../src/video-quality/video-quality.types.js";
import type { VideoAnnotationProvider } from "../src/video-annotation/qwen-video-annotation.provider.js";

function evidence(): PreparedVideoEvidence {
  return {
    sha256: "d".repeat(64),
    metadata: {
      display_width: 1920,
      display_height: 1080,
      display_aspect_ratio: 16 / 9,
      duration_ms: 30_000,
      nominal_fps: 60,
      effective_fps: 60,
      codec: "h264",
      bitrate_bps: 2_000_000,
      file_size_bytes: 100,
      rotation_degrees: 0,
    },
    technicalMetrics: {
      decodable: true,
      decoded_duration_ms: 30_000,
      black_ratio: 0,
      freeze_ratio: 0,
      blur_ratio: null,
      underexposure_ratio: null,
      overexposure_ratio: null,
      timestamp_discontinuity_ratio: null,
      detector_windows: [],
    },
    fullVideoFrames: [
      { timestampMs: 0, dataUrl: "data:image/jpeg;base64,AA==" },
      { timestampMs: 5_000, dataUrl: "data:image/jpeg;base64,AQ==" },
      { timestampMs: 10_000, dataUrl: "data:image/jpeg;base64,Ag==" },
      { timestampMs: 15_000, dataUrl: "data:image/jpeg;base64,Aw==" },
    ],
    fullVideoSamplingFps: 0.2,
    missingMetrics: ["blur_ratio"],
  };
}

function raw(reviewRequired = false): RawVideoQcResultV1 {
  const confidence = reviewRequired ? 0.6 : 0.9;
  return {
    schema_version: "video_qc_v2",
    rule_version: "video_qc_v2",
    prompt_version: "qwen_video_qc_prompt_v4",
    task_id: "LAB-1",
    evaluation_status: reviewRequired ? "review_pending" : "completed",
    input_status: {
      is_complete: true,
      missing_required_inputs: [],
      conflicts: [],
    },
    task_summary: "task",
    overall_result: {
      raw_total_score: 80,
      final_score: 80,
      summary: "summary",
    },
    hard_reject: { triggered: false, reasons: [], candidates: [] },
    dimensions: Object.fromEntries(
      (["D1", "D2", "D3", "D4", "D5"] as const).map((key) => [
        key,
        {
          coefficient: 0.8,
          score: 16,
          confidence,
          metrics: {},
          issues: [],
        },
      ]),
    ) as unknown as RawVideoQcResultV1["dimensions"],
    review: {
      review_required: reviewRequired,
      review_reasons: reviewRequired ? ["置信度不足"] : [],
    },
    duration_result: {
      analysis_duration_ms: 30_000,
      invalid_duration_ms: 0,
      effective_duration_ms: 30_000,
      effective_duration_ratio: 1,
      invalid_segments: [],
      necessary_wait_segments: [],
    },
    recommendations: [],
  };
}

function setup(
  options: {
    review?: boolean;
    reviewFails?: boolean;
    annotationProvider?: VideoAnnotationProvider;
  } = {},
) {
  const prepared = evidence();
  const preprocessor: VideoEvidencePreprocessor = {
    prepare: vi.fn().mockResolvedValue(prepared),
    extractReviewFrames: vi
      .fn()
      .mockResolvedValue([
        { timestampMs: 5_000, dataUrl: "data:image/jpeg;base64,BA==" },
      ]),
  };
  const provider: VideoQualityModelProvider = {
    analyze: vi.fn().mockResolvedValue({
      raw: raw(options.review),
      metadata: {
        stage: "initial",
        model: "qwen3.7-plus",
        requestId: "initial-id",
        durationMs: 5,
        frameCount: 4,
      },
    }),
    review: options.reviewFails
      ? vi.fn().mockRejectedValue(new Error("secondary review failed"))
      : vi.fn().mockResolvedValue({
          raw: raw(false),
          metadata: {
            stage: "review",
            model: "qwen3.7-flash",
            requestId: "review-id",
            durationMs: 5,
            frameCount: 1,
          },
        }),
  };
  return {
    service: new VideoQualityService({
      preprocessor,
      provider,
      annotationProvider: options.annotationProvider,
    }),
    preprocessor,
    provider,
  };
}

describe("video quality service", () => {
  it("uses stable sampling for staged shadow rollout", () => {
    expect(isInDeterministicSample("SUB-1", 0)).toBe(false);
    expect(isInDeterministicSample("SUB-1", 1)).toBe(true);
    expect(isInDeterministicSample("SUB-80", 0.1)).toBe(true);
    expect(isInDeterministicSample("SUB-123", 0.1)).toBe(false);
  });
  it("runs the initial model once and returns a server-normalized result", async () => {
    const { service, provider } = setup();
    const stages: string[] = [];

    const result = await service.evaluate(
      {
        videoId: "LAB-1",
        filePath: "/tmp/video.mp4",
        workDirectory: "/tmp/work",
        registerSha256: () => false,
      },
      (stage) => stages.push(stage),
    );

    expect(stages).toEqual(["media_analysis", "initial_review", "completed"]);
    expect(provider.analyze).toHaveBeenCalledOnce();
    expect(provider.review).not.toHaveBeenCalled();
    expect(result.finalScore).toBe(80);
    expect(result.settlementRatio).toBe(1);
  });

  it("registers exact batch duplicates before building model input", async () => {
    const { service, provider } = setup();

    await service.evaluate({
      videoId: "LAB-1",
      filePath: "/tmp/video.mp4",
      workDirectory: "/tmp/work",
      registerSha256: (sha256) => sha256 === "d".repeat(64),
    });

    expect(provider.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          similarity_context: expect.objectContaining({
            file_hash_exact: true,
            confirmed_duplicate: true,
          }),
        }),
      }),
      undefined,
    );
  });

  it("runs the review model for review predicates and preserves pending state if it fails", async () => {
    const reviewed = setup({ review: true });
    const stages: string[] = [];
    const result = await reviewed.service.evaluate(
      {
        videoId: "LAB-1",
        filePath: "/tmp/video.mp4",
        workDirectory: "/tmp/work",
        registerSha256: () => false,
      },
      (stage) => stages.push(stage),
    );
    expect(stages).toEqual([
      "media_analysis",
      "initial_review",
      "secondary_review",
      "completed",
    ]);
    expect(reviewed.provider.review).toHaveBeenCalledOnce();
    const reviewRequest = vi.mocked(reviewed.provider.review).mock.calls[0]?.[0];
    expect(reviewRequest?.frames).toHaveLength(4);
    expect(reviewRequest?.frames).toEqual(
      expect.arrayContaining([
        { timestampMs: 5_000, dataUrl: "data:image/jpeg;base64,BA==" },
      ]),
    );
    expect(result.modelRuns.map((run) => run.stage)).toEqual(["initial", "review"]);

    const failed = setup({ review: true, reviewFails: true });
    const pending = await failed.service.evaluate({
      videoId: "LAB-1",
      filePath: "/tmp/video.mp4",
      workDirectory: "/tmp/work",
      registerSha256: () => false,
    });
    expect(pending.evaluationStatus).toBe("review_pending");
    expect(pending.settlementRatio).toBeNull();
    expect(pending.reviewReasons.join(" ")).toContain("复核模型");
  });

  it("attaches shadow annotations without changing the quality decision", async () => {
    const annotationProvider: VideoAnnotationProvider = {
      annotate: vi.fn().mockResolvedValue({
        status: "system_failed",
        schemaVersion: "ego_video_annotation_v2",
        policyVersion: "ego_annotation_evidence_policy_v2",
        promptVersion: "annotation-prompt-v2",
        promptContentSha256: "a".repeat(64),
        model: "annotation-model",
        error: "shadow request failed",
      }),
    };
    const { service } = setup({ annotationProvider });

    const result = await service.evaluate({
      videoId: "LAB-1",
      filePath: "/tmp/video.mp4",
      workDirectory: "/tmp/work",
      registerSha256: () => false,
      annotationLabels: [
        { id: "scene-1", name: "厨房", type: "scene" },
      ],
    });

    expect(annotationProvider.annotate).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: "LAB-1",
        durationMs: 30_000,
        frames: expect.any(Array),
        enabledLabels: [{ id: "scene-1", name: "厨房", type: "scene" }],
      }),
      undefined,
    );
    expect(result.candidateAnnotation).toMatchObject({
      status: "system_failed",
      error: "shadow request failed",
    });
    expect(result.finalScore).toBe(80);
    expect(result.settlementRatio).toBe(1);
  });

  it("absorbs an unexpected shadow rejection without failing quality", async () => {
    const annotationProvider: VideoAnnotationProvider = {
      annotate: vi.fn().mockRejectedValue(new Error("unexpected shadow error")),
    };
    const { service } = setup({ annotationProvider });

    const result = await service.evaluate({
      videoId: "LAB-1",
      filePath: "/tmp/video.mp4",
      workDirectory: "/tmp/work",
      registerSha256: () => false,
    });

    expect(result.candidateAnnotation).toBeUndefined();
    expect(result.finalScore).toBe(80);
    expect(result.settlementRatio).toBe(1);
  });
});
