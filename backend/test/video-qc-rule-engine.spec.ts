import { describe, expect, it } from "vitest";

import { normalizeVideoQcResult } from "../src/video-quality/video-qc-rule-engine.js";
import type {
  DimensionKey,
  PreparedVideoEvidence,
  RawVideoQcResultV1,
  VideoQcInputV1,
} from "../src/video-quality/video-quality.types.js";
import { buildVideoQcInput } from "../src/video-quality/video-qc-input.js";

const dimensionKeys: DimensionKey[] = [
  "first_person_and_composition",
  "hand_forearm_object_integrity",
  "frame_and_video_quality",
  "task_authenticity_completeness",
  "task_value_uniqueness",
];

function evidence(): PreparedVideoEvidence {
  return {
    sha256: "b".repeat(64),
    metadata: {
      display_width: 1920,
      display_height: 1080,
      display_aspect_ratio: 16 / 9,
      duration_ms: 10_000,
      nominal_fps: 60,
      effective_fps: 60,
      codec: "h264",
      bitrate_bps: 1_000_000,
      file_size_bytes: 10_000,
      rotation_degrees: 0,
    },
    technicalMetrics: {
      decodable: true,
      decoded_duration_ms: 10_000,
      black_ratio: 0.2,
      freeze_ratio: 0,
      blur_ratio: 0,
      underexposure_ratio: 0,
      overexposure_ratio: 0,
      timestamp_discontinuity_ratio: 0,
      detector_windows: [
        {
          type: "black",
          start_ms: 1_000,
          end_ms: 3_000,
          confidence: 1,
          source: "ffmpeg",
        },
      ],
    },
    fullVideoFrames: [],
    fullVideoSamplingFps: 0.2,
    missingMetrics: [],
  };
}

function rawAt(
  qualityRawScore: number,
  status: RawVideoQcResultV1["evaluation_status"] = "scored",
): RawVideoQcResultV1 {
  const remaining = Math.max(0, qualityRawScore - 25) / 25;
  const coefficients = [
    1,
    Math.min(1, remaining),
    Math.min(1, Math.max(0, remaining - 1)),
    Math.min(1, Math.max(0, remaining - 2)),
  ];
  const qualityKeys = dimensionKeys.slice(0, 4);
  const splitSegments = (
    coefficient: number,
    high: Record<string, unknown>,
    low: Record<string, unknown>,
  ): Array<Record<string, unknown>> => {
    const boundary = Math.round(10_000 * coefficient);
    if (boundary <= 0) return [{ start_ms: 0, end_ms: 10_000, evidence_timestamps_ms: [5_000], ...low }];
    if (boundary >= 10_000) return [{ start_ms: 0, end_ms: 10_000, evidence_timestamps_ms: [5_000], ...high }];
    return [
      { start_ms: 0, end_ms: boundary, evidence_timestamps_ms: [Math.floor(boundary / 2)], ...high },
      { start_ms: boundary, end_ms: 10_000, evidence_timestamps_ms: [Math.floor((boundary + 10_000) / 2)], ...low },
    ];
  };
  const dimensions = Object.fromEntries(
    dimensionKeys.map((key, index) => [
      key,
      {
        coefficient: key === "task_value_uniqueness" ? 1 : coefficients[index],
        score: key === "task_value_uniqueness" ? 0 : Number((25 * (coefficients[index] ?? 0)).toFixed(1)),
        confidence: 0.95,
        calculation_trace: "25 × coefficient",
        segments: key === "first_person_and_composition"
          ? [{ start_ms: 0, end_ms: 10_000, evidence_timestamps_ms: [5_000], c_pov: 1, c_angle: 1, c_orientation: 1, c_arm_entry: 1 }]
          : key === "hand_forearm_object_integrity"
            ? splitSegments(coefficients[index] ?? 0, { hand_required: true, c_completeness: 1, c_edge: 1, c_scale: 1, c_occlusion: 1, c_object_visibility: 1 }, { hand_required: true, c_completeness: 0, c_edge: 1, c_scale: 1, c_occlusion: 1, c_object_visibility: 1 })
            : key === "frame_and_video_quality"
              ? splitSegments(coefficients[index] ?? 0, { c_sharpness: 1, c_exposure: 1, c_stability: 1, c_continuity: 1 }, { c_sharpness: 0, c_exposure: 1, c_stability: 1, c_continuity: 1 })
              : key === "task_authenticity_completeness"
                ? splitSegments(coefficients[index] ?? 0, { level: "L3", c_level: 1, c_authenticity: 1, c_progress: 1 }, { level: "INVALID", c_level: 0, c_authenticity: 1, c_progress: 1 })
                : [],
        issues: qualityKeys.includes(key) && Number(coefficients[index] ?? 1) < 1
          ? [{
              reason_code: `TEST_QUALITY_LOSS_${key}`,
              subcriterion: key === "hand_forearm_object_integrity"
                ? "COMPLETENESS"
                : key === "frame_and_video_quality"
                  ? "SHARPNESS"
                  : "LEVEL",
              observed_value: "测试区间命中低档因子",
              matched_level: "测试低档",
              coefficient: 0,
              description: "测试用质量扣分原因",
              start_ms: 0,
              end_ms: 10_000,
              severity: "minor" as const,
              confidence: 0.95,
              evidence_timestamps_ms: [1_000],
              evidence_source: "model" as const,
              recommendation: "调整拍摄后重新上传",
            }]
          : [],
        ...(key === "hand_forearm_object_integrity" ? { hand_active_duration_ms: 10_000 } : {}),
        ...(key === "frame_and_video_quality" ? { c_spec: 1, c_visual: coefficients[index] } : {}),
        ...(key === "task_authenticity_completeness" ? { completion_coefficient: 1 } : {}),
      },
    ]),
  ) as unknown as RawVideoQcResultV1["dimensions"];
  return {
    schema_version: "video_qc_result_v2",
    rule_version: "video_qc_v2_traceable",
    prompt_version: "qwen_video_qc_prompt_v2_traceable",
    video_id: "LAB-1",
    evaluation_status: status,
    hard_veto: {
      triggered: status === "hard_reject",
      reasons: status === "hard_reject" ? ["FAKE_OR_NON_TASK"] : [],
    },
    detected_task: {
      scene_id: "",
      task_id: "",
      variant_id: "",
      task_summary: "test",
      confidence: 0.95,
    },
    dimensions,
    billing_observations: {
      candidate_invalid_segments: [],
      candidate_valid_waiting_segments: [],
    },
    raw_total_score: qualityRawScore,
    final_score: Number(qualityRawScore.toFixed(1)),
    summary: "test",
    deductions: [],
    recommendations: [],
    review_required: false,
    review_reasons: [],
    missing_inputs: [],
  };
}

