import { describe, expect, it } from "vitest";

import {
  repairSchemaOutput,
  unwrapAnnotationCandidate,
} from "../src/video-annotation/schema-repair.js";

function baseOutput() {
  return {
    schema_version: "ego_video_annotation_v2",
    video_id: "video-1",
    video_summary: "测试",
    scene: { coarse_label: "indoor", fine_label: null, confidence: 0.9, evidence_timestamps_ms: [0, 500] },
    temporal_structure_type: "single_task",
    model_assessability: "assessable",
    assessability_reason: "ok",
    tasks: [{
      start_ms: 0, end_ms: 1_000, task_label: "任务", task_verb: "pick_and_place",
      task_object: "杯子", evidence_level: "direct_visual", execution_pattern: "single_goal",
      evidence_timestamps_ms: [0, 500, 1_000], manipulated_objects: [], tools: [], hand_mode: "right",
      atomic_action_sequence: [], interaction_primitives: ["grasp"],
      completion: "complete", result_observability: "visible", result_status: "success",
      result_evidence_type: "direct_visible_postcondition", visible_postcondition: "ok",
      result_evidence_timestamps_ms: [1_000], failure_recovery: "none_observed",
      failure_evidence_timestamps_ms: [], recovery_evidence_timestamps_ms: [],
      complexity_signals: [], uncertainty_reasons: [], confidence: 0.9,
    }],
    coverage_segments: [{ start_ms: 0, end_ms: 1_000, segment_type: "task", linked_task_index: 0, visible_activity: "v", evidence_timestamps_ms: [0, 1_000] }],
    uncertain_fields: [],
    global_limitations: [],
  };
}

