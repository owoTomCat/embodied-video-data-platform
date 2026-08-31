import { describe, expect, it } from "vitest";

import {
  normalizeVideoAnnotation,
  parseRawVideoAnnotation,
  type RawVideoAnnotation,
} from "../src/video-annotation/video-annotation.js";
import { canonicalizeVideoAnnotation } from "../src/video-annotation/annotation-auto-gate.js";

function rawAnnotation(): RawVideoAnnotation {
  return {
    schema_version: "ego_video_annotation_v2",
    video_id: "video-1",
    video_summary: "将杯子放到桌面右侧。",
    scene: {
      coarse_label: "indoor",
      fine_label: "kitchen",
      confidence: 0.9,
      evidence_timestamps_ms: [0, 1_000],
    },
    temporal_structure_type: "single_task",
    model_assessability: "assessable",
    assessability_reason: "采样间隔足以支持当前可见任务和稳定终态。",
    tasks: [
      {
        start_ms: 0,
        end_ms: 1_000,
        task_label: "放置杯子",
        task_verb: "pick_and_place",
        task_object: "杯子",
        evidence_level: "direct_visual",
        execution_pattern: "single_goal",
        evidence_timestamps_ms: [0, 500, 1_000],
        manipulated_objects: ["杯子"],
        tools: [],
        hand_mode: "right",
        atomic_action_sequence: [
          {
            order: 1,
            verb: "grasp",
            object: "杯子",
            evidence_timestamps_ms: [0],
          },
          {
            order: 2,
            verb: "place",
            object: "杯子",
            evidence_timestamps_ms: [500, 1_000],
          },
        ],
        interaction_primitives: ["grasp", "release"],
        completion: "complete",
        result_observability: "visible",
        result_status: "success",
        result_evidence_type: "direct_visible_postcondition",
        visible_postcondition: "杯子位于桌面右侧。",
        result_evidence_timestamps_ms: [500, 1_000],
        failure_recovery: "none_observed",
        failure_evidence_timestamps_ms: [],
        recovery_evidence_timestamps_ms: [],
        complexity_signals: [],
        uncertainty_reasons: [],
        confidence: 0.9,
      },
    ],
    coverage_segments: [
      {
        start_ms: 0,
        end_ms: 1_000,
        segment_type: "task",
        linked_task_index: 0,
        visible_activity: "拿起并放置杯子",
        evidence_timestamps_ms: [0, 500, 1_000],
      },
    ],
    uncertain_fields: [],
    global_limitations: [],
  };
}

function normalize(
  raw: RawVideoAnnotation,
  timestampsMs: number[],
) {
  return normalizeVideoAnnotation({
    raw,
    frames: timestampsMs.map((timestampMs) => ({
      timestampMs,
      dataUrl: "data:image/jpeg;base64,AA==",
    })),
    durationMs: 1_000,
    promptVersion: "prompt-v1",
    promptContentSha256: "a".repeat(64),
    model: "test-model",
    requestId: "request-1",
    modelDurationMs: 12,
  });
}