function normalize(raw: RawVideoQcResultV1, sourceEvidence = evidence()) {
  const sourceInput: VideoQcInputV1 = buildVideoQcInput({
    videoId: raw.video_id,
    evidence: sourceEvidence,
    exactBatchDuplicate: false,
    demandContext: {
      snapshotId: "test-demand",
      status: raw.dimensions.task_value_uniqueness.coefficient >= 0.9
        ? "紧缺"
        : raw.dimensions.task_value_uniqueness.coefficient >= 0.5
          ? "推荐"
          : "已饱和",
      coefficient: raw.dimensions.task_value_uniqueness.coefficient,
    },
  });
  return normalizeVideoQcResult({
    raw,
    sourceInput,
    evidence: sourceEvidence,
    modelRuns: [],
  });
}

describe("video_qc_v2_traceable rule engine", () => {
  it("maps exact Q100 boundaries to the confirmed quality bands", () => {
    expect(normalize(rawAt(80)).settlementRatio).toBe(1);
    expect(normalize(rawAt(60)).settlementRatio).toBe(0.8);
    expect(normalize(rawAt(40)).settlementRatio).toBe(0.6);
    expect(normalize(rawAt(39.9)).settlementRatio).toBeNull();
  });

  it("keeps a hard reject score but forces zero settlement", () => {
    const result = normalize(rawAt(70.4, "hard_reject"));

    expect(result.finalScore).toBe(70.4);
    expect(result.evaluationStatus).toBe("hard_reject");
    expect(result.settlementRatio).toBe(0);
  });

  it("multiplies the four-dimension quality score and settlement by demand once", () => {
    const raw = rawAt(80);
    raw.dimensions.task_value_uniqueness.coefficient = 0.3;
    raw.dimensions.task_value_uniqueness.score = 7.5;
    raw.final_score = 24;

    const result = normalize(raw);

    expect(result.qualityRawScore).toBe(80);
    expect(result.qualityScore).toBe(80);
    expect(result.demandStatus).toBe("已饱和");
    expect(result.finalScore).toBe(24);
    expect(result.settlementRatio).toBe(0.3);
  });

  it("does not settle incomplete or review-pending results", () => {
    expect(
      normalize(rawAt(70.4, "incomplete_input")).settlementRatio,
    ).toBeNull();
    expect(
      normalize(rawAt(70.4, "review_pending")).settlementRatio,
    ).toBeNull();
  });

  it("unions deterministic and semantic invalid intervals", () => {
    const raw = rawAt(64);
    raw.billing_observations.candidate_invalid_segments.push({
      reason_code: "UNRELATED_CONTENT",
      description: "unrelated",
      start_ms: 2_000,
      end_ms: 4_000,
      confidence: 0.95,
      evidence_timestamps_ms: [2_500],
    });

    const result = normalize(raw);

    expect(result.invalidDurationMs).toBe(3_000);
    expect(result.billableDurationMs).toBe(7_000);
  });

  it("rejects a D2 score that contradicts its factors and requires evidence", () => {
    const raw = rawAt(100);
    raw.dimensions.hand_forearm_object_integrity.segments = [{
      start_ms: 0,
      end_ms: 10_000,
      evidence_timestamps_ms: [5_000],
      hand_required: true,
      c_completeness: 1,
      c_edge: 1,
      c_scale: 0.85,
      c_occlusion: 1,
      c_object_visibility: 1,
    }];
    raw.dimensions.hand_forearm_object_integrity.coefficient = 0.92;
    raw.dimensions.hand_forearm_object_integrity.score = 23;
    raw.dimensions.hand_forearm_object_integrity.issues = [{
      reason_code: "HAND_SCALE_TOO_LARGE",
      subcriterion: "SCALE",
      coefficient: 0.85,
      description: "操作区域过大",
      observed_value: "操作区域占画面 60%",
      matched_level: "55%～70%",
      recommendation: "适当拉远镜头",
      evidence_source: "model",
      start_ms: 0,
      end_ms: 10_000,
      severity: "minor",
      confidence: 0.9,
      evidence_timestamps_ms: [],
    }];
    raw.raw_total_score = 98;
    raw.final_score = 98;

    const result = normalize(raw);

    expect(result.dimensions.hand_forearm_object_integrity.score).toBe(21.3);
    expect(result.evaluationStatus).toBe("review_pending");
    expect(result.settlementRatio).toBeNull();
    expect(result.validation.errors.join(" ")).toContain("证据");
    expect(result.validation.errors.join(" ")).toContain("模型总系数");
    expect(result.deductions.find((item) => item.reason_code === "HAND_SCALE_TOO_LARGE")).toMatchObject({
      dimension: "hand_forearm_object_integrity",
      rule_id: "HAND.SCALE.C085",
      deducted_points: 3.7,
      points_after: 21.3,
      is_controlling: true,
    });
  });

  it("allocates D1 loss to the exact contributing subcriteria", () => {
    const raw = rawAt(100);
    raw.dimensions.first_person_and_composition.segments = [{
      start_ms: 0,
      end_ms: 10_000,
      evidence_timestamps_ms: [5_000],
      c_pov: 0.8,
      c_angle: 0.8,
      c_orientation: 1,
      c_arm_entry: 1,
    }];
    raw.dimensions.first_person_and_composition.coefficient = 0.85;
    raw.dimensions.first_person_and_composition.score = 21.3;
    raw.dimensions.first_person_and_composition.issues = [
      {
        reason_code: "POV_UNCERTAIN",
        subcriterion: "POV",
        observed_value: "视角接近第一人称，但固定机位痕迹明显",
        matched_level: "大概率第一人称，证据不充分",
        coefficient: 0.8,
        description: "第一人称证据不足",
        start_ms: 0,
        end_ms: 10_000,
        severity: "minor",
        confidence: 0.9,
        evidence_timestamps_ms: [5_000],
        evidence_source: "model",
        recommendation: "使用头戴或胸戴机位",
      },
      {
        reason_code: "ANGLE_SLIGHTLY_OFF",
        subcriterion: "ANGLE",
        observed_value: "镜头略高于自然观察角度",
        matched_level: "镜头略高",
        coefficient: 0.8,
        description: "视角略高",
        start_ms: 0,
        end_ms: 10_000,
        severity: "minor",
        confidence: 0.9,
        evidence_timestamps_ms: [5_000],
        evidence_source: "model",
        recommendation: "将镜头调整到自然向下观察角度",
      },
    ];
    raw.raw_total_score = 96.3;
    raw.final_score = 96.3;

    const result = normalize(raw);
    const items = result.deductions.filter(
      (item) => item.dimension === "first_person_and_composition",
    );

    expect(result.validation.errors).toEqual([]);
    expect(items.map((item) => item.deducted_points)).toEqual([2.4, 1.3]);
    expect(items.reduce((sum, item) => sum + Number(item.deducted_points), 0)).toBe(3.7);
  });

  it("derives T_hand from full-timeline hand_required flags", () => {
    const raw = rawAt(100);
    raw.dimensions.hand_forearm_object_integrity.segments = [
      {
        start_ms: 0,
        end_ms: 8_000,
        evidence_timestamps_ms: [4_000],
        hand_required: true,
        c_completeness: 1,
        c_edge: 1,
        c_scale: 0.85,
        c_occlusion: 1,
        c_object_visibility: 1,
      },
      {
        start_ms: 8_000,
        end_ms: 10_000,
        evidence_timestamps_ms: [9_000],
        hand_required: false,
        c_completeness: 1,
        c_edge: 1,
        c_scale: 1,
        c_occlusion: 1,
        c_object_visibility: 1,
      },
    ];
    raw.dimensions.hand_forearm_object_integrity.hand_active_duration_ms = 8_000;
    raw.dimensions.hand_forearm_object_integrity.coefficient = 0.85;
    raw.dimensions.hand_forearm_object_integrity.score = 21.3;
    raw.dimensions.hand_forearm_object_integrity.issues = [{
      reason_code: "HAND_SCALE_TOO_LARGE",
      subcriterion: "SCALE",
      observed_value: "手部操作区间内操作区域占画面约 60%",
      matched_level: "55%～70%",
      coefficient: 0.85,
      description: "操作区域偏大",
      start_ms: 0,
      end_ms: 8_000,
      severity: "minor",
      confidence: 0.9,
      evidence_timestamps_ms: [4_000],
      evidence_source: "model",
      recommendation: "适当拉远镜头",
    }];
    raw.raw_total_score = 96.3;
    raw.final_score = 96.3;

    const result = normalize(raw);

    expect(result.validation.errors).toEqual([]);
    expect(result.dimensions.hand_forearm_object_integrity.score).toBe(21.3);
    expect(result.dimensions.hand_forearm_object_integrity.calculation_trace).toContain("T_hand=8000");
  });

  it("uses the unrounded dimension values before final rounding", () => {
    expect(normalize(rawAt(33.3)).finalScore).toBe(33.3);
  });

  it("adds detector-backed resolution and FPS explanations from media metadata", () => {
    const raw = rawAt(100);
    const sourceEvidence = evidence();
    sourceEvidence.metadata.display_width = 854;
    sourceEvidence.metadata.display_height = 480;
    sourceEvidence.metadata.display_aspect_ratio = 854 / 480;
    sourceEvidence.metadata.nominal_fps = 30;
    sourceEvidence.metadata.effective_fps = 30;
    raw.dimensions.frame_and_video_quality.coefficient = 0.35;
    raw.dimensions.frame_and_video_quality.score = 8.8;
    raw.dimensions.frame_and_video_quality.c_spec = 0.35;
    raw.raw_total_score = 83.8;
    raw.final_score = 83.8;

    const result = normalize(raw, sourceEvidence);
    const frameDeductions = result.deductions.filter(
      (item) => item.dimension === "frame_and_video_quality",
    );

    expect(result.validation.errors).toEqual([]);
    expect(frameDeductions.map((item) => item.subcriterion)).toEqual([
      "RESOLUTION",
      "FPS",
    ]);
    expect(frameDeductions.map((item) => item.deducted_points)).toEqual([16.2, 0]);
    expect(frameDeductions.every((item) => item.evidence_source === "detector")).toBe(true);
  });
});
