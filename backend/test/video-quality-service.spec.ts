import { describe, expect, it, vi } from "vitest";

import {
  VideoQualityService,
  type VideoEvidencePreprocessor,
  type VideoQualityModelProvider,
} from "../src/video-quality/video-quality.service.js";
import type {
  DimensionKey,
  PreparedVideoEvidence,
  RawVideoQcResultV1,
} from "../src/video-quality/video-quality.types.js";

const keys: DimensionKey[] = [
  "first_person_and_composition",
  "hand_forearm_object_integrity",
  "frame_and_video_quality",
  "task_authenticity_completeness",
  "task_value_uniqueness",
];

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
  const segments: Partial<Record<DimensionKey, Array<Record<string, unknown>>>> = {
    first_person_and_composition: [{ start_ms: 0, end_ms: 30_000, evidence_timestamps_ms: [15_000], c_pov: 1, c_angle: 1, c_orientation: 1, c_arm_entry: 1 }],
    hand_forearm_object_integrity: [{ start_ms: 0, end_ms: 30_000, evidence_timestamps_ms: [15_000], hand_required: true, c_completeness: 1, c_edge: 1, c_scale: 1, c_occlusion: 1, c_object_visibility: 1 }],
    frame_and_video_quality: [{ start_ms: 0, end_ms: 30_000, evidence_timestamps_ms: [15_000], c_sharpness: 1, c_exposure: 1, c_stability: 1, c_continuity: 1 }],
    task_authenticity_completeness: [{ start_ms: 0, end_ms: 30_000, evidence_timestamps_ms: [15_000], level: "L3", c_level: 1, c_authenticity: 1, c_progress: 1 }],
    task_value_uniqueness: [],
  };
  return {
    schema_version: "video_qc_result_v2",
    rule_version: "video_qc_v2_traceable",
    prompt_version: "qwen_video_qc_prompt_v2_traceable",
    video_id: "LAB-1",
    evaluation_status: reviewRequired ? "review_pending" : "scored",
    hard_veto: { triggered: false, reasons: [] },
    detected_task: {
      scene_id: "",
      task_id: "task",
      variant_id: "",
      task_summary: "task",
      confidence: reviewRequired ? 0.6 : 0.9,
    },
    dimensions: Object.fromEntries(
      keys.map((key) => [
        key,
        {
          coefficient: 1,
          score: key === "task_value_uniqueness" ? 0 : 25,
          confidence: reviewRequired ? 0.6 : 0.9,
          calculation_trace: "25 × 1.0",
          segments: segments[key] ?? [],
          issues: [],
          ...(key === "hand_forearm_object_integrity" ? { hand_active_duration_ms: 30_000 } : {}),
          ...(key === "frame_and_video_quality" ? { c_spec: 1, c_visual: 1 } : {}),
          ...(key === "task_authenticity_completeness" ? { completion_coefficient: 1 } : {}),
        },
      ]),
    ) as unknown as RawVideoQcResultV1["dimensions"],
    billing_observations: {
      candidate_invalid_segments: [],
      candidate_valid_waiting_segments: [],
    },
    raw_total_score: 100,
    final_score: 100,
    summary: "summary",
    deductions: [],
    recommendations: [],
    review_required: reviewRequired,
    review_reasons: reviewRequired ? ["置信度不足"] : [],
    missing_inputs: [],
  };
}

function setup(options: { review?: boolean; reviewFails?: boolean } = {}) {
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
  return { service: new VideoQualityService({ preprocessor, provider }), preprocessor, provider };
}

describe("video quality service", () => {
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
    expect(result.finalScore).toBe(100);
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
});
