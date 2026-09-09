import { describe, expect, it } from "vitest";

import {
  applyServerTaskCompliance,
  normalizeVideoQcResult,
} from "../src/video-quality/video-qc-rule-engine.js";
import type {
  PreparedVideoEvidence,
  RawQualityDimension,
  RawVideoQcResultV1,
  VideoQcInputV1,
} from "../src/video-quality/video-quality.types.js";
import { buildVideoQcInput } from "../src/video-quality/video-qc-input.js";

const rawDimensionKeys: Array<keyof RawVideoQcResultV1["dimensions"]> = [
  "D1",
  "D2",
  "D3",
  "D4",
  "D5",
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

function dimension(coefficient: number): RawQualityDimension {
  return {
    coefficient,
    score: Number((20 * coefficient).toFixed(1)),
    confidence: 0.95,
    metrics: {},
    issues: [],
  };
}

function rawAt(
  score: number,
  status: RawVideoQcResultV1["evaluation_status"] = "completed",
): RawVideoQcResultV1 {
  const coefficient = score / 100;
  const dimensions = Object.fromEntries(
    rawDimensionKeys.map((key) => [key, dimension(coefficient)]),
  ) as RawVideoQcResultV1["dimensions"];
  return {
    schema_version: "video_qc_v2",
    rule_version: "video_qc_v2",
    prompt_version: "qwen_video_qc_prompt_v4",
    task_id: "LAB-1",
    evaluation_status: status,
    input_status: {
      is_complete: true,
      missing_required_inputs: [],
      conflicts: [],
    },
    task_summary: "test",
    overall_result: {
      raw_total_score: score,
      final_score: score,
      summary: "test",
    },
    hard_reject: {
      triggered: status === "hard_reject",
      reasons: status === "hard_reject" ? ["FAKE_OR_NON_TASK"] : [],
      candidates: [],
    },
    dimensions,
    review: {
      review_required: false,
      review_reasons: [],
    },
    duration_result: {
      analysis_duration_ms: 10_000,
      invalid_duration_ms: 2_000,
      effective_duration_ms: 8_000,
      effective_duration_ratio: 0.8,
      invalid_segments: [],
      necessary_wait_segments: [],
    },
    recommendations: [],
  };
}

function normalize(raw: RawVideoQcResultV1, sourceEvidence = evidence()) {
  const sourceInput: VideoQcInputV1 = buildVideoQcInput({
    videoId: raw.task_id,
    evidence: sourceEvidence,
    exactBatchDuplicate: false,
  });
  return normalizeVideoQcResult({
    raw,
    sourceInput,
    evidence: sourceEvidence,
    modelRuns: [],
  });
}

describe("video_qc_v2 rule engine", () => {
  it("maps exact score boundaries to the confirmed four bands", () => {
    expect(normalize(rawAt(80)).settlementRatio).toBe(1);
    expect(normalize(rawAt(60)).settlementRatio).toBe(0.7);
    expect(normalize(rawAt(40)).settlementRatio).toBe(0);
    expect(normalize(rawAt(39.9)).settlementRatio).toBe(0);
  });

  it("keeps a hard reject score but forces zero settlement", () => {
    const result = normalize(rawAt(88, "hard_reject"));

    expect(result.finalScore).toBe(88);
    expect(result.evaluationStatus).toBe("hard_reject");
    expect(result.settlementRatio).toBe(0);
  });

  it("keeps incomplete input non-settleable but computes value while review-pending", () => {
    // 缺输入：数据不可用，不计算价值
    expect(
      normalize(rawAt(88, "incomplete_input")).settlementRatio,
    ).toBeNull();
    // 人工复核降频：模型标 review_pending 但无可决问题 → 服务端放行为 scored，价值照算
    const reviewed = normalize(rawAt(88, "review_pending"));
    expect(reviewed.evaluationStatus).toBe("scored");
    expect(reviewed.settlementRatio).toBe(1);
  });

  it("unions deterministic and semantic invalid intervals", () => {
    const raw = rawAt(80);
    raw.duration_result.invalid_segments.push({
      reason_code: "UNRELATED_CONTENT",
      description: "unrelated",
      start_ms: 2_000,
      end_ms: 4_000,
      confidence: 0.95,
      evidence_timestamps_ms: [2_500],
    });
    raw.duration_result.invalid_duration_ms = 3_000;
    raw.duration_result.effective_duration_ms = 7_000;
    raw.duration_result.effective_duration_ratio = 0.7;

    const result = normalize(raw);

    expect(result.invalidDurationMs).toBe(3_000);
    expect(result.billableDurationMs).toBe(7_000);
  });

  it("recomputes scores; evidence-free deductions stay review-pending but value is computed", () => {
    const raw = rawAt(80);
    raw.dimensions.D1.score = 20;
    raw.dimensions.D1.issues.push({
      reason_code: "NON_FIRST_PERSON",
      description: "no evidence",
      start_ms: 0,
      end_ms: 5_000,
      severity: "major",
      confidence: 0.9,
      evidence_timestamps_ms: [],
      source: "visual_model",
    });

    const result = normalize(raw);

    expect(result.dimensions.first_person_and_composition.score).toBe(16);
    expect(result.evaluationStatus).toBe("review_pending");
    // 价值解耦：复核中也按自动分数计算结算比率
    expect(result.settlementRatio).not.toBeNull();
    expect(result.validation.errors.join(" ")).toContain("证据");
  });

  it("accepts whole-video technical deductions without visual evidence timestamps", () => {
    const raw = rawAt(58);
    raw.dimensions.D3.issues.push({
      reason_code: "LOW_RESOLUTION",
      description: "短边分辨率低于质量标准",
      start_ms: 0,
      end_ms: 10_000,
      severity: "major",
      confidence: 1,
      evidence_timestamps_ms: [],
      source: "technical_metrics",
    });

    const result = normalize(raw);

    expect(result.validation.errors).toEqual([]);
    expect(result.evaluationStatus).toBe("scored");
    expect(result.reviewRequired).toBe(false);
  });

  it("keeps unavailable optional technical metrics out of the review queue", () => {
    const raw = rawAt(80, "incomplete_input");
    raw.input_status.is_complete = false;
    raw.input_status.missing_required_inputs = [
      "blur_ratio",
      "underexposure_ratio",
    ];
    const sourceEvidence = evidence();
    sourceEvidence.technicalMetrics.blur_ratio = null;
    sourceEvidence.technicalMetrics.underexposure_ratio = null;
    sourceEvidence.missingMetrics = [
      "blur_ratio",
      "underexposure_ratio",
    ];

    const result = normalize(raw, sourceEvidence);

    expect(result.evaluationStatus).toBe("scored");
    expect(result.reviewRequired).toBe(false);
    expect(result.reviewReasons).toEqual([]);
    expect(result.missingInputs).toEqual([
      "blur_ratio",
      "underexposure_ratio",
    ]);
  });

  it("downgrades segmentable veto candidates and low confidence to scored (review reduction)", () => {
    // 时段性候选（NO_HAND_OR_OBJECT）：任务切片粒度可规避 → 不触发复核
    const noHand = rawAt(70);
    noHand.evaluation_status = "review_pending";
    noHand.hard_reject.candidates = ["NO_HAND_OR_OBJECT"];
    noHand.review.review_required = true;
    noHand.review.review_reasons = ["主体操作中 70% 看不到手部或对象"];
    const noHandResult = normalize(noHand);
    expect(noHandResult.evaluationStatus).toBe("scored");
    expect(noHandResult.reviewReasons).toEqual([]);
    expect(noHandResult.validation.warnings.join(" ")).toContain("时段性");

    // 低置信度：分数表达价值，不触发复核
    const lowConfidence = rawAt(70);
    lowConfidence.evaluation_status = "review_pending";
    lowConfidence.dimensions.D1.confidence = 0.5;
    expect(normalize(lowConfidence).evaluationStatus).toBe("scored");

    // 疑似重复（S_total>=0.92）：转 duplicate 流程，不触发复核
    const duplicate = rawAt(70);
    duplicate.evaluation_status = "review_pending";
    duplicate.dimensions.D5.metrics.S_total = 0.95;
    expect(normalize(duplicate).evaluationStatus).toBe("scored");
  });

  it("keeps decisive veto candidates and scene mismatch in review", () => {
    const privacy = rawAt(70);
    privacy.evaluation_status = "review_pending";
    privacy.hard_reject.candidates = ["PRIVACY_OR_SAFETY"];
    expect(normalize(privacy).evaluationStatus).toBe("review_pending");

    const sceneMismatch = rawAt(70);
    sceneMismatch.evaluation_status = "review_pending";
    sceneMismatch.task_compliance = {
      scene_match: { matched: false, confidence: 0.9, note: "mismatch" },
      items: [],
      compliance_ratio: 0,
      review_required: false,
    };
    // 场景不匹配（全局性）在服务端任务符合度复算时进入复核（applyServerTaskCompliance）
    const complianceApplied = applyServerTaskCompliance(
      normalize(sceneMismatch),
      sceneMismatch.task_compliance,
    );
    expect(complianceApplied.evaluationStatus).toBe("review_pending");
  });

  it("uses the unrounded dimension values before final rounding", () => {
    const raw = rawAt(0);
    for (const key of rawDimensionKeys) {
      raw.dimensions[key].coefficient = 0.333;
      raw.dimensions[key].score = 6.7;
    }
    raw.overall_result.raw_total_score = 33.3;
    raw.overall_result.final_score = 33.3;

    expect(normalize(raw).finalScore).toBe(33.3);
  });
});