describe("deterministic schema repair (schema-repair)", () => {
  it("keeps a fully valid output unchanged", () => {
    const output = baseOutput();
    const { value, changes } = repairSchemaOutput(output);
    expect(changes).toHaveLength(0);
    expect(value).toEqual(output);
  });

  it("maps invalid enum values to conservative legal values", () => {
    const output = baseOutput();
    (output.tasks[0] as Record<string, unknown>).result_observability = "visible_observation";
    (output.tasks[0] as Record<string, unknown>).completion = "completed";
    (output.tasks[0] as Record<string, unknown>).failure_recovery = "failed";

    const { value, changes } = repairSchemaOutput(output);
    const task = (value as any).tasks[0];
    expect(task.result_observability).toBe("partial");
    expect(task.completion).toBe("uncertain");
    expect(task.failure_recovery).toBe("not_assessable");
    const codes = changes.map((change) => change.code);
    expect(codes).toEqual(["ENUM_VALUE_CONSERVATIVE_FIX", "ENUM_VALUE_CONSERVATIVE_FIX", "ENUM_VALUE_CONSERVATIVE_FIX"]);
  });

  it("downsamples oversized evidence arrays keeping first and last", () => {
    const output = baseOutput();
    const many = Array.from({ length: 25 }, (_, index) => index * 100);
    (output.tasks[0] as Record<string, unknown>).evidence_timestamps_ms = many;
    (output.tasks[0] as Record<string, unknown>).atomic_action_sequence = [
      { order: 1, verb: "grasp", object: "杯子", evidence_timestamps_ms: Array.from({ length: 12 }, (_, index) => index * 10) },
    ];

    const { value, changes } = repairSchemaOutput(output);
    const task = (value as any).tasks[0];
    expect(task.evidence_timestamps_ms).toHaveLength(20);
    expect(task.evidence_timestamps_ms[0]).toBe(0);
    expect(task.evidence_timestamps_ms.at(-1)).toBe(2_400);
    expect(task.atomic_action_sequence[0].evidence_timestamps_ms).toHaveLength(8);
    expect(task.atomic_action_sequence[0].evidence_timestamps_ms[0]).toBe(0);
    expect(task.atomic_action_sequence[0].evidence_timestamps_ms.at(-1)).toBe(110);
    expect(changes.map((change) => change.code)).toEqual(["EVIDENCE_ARRAY_DOWNSAMPLED", "EVIDENCE_ARRAY_DOWNSAMPLED"]);
  });

  it("filters invalid enum array elements", () => {
    const output = baseOutput();
    (output.tasks[0] as Record<string, unknown>).interaction_primitives = ["grasp", "hold_forever"];

    const { value, changes } = repairSchemaOutput(output);
    expect((value as any).tasks[0].interaction_primitives).toEqual(["grasp"]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.code).toBe("ENUM_ARRAY_INVALID_FILTERED");
  });

  it("unwraps metadata-wrapped model output (output_contract/annotation)", () => {
    const annotation = baseOutput();
    const wrapped = {
      video_id: "video-1",
      duration_ms: 1000,
      frame_manifest: "x",
      frame_timestamps_ms: [0, 500],
      annotation_context: { enabled_labels: [] },
      requested_output_schema: "s",
      output_contract: annotation,
    };
    expect(unwrapAnnotationCandidate(wrapped)).toBe(annotation);

    const wrapped2 = { annotation: annotation };
    expect(unwrapAnnotationCandidate(wrapped2)).toBe(annotation);

    // 直接是标注时原样返回
    expect(unwrapAnnotationCandidate(annotation)).toBe(annotation);
    // 找不到时原样返回
    const mystery = { foo: 1, bar: { baz: 2 } };
    expect(unwrapAnnotationCandidate(mystery)).toBe(mystery);
  });

  it("aligns non-frame evidence timestamps to nearest sampling frame", () => {
    const output = baseOutput();
    // 帧集合：0, 500, 1000, 1500（间隔 500ms，容忍度 1000ms）
    (output.tasks[0] as Record<string, unknown>).evidence_timestamps_ms = [0, 480, 990];
    const frames = new Set([0, 500, 1000, 1500]);

    const { value, changes } = repairSchemaOutput(output, frames);
    expect((value as any).tasks[0].evidence_timestamps_ms).toEqual([0, 500, 1000]);
    expect(changes.map((change) => change.code)).toEqual(["EVIDENCE_TIMESTAMPS_ALIGNED"]);
  });

  it("aligns task start_ms/end_ms boundaries to sampling frames", () => {
    const output = baseOutput();
    (output.tasks[0] as Record<string, unknown>).start_ms = 480;
    (output.tasks[0] as Record<string, unknown>).end_ms = 990;
    const frames = new Set([0, 500, 1000, 1500]);

    const { value, changes } = repairSchemaOutput(output, frames);
    const task = (value as any).tasks[0];
    expect(task.start_ms).toBe(500);
    expect(task.end_ms).toBe(1000);
    expect(changes.map((change) => change.code)).toContain("TASK_BOUNDARY_ALIGNED");
  });

  it("does not align obviously fabricated far-away timestamps", () => {
    const output = baseOutput();
    (output.tasks[0] as Record<string, unknown>).evidence_timestamps_ms = [0, 99999];
    const frames = new Set([0, 500, 1000, 1500]);

    const { value, changes } = repairSchemaOutput(output, frames);
    // 99999 距最近帧过远（>容忍度），保持原值；此时对齐修复不产生
    expect((value as any).tasks[0].evidence_timestamps_ms).toEqual([0, 99999]);
    expect(changes).toHaveLength(0);
  });

  it("normalizes null nullable-string fields to empty strings", () => {
    const output = baseOutput();
    (output.tasks[0] as Record<string, unknown>).visible_postcondition = null;
    (output as Record<string, unknown>).video_summary = null;

    const { value, changes } = repairSchemaOutput(output);
    expect((value as any).tasks[0].visible_postcondition).toBe("");
    expect((value as any).video_summary).toBe("");
    expect(changes.map((change) => change.code)).toEqual(["NULL_STRING_NORMALIZED", "NULL_STRING_NORMALIZED"]);
  });

  it("repairs coverage segment_type and oversized coverage evidence", () => {
    const output = baseOutput();
    (output.coverage_segments[0] as Record<string, unknown>).segment_type = "activity";
    (output.coverage_segments[0] as Record<string, unknown>).evidence_timestamps_ms = Array.from({ length: 120 }, (_, index) => index * 10);

    const { value, changes } = repairSchemaOutput(output);
    const segment = (value as any).coverage_segments[0];
    expect(segment.segment_type).toBe("unclear");
    expect(segment.evidence_timestamps_ms).toHaveLength(100);
    expect(changes).toHaveLength(2);
  });
});