describe("video annotation evidence policy", () => {
  it("keeps directly supported dense annotations as candidates", () => {
    const result = normalize(rawAnnotation(), [0, 500, 1_000]);

    expect(result.status).toBe("candidate");
    expect(result.validation.errors).toEqual([]);
    expect(result.effective.tasks[0]).toMatchObject({
      effective_completion: "complete",
      effective_result_status: "success",
      effective_failure_recovery: "none_observed",
      policy_reasons: [],
    });
  });

  it("records sparse sampling as advisory without making it a manual gate", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.end_ms = 5_000;
    raw.tasks[0]!.evidence_timestamps_ms = [0, 5_000];
    raw.tasks[0]!.result_evidence_timestamps_ms = [0, 5_000];
    raw.tasks[0]!.atomic_action_sequence = [
      {
        order: 1,
        verb: "move",
        object: "杯子",
        evidence_timestamps_ms: [0, 5_000],
      },
    ];
    raw.scene.evidence_timestamps_ms = [0, 5_000];
    raw.coverage_segments[0] = {
      start_ms: 0,
      end_ms: 5_000,
      segment_type: "task",
      linked_task_index: 0,
      visible_activity: "移动杯子",
      evidence_timestamps_ms: [0, 5_000],
    };

    const result = normalizeVideoAnnotation({
      raw,
      frames: [0, 5_000].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      durationMs: 5_000,
      promptVersion: "prompt-v1",
      promptContentSha256: "a".repeat(64),
      model: "test-model",
      requestId: null,
      modelDurationMs: 12,
    });

    expect(result.status).toBe("candidate");
    expect(result.effective.tasks[0]).toMatchObject({
      effective_completion: "uncertain",
      effective_result_status: "unknown",
      effective_failure_recovery: "none_observed",
    });
    expect(result.effective.tasks[0]!.policy_reasons).toEqual(
      expect.not.arrayContaining(["sparse_sampling_cannot_verify_completion"]),
    );
    expect(result.gate).toMatchObject({ eligibility: "eligible" });
    expect(result.gate.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SPARSE_SAMPLING_OBSERVED", level: "advisory" }),
      ]),
    );
  });

  it("preserves a human-confirmed outcome while retaining structural evidence checks", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.end_ms = 5_000;
    raw.tasks[0]!.evidence_timestamps_ms = [0, 2_500, 5_000];
    raw.tasks[0]!.result_evidence_timestamps_ms = [2_500, 5_000];
    raw.tasks[0]!.atomic_action_sequence = [
      {
        order: 1,
        verb: "move",
        object: "杯子",
        evidence_timestamps_ms: [0, 2_500],
      },
    ];
    raw.scene.evidence_timestamps_ms = [0, 5_000];
    raw.coverage_segments[0] = {
      start_ms: 0,
      end_ms: 5_000,
      segment_type: "task",
      linked_task_index: 0,
      visible_activity: "移动杯子",
      evidence_timestamps_ms: [0, 2_500, 5_000],
    };

    const result = normalizeVideoAnnotation({
      raw,
      frames: [0, 2_500, 5_000].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      durationMs: 5_000,
      promptVersion: "prompt-v1",
      promptContentSha256: "a".repeat(64),
      model: "test-model",
      requestId: null,
      modelDurationMs: 0,
      applySparseEvidencePolicy: false,
    });

    expect(result.validation.errors).toEqual([]);
    expect(result.effective.tasks[0]).toMatchObject({
      effective_completion: "complete",
      effective_result_status: "success",
      effective_failure_recovery: "none_observed",
    });
    expect(result.effective.tasks[0]!.policy_reasons).not.toContain(
      "sparse_sampling_cannot_verify_outcome",
    );
  });

  it("downgrades unsupported completion and partial-result claims", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.evidence_timestamps_ms = [0, 1_000];
    raw.tasks[0]!.atomic_action_sequence = [
      {
        order: 1,
        verb: "move",
        object: "杯子",
        evidence_timestamps_ms: [0, 1_000],
      },
    ];
    raw.tasks[0]!.result_status = "partial";
    raw.tasks[0]!.result_evidence_type = "action_completion_only";
    raw.tasks[0]!.result_evidence_timestamps_ms = [];

    const result = normalize(raw, [0, 500, 1_000]);

    expect(result.effective.tasks[0]).toMatchObject({
      effective_completion: "uncertain",
      effective_result_status: "unknown",
    });
    expect(result.effective.tasks[0]!.policy_reasons).toEqual(
      expect.arrayContaining([
        "complete_task_requires_start_core_end_evidence",
        "partial_result_lacks_direct_postcondition_evidence",
      ]),
    );
  });

  it("requires failure evidence to precede recovery evidence", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.failure_recovery = "failure_then_recovery";
    raw.tasks[0]!.failure_evidence_timestamps_ms = [500];
    raw.tasks[0]!.recovery_evidence_timestamps_ms = [0];

    const result = normalize(raw, [0, 500, 1_000]);

    expect(result.effective.tasks[0]).toMatchObject({
      effective_failure_recovery: "not_assessable",
    });
    expect(result.effective.tasks[0]!.policy_reasons).toContain(
      "failure_recovery_evidence_order_invalid",
    );
  });

  it("retains evidence-backed possible failure without forcing manual review", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.failure_recovery = "possible_failure";
    raw.tasks[0]!.failure_evidence_timestamps_ms = [500];

    const result = normalize(raw, [0, 500, 1_000]);

    expect(result.status).toBe("candidate");
    expect(result.effective.tasks[0]).toMatchObject({
      effective_failure_recovery: "possible_failure",
    });
    expect(result.gate.eligibility).toBe("eligible");
  });

  it("rejects hallucinated evidence timestamps into human review", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.result_evidence_timestamps_ms = [750];

    const result = normalize(raw, [0, 500, 1_000]);

    expect(result.status).toBe("review_required");
    expect(result.validation.errors.join(" ")).toContain(
      "引用了未提供的证据时间点 750",
    );
  });

  it("strictly rejects unknown output fields", () => {
    expect(() =>
      parseRawVideoAnnotation({ ...rawAnnotation(), pass: true }),
    ).toThrow();
  });

  it("routes non-contiguous or reordered coverage into review", () => {
    const raw = rawAnnotation();
    raw.coverage_segments = [
      {
        start_ms: 0,
        end_ms: 1_000,
        segment_type: "task",
        linked_task_index: 0,
        visible_activity: "错误地跳过中间帧",
        evidence_timestamps_ms: [0, 1_000],
      },
      {
        start_ms: 500,
        end_ms: 500,
        segment_type: "transition",
        linked_task_index: null,
        visible_activity: "错误排序的中间帧",
        evidence_timestamps_ms: [500],
      },
    ];

    const result = normalize(raw, [0, 500, 1_000]);

    expect(result.status).toBe("review_required");
    expect(result.validation.errors.join(" ")).toContain(
      "证据帧必须按时间连续且递增",
    );
    expect(result.effective.model_assessability).toBe("needs_review");
  });

  it("requires every task evidence timestamp to be covered by that task", () => {
    const raw = rawAnnotation();
    raw.coverage_segments = [
      {
        start_ms: 0,
        end_ms: 500,
        segment_type: "task",
        linked_task_index: 0,
        visible_activity: "拿起杯子",
        evidence_timestamps_ms: [0, 500],
      },
      {
        start_ms: 1_000,
        end_ms: 1_000,
        segment_type: "transition",
        linked_task_index: null,
        visible_activity: "错误标成过渡",
        evidence_timestamps_ms: [1_000],
      },
    ];

    const result = normalize(raw, [0, 500, 1_000]);

    expect(result.validation.errors.join(" ")).toContain(
      "tasks[0] 的证据时间点 1000 未被对应 task coverage 覆盖",
    );
  });

  it("rejects specialized evidence that is absent from task evidence", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.evidence_timestamps_ms = [0, 1_000];

    const result = normalize(raw, [0, 500, 1_000]);

    expect(result.validation.errors.join(" ")).toContain(
      "result_evidence_timestamps_ms 的时间点 500 未列入任务主证据",
    );
  });

  it("maps exact controlled labels and keeps unknown values as proposals", () => {
    const result = normalizeVideoAnnotation({
      raw: rawAnnotation(),
      frames: [0, 500, 1_000].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      durationMs: 1_000,
      promptVersion: "prompt-v1",
      promptContentSha256: "a".repeat(64),
      model: "test-model",
      requestId: null,
      modelDurationMs: 12,
      enabledLabels: [
        { id: "scene-1", name: "Kitchen", type: "scene" },
        { id: "object-1", name: "杯子", type: "object" },
      ],
    });

    expect(result.labelMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "scene",
          status: "matched",
          labelId: "scene-1",
        }),
        expect.objectContaining({
          type: "object",
          status: "matched",
          labelId: "object-1",
        }),
        expect.objectContaining({
          type: "action",
          status: "proposed",
          labelId: null,
        }),
      ]),
    );
  });

  it("does not infer bimanual coordination from two visible hands alone", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.hand_mode = "both";

    const result = normalize(raw, [0, 500, 1_000]);

    expect(result.effective.tasks[0]!.effective_complexity_signals).not.toContain(
      "bimanual_coordination",
    );
  });

  it("uses only deterministic manual reason codes for core task uncertainty", () => {
    const raw = rawAnnotation();
    raw.tasks[0]!.task_verb = "uncertain";
    raw.uncertain_fields = ["tasks[0].completion", "tasks[0].task_label"];

    const result = normalize(raw, [0, 500, 1_000]);

    expect(result.gate.eligibility).toBe("manual_required");
    expect(
      result.gate.issues
        .filter((issue) => issue.level === "manual_review")
        .map((issue) => issue.code),
    ).toEqual([
      "UNRESOLVED_CORE_TASK_UNCERTAINTY",
      "UNRESOLVED_CORE_TASK_UNCERTAINTY",
    ]);
    expect(result.gate.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "OPTIONAL_FIELD_UNCERTAINTY",
          fieldPath: "tasks[0].completion",
          level: "advisory",
        }),
      ]),
    );
  });

  it("canonicalizes local arrays but does not remove a shared cross-task boundary", () => {
    const raw = rawAnnotation();
    raw.scene.evidence_timestamps_ms = [1_000, 0, 1_000];
    raw.tasks[0]!.tools = [" 刀 ", "刀"];
    raw.tasks.push({
      ...structuredClone(raw.tasks[0]!),
      start_ms: 500,
      task_label: "第二个任务",
      evidence_timestamps_ms: [500, 1_000],
    });
    raw.coverage_segments = [
      {
        start_ms: 0,
        end_ms: 500,
        segment_type: "task",
        linked_task_index: 0,
        visible_activity: "第一段",
        evidence_timestamps_ms: [0, 500],
      },
      {
        start_ms: 500,
        end_ms: 1_000,
        segment_type: "task",
        linked_task_index: 1,
        visible_activity: "第二段",
        evidence_timestamps_ms: [500, 1_000],
      },
    ];

    const canonical = canonicalizeVideoAnnotation(raw);

    expect(canonical.raw.scene.evidence_timestamps_ms).toEqual([0, 1_000]);
    expect(canonical.raw.tasks[0]!.tools).toEqual(["刀"]);
    expect(canonical.raw.coverage_segments[0]!.evidence_timestamps_ms).toEqual([0, 500]);
    expect(canonical.raw.coverage_segments[1]!.evidence_timestamps_ms).toEqual([500, 1_000]);
  });
});
