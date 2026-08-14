import { z } from "zod";

import type { RawVideoQcResultV1 } from "./video-quality.types.js";

const boundedCoefficient = z.number().finite().min(0).max(1);
const nonNegativeTime = z.number().finite().nonnegative();

const segmentBaseSchema = z.object({
  start_ms: nonNegativeTime,
  end_ms: nonNegativeTime,
  evidence_timestamps_ms: z.array(nonNegativeTime).min(1),
});

const viewSegmentSchema = segmentBaseSchema
  .extend({
    c_pov: boundedCoefficient,
    c_angle: boundedCoefficient,
    c_orientation: boundedCoefficient,
    c_arm_entry: boundedCoefficient,
  })
  .strict();

const handSegmentSchema = segmentBaseSchema
  .extend({
    hand_required: z.boolean(),
    c_completeness: boundedCoefficient,
    c_edge: boundedCoefficient,
    c_scale: boundedCoefficient,
    c_occlusion: boundedCoefficient,
    c_object_visibility: boundedCoefficient,
  })
  .strict();

const frameSegmentSchema = segmentBaseSchema
  .extend({
    c_sharpness: boundedCoefficient,
    c_exposure: boundedCoefficient,
    c_stability: boundedCoefficient,
    c_continuity: boundedCoefficient,
  })
  .strict();

const taskSegmentSchema = segmentBaseSchema
  .extend({
    level: z.enum(["L3", "L2", "L1", "L0", "INVALID"]),
    c_level: boundedCoefficient,
    c_authenticity: boundedCoefficient,
    c_progress: boundedCoefficient,
  })
  .strict();

const issueSchema = z
  .object({
    dimension: z.string().optional(),
    reason_code: z.string().min(1),
    description: z.string(),
    start_ms: nonNegativeTime,
    end_ms: nonNegativeTime,
    severity: z.enum(["minor", "moderate", "major", "critical"]),
    confidence: boundedCoefficient,
    evidence_timestamps_ms: z.array(nonNegativeTime),
    subcriterion: z.string().optional(),
    rule_id: z.string().optional(),
    observed_value: z.string().optional(),
    matched_level: z.string().optional(),
    coefficient: boundedCoefficient.optional(),
    points_before: z.number().finite().min(0).max(25).optional(),
    deducted_points: z.number().finite().min(0).max(25).optional(),
    points_after: z.number().finite().min(0).max(25).optional(),
    scope: z.enum(["full_video", "time_range"]).optional(),
    evidence_source: z
      .enum(["model", "detector", "demand_snapshot", "human_review"])
      .optional(),
    recommendation: z.string().optional(),
    is_controlling: z.boolean().optional(),
  })
  .strict();

const dimensionBaseSchema = z
  .object({
    coefficient: boundedCoefficient,
    score: z.number().finite().min(0).max(25),
    confidence: boundedCoefficient,
    calculation_trace: z.string(),
    issues: z.array(issueSchema.omit({ dimension: true })),
    hand_active_duration_ms: nonNegativeTime.optional(),
    c_spec: boundedCoefficient.optional(),
    c_visual: boundedCoefficient.optional(),
    completion_coefficient: boundedCoefficient.optional(),
    inventory_coefficient: boundedCoefficient.optional(),
    unique_coefficient: boundedCoefficient.optional(),
    similarity_total: boundedCoefficient.optional(),
  })
  .strict();

const viewDimensionSchema = dimensionBaseSchema.extend({
  segments: z.array(viewSegmentSchema).min(1),
});

const handDimensionSchema = dimensionBaseSchema.extend({
  hand_active_duration_ms: nonNegativeTime,
  segments: z.array(handSegmentSchema).min(1),
});

const frameDimensionSchema = dimensionBaseSchema.extend({
  c_spec: boundedCoefficient,
  c_visual: boundedCoefficient,
  segments: z.array(frameSegmentSchema).min(1),
});

const taskDimensionSchema = dimensionBaseSchema.extend({
  completion_coefficient: boundedCoefficient,
  segments: z.array(taskSegmentSchema).min(1),
});

const demandDimensionSchema = dimensionBaseSchema.extend({
  // 第五维是服务端需求快照，不要求模型生成视觉片段。
  segments: z.array(z.record(z.string(), z.unknown())).default([]),
});

const invalidSegmentSchema = z
  .object({
    reason_code: z.string().min(1),
    description: z.string(),
    start_ms: nonNegativeTime,
    end_ms: nonNegativeTime,
    confidence: boundedCoefficient,
    evidence_timestamps_ms: z.array(nonNegativeTime),
  })
  .strict();

const waitingSegmentSchema = z
  .object({
    waiting_type: z.string().min(1),
    description: z.string(),
    start_ms: nonNegativeTime,
    end_ms: nonNegativeTime,
    confidence: boundedCoefficient,
    evidence_timestamps_ms: z.array(nonNegativeTime),
  })
  .strict();

export const rawVideoQcResultSchema = z
  .object({
    schema_version: z.literal("video_qc_result_v2"),
    rule_version: z.literal("video_qc_v2_traceable"),
    prompt_version: z.literal("qwen_video_qc_prompt_v2_traceable"),
    video_id: z.string().min(1),
    evaluation_status: z.enum([
      "scored",
      "hard_reject",
      "incomplete_input",
      "review_pending",
    ]),
    hard_veto: z
      .object({
        triggered: z.boolean(),
        reasons: z.array(
          z.union([z.string(), z.record(z.string(), z.unknown())]),
        ),
      })
      .strict(),
    detected_task: z
      .object({
        scene_id: z.string(),
        task_id: z.string(),
        variant_id: z.string(),
        task_summary: z.string(),
        confidence: boundedCoefficient,
      })
      .strict(),
    dimensions: z
      .object({
        first_person_and_composition: viewDimensionSchema,
        hand_forearm_object_integrity: handDimensionSchema,
        frame_and_video_quality: frameDimensionSchema,
        task_authenticity_completeness: taskDimensionSchema,
        task_value_uniqueness: demandDimensionSchema,
      })
      .strict(),
    billing_observations: z
      .object({
        candidate_invalid_segments: z.array(invalidSegmentSchema),
        candidate_valid_waiting_segments: z.array(waitingSegmentSchema),
      })
      .strict(),
    raw_total_score: z.number().finite().min(0).max(100),
    final_score: z.number().finite().min(0).max(100),
    summary: z.string(),
    deductions: z.array(issueSchema),
    recommendations: z.array(z.string()),
    review_required: z.boolean(),
    review_reasons: z.array(z.string()),
    missing_inputs: z.array(z.string()),
  })
  .strict();

export class VideoQcSchemaError extends Error {
  constructor(
    message: string,
    readonly validationIssues: string[],
  ) {
    super(message);
  }
}

export function parseRawVideoQcResult(value: unknown): RawVideoQcResultV1 {
  const parsed = rawVideoQcResultSchema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "result"}: ${issue.message}`,
    );
    throw new VideoQcSchemaError("模型结果不符合 video_qc_result_v2", issues);
  }
  return parsed.data as RawVideoQcResultV1;
}
