import { z } from "zod";

import type { TimestampedFrame } from "../video-quality/video-quality.types.js";
import {
  evaluateAnnotationAutoGate,
  type AnnotationAutoGateDecision,
  type AnnotationGateIssue,
} from "./annotation-auto-gate.js";

export const VIDEO_ANNOTATION_SCHEMA_VERSION = "ego_video_annotation_v2" as const;
export const VIDEO_ANNOTATION_POLICY_VERSION =
  "ego_annotation_evidence_policy_v3" as const;

export const LEGACY_VIDEO_ANNOTATION_SCHEMA_VERSION =
  "ego_video_annotation_v1" as const;
export const LEGACY_VIDEO_ANNOTATION_POLICY_VERSION =
  "ego_annotation_evidence_policy_v1" as const;

export const TASK_VERBS = [
  "pick_and_place",
  "move",
  "carry",
  "place",
  "open",
  "close",
  "cut",
  "pour",
  "press",
  "twist",
  "spray",
  "insert",
  "remove",
  "assemble",
  "disassemble",
  "fold",
  "unfold",
  "squeeze",
  "adjust",
  "rub_or_wipe",
  "wash_or_rinse",
  "organize",
  "other_visible_task",
  "uncertain",
] as const;

export const ATOMIC_ACTION_VERBS = [
  "grasp",
  "hold",
  "release",
  "move",
  "carry",
  "place",
  "push",
  "pull",
  "press",
  "twist",
  "insert",
  "remove",
  "open",
  "close",
  "rub_or_wipe",
  "cut",
  "pour",
  "fold",
  "unfold",
  "squeeze",
  "spray",
  "align",
  "assemble",
  "disassemble",
  "adjust",
  "other_visible_action",
  "uncertain",
] as const;

export const INTERACTION_PRIMITIVES = [
  "grasp",
  "pinch",
  "hold",
  "support",
  "release",
  "push",
  "pull",
  "press",
  "twist",
  "insert",
  "remove",
  "rub_or_wipe",
  "squeeze",
  "bimanual_fix_and_operate",
  "other_visible_contact",
] as const;

export const EXECUTION_PATTERNS = [
  "single_goal",
  "repeated_cycles",
  "continuous_operation",
  "uncertain",
] as const;

export const COMPLEXITY_SIGNALS = [
  "bimanual_coordination",
  "tool_use",
  "precision_alignment",
  "fine_finger_control",
  "deformable_object",
  "multi_step",
  "visible_state_change",
  "failure_recovery_value",
] as const;

const boundedConfidence = z.number().finite().min(0).max(1);
const nonNegativeTime = z.number().finite().nonnegative();

const rawAtomicActionSchema = z
  .object({
    order: z.number().int().min(1),
    verb: z.enum(ATOMIC_ACTION_VERBS),
    object: z.string().max(200),
    evidence_timestamps_ms: z.array(nonNegativeTime).min(1).max(8),
  })
  .strict();

const rawTaskSchema = z
  .object({
    start_ms: nonNegativeTime,
    end_ms: nonNegativeTime,
    task_label: z.string().min(1).max(200),
    task_verb: z.enum(TASK_VERBS),
    task_object: z.string().max(200),
    evidence_level: z.enum([
      "direct_visual",
      "partially_inferred",
      "uncertain",
    ]),
    execution_pattern: z.enum(EXECUTION_PATTERNS),
    evidence_timestamps_ms: z.array(nonNegativeTime).min(1).max(20),
    manipulated_objects: z.array(z.string().min(1).max(120)).max(30),
    tools: z.array(z.string().min(1).max(120)).max(20),
    hand_mode: z.enum([
      "left",
      "right",
      "both",
      "unclear",
      "no_hand_visible",
    ]),
    atomic_action_sequence: z.array(rawAtomicActionSchema).max(30),
    interaction_primitives: z.array(z.enum(INTERACTION_PRIMITIVES)).max(20),
    completion: z.enum(["complete", "incomplete", "partial", "uncertain"]),
    result_observability: z.enum(["visible", "partial", "not_visible"]),
    result_status: z.enum([
      "success",
      "failure",
      "partial",
      "not_applicable",
      "unknown",
    ]),
    result_evidence_type: z.enum([
      "direct_visible_postcondition",
      "action_completion_only",
      "contextual_inference",
      "not_observed",
    ]),
    visible_postcondition: z.string().max(500),
    result_evidence_timestamps_ms: z.array(nonNegativeTime).max(20),
    failure_recovery: z.enum([
      "none_observed",
      "failure_without_recovery",
      "failure_then_recovery",
      "possible_failure",
      "ambiguous",
      "not_assessable",
    ]),
    failure_evidence_timestamps_ms: z.array(nonNegativeTime).max(20),
    recovery_evidence_timestamps_ms: z.array(nonNegativeTime).max(20),
    complexity_signals: z.array(z.enum(COMPLEXITY_SIGNALS)).max(20),
    uncertainty_reasons: z.array(z.string().min(1).max(500)).max(20),
    confidence: boundedConfidence,
  })
  .strict();

const rawCoverageSegmentSchema = z
  .object({
    start_ms: nonNegativeTime,
    end_ms: nonNegativeTime,
    segment_type: z.enum(["task", "transition", "unclear"]),
    linked_task_index: z.number().int().min(0).nullable(),
    visible_activity: z.string().min(1).max(500),
    evidence_timestamps_ms: z.array(nonNegativeTime).min(1).max(100),
  })
  .strict();

export const rawVideoAnnotationSchema = z
  .object({
    schema_version: z.literal(VIDEO_ANNOTATION_SCHEMA_VERSION),
    video_id: z.string().min(1).max(128),
    video_summary: z.string().max(2_000),
    scene: z
      .object({
        coarse_label: z.string().max(120).nullable(),
        fine_label: z.string().max(200).nullable(),
        confidence: boundedConfidence,
        evidence_timestamps_ms: z.array(nonNegativeTime).max(20),
      })
      .strict(),
    temporal_structure_type: z.enum([
      "single_task",
      "multiple_tasks",
      "continuous_repetitive",
      "unclear",
    ]),
    model_assessability: z.enum(["assessable", "needs_review"]),
    assessability_reason: z.string().min(1).max(1_000),
    tasks: z.array(rawTaskSchema).max(100),
    coverage_segments: z.array(rawCoverageSegmentSchema).min(1).max(200),
    uncertain_fields: z.array(z.string().min(1).max(300)).max(100),
    global_limitations: z.array(z.string().min(1).max(500)).max(30),
  })
  .strict();

export type RawVideoAnnotation = z.infer<typeof rawVideoAnnotationSchema>;
export type RawVideoAnnotationTask = RawVideoAnnotation["tasks"][number];

export type EffectiveVideoAnnotationTask = RawVideoAnnotationTask & {
  effective_completion: RawVideoAnnotationTask["completion"];
  effective_result_status: RawVideoAnnotationTask["result_status"];
  effective_failure_recovery: RawVideoAnnotationTask["failure_recovery"];
  effective_complexity_signals: RawVideoAnnotationTask["complexity_signals"];
  policy_reasons: string[];
};

export type VideoAnnotationLabelMapping = {
  type: "scene" | "action" | "object";
  sourceText: string;
  status: "matched" | "proposed";
  labelId: string | null;
  labelName: string | null;
  confidence: number;
};

export type VideoAnnotationCandidateSuccess = {
  status: "candidate" | "review_required";
  schemaVersion: string;
  policyVersion: string;
  promptVersion: string;
  promptContentSha256: string;
  model: string;
  responseModel?: string | null;
  requestId: string | null;
  durationMs: number;
  frameCount: number;
  usage?: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
  sampling: {
    maxFrameGapMs: number | null;
    sourceTimestampsMs: number[];
  };
  labelMappings: VideoAnnotationLabelMapping[];
  raw: RawVideoAnnotation;
  effective: Omit<RawVideoAnnotation, "tasks"> & {
    tasks: EffectiveVideoAnnotationTask[];
  };
  validation: {
    errors: string[];
    warnings: string[];
  };
  reviewReasons: string[];
  gate: AnnotationAutoGateDecision;
};

export type VideoAnnotationCandidateFailure = {
  status: "system_failed";
  schemaVersion: string;
  policyVersion: string;
  promptVersion: string;
  promptContentSha256: string;
  model: string;
  error: string;
};

export type VideoAnnotationCandidate =
  | VideoAnnotationCandidateSuccess
  | VideoAnnotationCandidateFailure;

function sortedUniqueTimestamps(frames: TimestampedFrame[]): number[] {
  return [...new Set(frames.map((frame) => frame.timestampMs))].sort(
    (left, right) => left - right,
  );
}

function maxFrameGapMsFromTimestamps(timestamps: number[]): number | null {
  if (timestamps.length < 2) return null;
  let maximum = 0;
  for (let index = 1; index < timestamps.length; index += 1) {
    maximum = Math.max(maximum, timestamps[index]! - timestamps[index - 1]!);
  }
  return maximum;
}

function evidenceTimestampErrors(input: {
  timestamps: number[];
  sourceTimestamps: Set<number>;
  context: string;
  errors: string[];
  warnings: string[];
  startMs?: number;
  endMs?: number;
}): void {
  const seen = new Set<number>();
  for (const timestamp of input.timestamps) {
    if (seen.has(timestamp)) {
      input.errors.push(`${input.context} 重复引用证据时间点 ${timestamp}`);
    }
    seen.add(timestamp);
    if (!input.sourceTimestamps.has(timestamp)) {
      input.errors.push(`${input.context} 引用了未提供的证据时间点 ${timestamp}`);
    }
    if (
      input.startMs !== undefined &&
      input.endMs !== undefined &&
      (timestamp < input.startMs || timestamp > input.endMs)
    ) {
      // Auto Gate v2：证据点可合理落在任务区间外（如结果在任务结束后才可见），
      // 仅记录质量提示；引用必须是真实采样帧仍由上方 error 兜底。
      input.warnings.push(`${input.context} 的证据时间点 ${timestamp} 不在区间内`);
    }
  }
}

function effectiveComplexitySignals(
  task: RawVideoAnnotationTask,
  effectiveRecovery: RawVideoAnnotationTask["failure_recovery"],
  warnings: string[],
  context: string,
): RawVideoAnnotationTask["complexity_signals"] {
  const signals = new Set(task.complexity_signals);
  const synchronize = (
    signal: RawVideoAnnotationTask["complexity_signals"][number],
    expected: boolean,
  ) => {
    if (expected && !signals.has(signal)) {
      signals.add(signal);
      warnings.push(`${context} 已按结构化事实补充复杂度信号 ${signal}`);
    }
    if (!expected && signals.delete(signal)) {
      warnings.push(`${context} 已移除缺少结构化依据的复杂度信号 ${signal}`);
    }
  };
  synchronize("tool_use", task.tools.length > 0);
  synchronize("multi_step", task.atomic_action_sequence.length >= 3);
  synchronize("failure_recovery_value", effectiveRecovery === "failure_then_recovery");
  if (
    signals.has("bimanual_coordination") &&
    task.hand_mode !== "both"
  ) {
    signals.delete("bimanual_coordination");
    warnings.push(
      `${context} 已移除与 hand_mode 冲突的复杂度信号 bimanual_coordination`,
    );
  }
  return [...signals];
}

function validateCoverage(input: {
  raw: RawVideoAnnotation;
  sourceTimestamps: number[];
  sourceTimestampSet: Set<number>;
  durationMs: number;
  errors: string[];
  warnings: string[];
}): void {
  const coverageCounts = new Map(
    input.sourceTimestamps.map((timestamp) => [timestamp, 0]),
  );
  const sourcePositions = new Map(
    input.sourceTimestamps.map((timestamp, index) => [timestamp, index]),
  );
  const linkedTasksByTimestamp = new Map<number, Set<number>>();
  let previousEndPosition = -1;
  for (const [index, segment] of input.raw.coverage_segments.entries()) {
    const context = `coverage_segments[${index}]`;
    if (!segment.visible_activity.trim()) {
      input.errors.push(`${context}.visible_activity 不能为空白`);
    }
    if (segment.end_ms < segment.start_ms) {
      input.errors.push(`${context} 时间区间无效`);
    }
    if (segment.end_ms > input.durationMs) {
      input.errors.push(`${context} 结束时间超出视频时长`);
    }
    if (segment.segment_type === "task") {
      if (
        segment.linked_task_index === null ||
        segment.linked_task_index >= input.raw.tasks.length
      ) {
        input.errors.push(`${context} 未绑定有效任务索引`);
      } else {
        const linkedTask = input.raw.tasks[segment.linked_task_index];
        if (
          linkedTask &&
          (segment.start_ms < linkedTask.start_ms ||
            segment.end_ms > linkedTask.end_ms)
        ) {
          // Auto Gate v2：coverage 是“可见活动”分段，可合理包含任务前后过渡；
          // 超出 task 区间不再阻断，仅记录为质量提示。
          input.warnings.push(`${context} 超出所绑定任务的时间区间`);
        }
      }
    } else if (segment.linked_task_index !== null) {
      input.errors.push(`${context} 非任务区间不得绑定任务索引`);
    }
    evidenceTimestampErrors({
      timestamps: segment.evidence_timestamps_ms,
      sourceTimestamps: input.sourceTimestampSet,
      context,
      errors: input.errors,
      warnings: input.warnings,
      startMs: segment.start_ms,
      endMs: segment.end_ms,
    });
    const positions = segment.evidence_timestamps_ms.flatMap((timestamp) => {
      const position = sourcePositions.get(timestamp);
      return position === undefined ? [] : [position];
    });
    if (
      positions.some(
        (position, positionIndex) =>
          positionIndex > 0 && position !== positions[positionIndex - 1]! + 1,
      )
    ) {
      // Auto Gate v2：证据帧连续性为质量提示，不阻断准入。
      input.warnings.push(`${context} 的证据帧必须按时间连续且递增`);
    }
    if (positions.length > 0) {
      const firstPosition = positions[0]!;
      const lastPosition = positions.at(-1)!;
      if (firstPosition !== previousEndPosition + 1) {
        input.warnings.push(`${context} 与前一 coverage 区间不连续或顺序错误`);
      }
      previousEndPosition = lastPosition;
      if (
        segment.start_ms !== input.sourceTimestamps[firstPosition] ||
        segment.end_ms !== input.sourceTimestamps[lastPosition]
      ) {
        input.warnings.push(`${context} 的边界必须等于首尾证据时间点`);
      }
    }
    for (const timestamp of new Set(segment.evidence_timestamps_ms)) {
      if (coverageCounts.has(timestamp)) {
        coverageCounts.set(timestamp, (coverageCounts.get(timestamp) ?? 0) + 1);
      }
      if (
        segment.segment_type === "task" &&
        segment.linked_task_index !== null &&
        segment.linked_task_index < input.raw.tasks.length
      ) {
        const linked = linkedTasksByTimestamp.get(timestamp) ?? new Set<number>();
        linked.add(segment.linked_task_index);
        linkedTasksByTimestamp.set(timestamp, linked);
      }
    }
  }
  for (const [timestamp, count] of coverageCounts) {
    // Auto Gate v2：coverage 未全覆盖/重复覆盖是质量提示，不阻断准入。
    if (count === 0) input.warnings.push(`采样证据时间点 ${timestamp} 未被 coverage 覆盖`);
    if (count > 1) input.warnings.push(`采样证据时间点 ${timestamp} 被 coverage 重复覆盖`);
  }
  for (const [taskIndex, task] of input.raw.tasks.entries()) {
    for (const timestamp of task.evidence_timestamps_ms) {
      if (!linkedTasksByTimestamp.get(timestamp)?.has(taskIndex)) {
        // Auto Gate v2：task 证据是稀疏支持点，与 coverage 证据集合不必严格对齐；
        // 改为质量提示，任务区间合法性仍由 tasks 校验兜底。
        input.warnings.push(
          `tasks[${taskIndex}] 的证据时间点 ${timestamp} 未被对应 task coverage 覆盖`,
        );
      }
    }
  }
}

function taskEvidenceSubsetErrors(input: {
  taskEvidence: Set<number>;
  timestamps: number[];
  context: string;
  errors: string[];
  warnings: string[];
}): void {
  for (const timestamp of input.timestamps) {
    if (!input.taskEvidence.has(timestamp)) {
      // Auto Gate v2：专项证据（结果/失败/恢复/原子动作）是独立支持点，
      // 与稀疏的任务主证据不必严格对齐；不在主证据内仅记录质量提示。
      input.warnings.push(`${input.context} 的时间点 ${timestamp} 未列入任务主证据`);
    }
  }
}

export function normalizeVideoAnnotation(input: {
  raw: RawVideoAnnotation;
  frames: TimestampedFrame[];
  durationMs: number;
  promptVersion: string;
  promptContentSha256: string;
  model: string;
  responseModel?: string | null;
  requestId: string | null;
  modelDurationMs: number;
  usage?: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  };
  repairs?: AnnotationGateIssue[];
  /** 重跑旧 Run 时按 Run 快照版本生成，保持与快照一致（默认当前常量）。 */
  schemaVersionOverride?: string;
  policyVersionOverride?: string;
  /** Kept for older callers; evidence gap no longer changes gate eligibility. */
  applySparseEvidencePolicy?: boolean;
  enabledLabels?: Array<{
    id: string;
    name: string;
    type: "scene" | "action" | "object";
  }>;
}): VideoAnnotationCandidateSuccess {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourceTimestamps = sortedUniqueTimestamps(input.frames);
  const sourceTimestampSet = new Set(sourceTimestamps);
  const gapMs = maxFrameGapMsFromTimestamps(sourceTimestamps);

  if (sourceTimestamps.some((timestamp) => timestamp > input.durationMs)) {
    errors.push("输入采样时间点超出视频时长");
  }

  if (input.raw.video_id !== input.raw.video_id.trim()) {
    errors.push("video_id 包含首尾空白");
  }
  if (!input.raw.assessability_reason.trim()) {
    errors.push("assessability_reason 不能为空白");
  }

  validateCoverage({
    raw: input.raw,
    sourceTimestamps,
    sourceTimestampSet,
    durationMs: input.durationMs,
    errors,
    warnings,
  });

  const effectiveTasks = input.raw.tasks.map((task, taskIndex) => {
    const reasons: string[] = [];
    const context = `tasks[${taskIndex}]`;
    if (!task.task_label.trim()) errors.push(`${context}.task_label 不能为空白`);
    if (task.end_ms <= task.start_ms) errors.push(`${context} 时间区间无效`);
    if (
      !sourceTimestampSet.has(task.start_ms) ||
      !sourceTimestampSet.has(task.end_ms)
    ) {
      errors.push(`${context} 的边界必须引用输入采样时间点`);
    }
    if (task.end_ms > input.durationMs) {
      errors.push(`${context} 结束时间超出视频时长`);
    }
    evidenceTimestampErrors({
      timestamps: task.evidence_timestamps_ms,
      sourceTimestamps: sourceTimestampSet,
      context: `${context}.evidence_timestamps_ms`,
      errors,
      warnings,
      startMs: task.start_ms,
      endMs: task.end_ms,
    });
    const taskEvidence = new Set(task.evidence_timestamps_ms);
    taskEvidenceSubsetErrors({
      taskEvidence,
      timestamps: task.result_evidence_timestamps_ms,
      context: `${context}.result_evidence_timestamps_ms`,
      errors,
      warnings,
    });
    taskEvidenceSubsetErrors({
      taskEvidence,
      timestamps: task.failure_evidence_timestamps_ms,
      context: `${context}.failure_evidence_timestamps_ms`,
      errors,
      warnings,
    });
    taskEvidenceSubsetErrors({
      taskEvidence,
      timestamps: task.recovery_evidence_timestamps_ms,
      context: `${context}.recovery_evidence_timestamps_ms`,
      errors,
      warnings,
    });
    evidenceTimestampErrors({
      timestamps: task.result_evidence_timestamps_ms,
      sourceTimestamps: sourceTimestampSet,
      context: `${context}.result_evidence_timestamps_ms`,
      errors,
      warnings,
      startMs: task.start_ms,
      endMs: task.end_ms,
    });
    evidenceTimestampErrors({
      timestamps: task.failure_evidence_timestamps_ms,
      sourceTimestamps: sourceTimestampSet,
      context: `${context}.failure_evidence_timestamps_ms`,
      errors,
      warnings,
      startMs: task.start_ms,
      endMs: task.end_ms,
    });
    evidenceTimestampErrors({
      timestamps: task.recovery_evidence_timestamps_ms,
      sourceTimestamps: sourceTimestampSet,
      context: `${context}.recovery_evidence_timestamps_ms`,
      errors,
      warnings,
      startMs: task.start_ms,
      endMs: task.end_ms,
    });

    const actualOrders = task.atomic_action_sequence.map((action) => action.order);
    if (actualOrders.some((order, index) => order !== index + 1)) {
      errors.push(`${context}.atomic_action_sequence 的 order 必须从 1 连续递增`);
    }
    let previousActionStartMs = -1;
    for (const [actionIndex, action] of task.atomic_action_sequence.entries()) {
      evidenceTimestampErrors({
        timestamps: action.evidence_timestamps_ms,
        sourceTimestamps: sourceTimestampSet,
        context: `${context}.atomic_action_sequence[${actionIndex}]`,
        errors,
        warnings,
        startMs: task.start_ms,
        endMs: task.end_ms,
      });
      taskEvidenceSubsetErrors({
        taskEvidence,
        timestamps: action.evidence_timestamps_ms,
        context: `${context}.atomic_action_sequence[${actionIndex}]`,
        errors,
        warnings,
      });
      const actionStartMs = Math.min(...action.evidence_timestamps_ms);
      if (actionStartMs < previousActionStartMs) {
        errors.push(
          `${context}.atomic_action_sequence[${actionIndex}] 的证据时间早于前一步`,
        );
      }
      previousActionStartMs = actionStartMs;
      if (
        action.evidence_timestamps_ms.length < 2 &&
        !["hold", "grasp", "release"].includes(action.verb)
      ) {
        reasons.push(`atomic_action_${actionIndex}_needs_multiple_frames`);
      }
    }

    if (
      task.evidence_level === "direct_visual" &&
      task.evidence_timestamps_ms.length < 2
    ) {
      reasons.push("direct_visual_requires_multiple_frames");
    }

    let effectiveCompletion = task.completion;
    let effectiveResult = task.result_status;
    let effectiveRecovery = task.failure_recovery;
    if (
      task.completion === "complete" &&
      task.evidence_timestamps_ms.length < 3
    ) {
      effectiveCompletion = "uncertain";
      reasons.push("complete_task_requires_start_core_end_evidence");
    }
    if (
      task.result_status === "success" ||
      task.result_status === "failure"
    ) {
      if (
        task.result_evidence_type !== "direct_visible_postcondition" ||
        task.result_observability !== "visible" ||
        task.result_evidence_timestamps_ms.length < 2
      ) {
        effectiveResult = "unknown";
        reasons.push("result_lacks_stable_direct_postcondition_evidence");
      }
      const firstResultEvidence = Math.min(
        ...task.result_evidence_timestamps_ms,
      );
      if (
        task.result_evidence_timestamps_ms.length > 0 &&
        !task.evidence_timestamps_ms.some(
          (timestamp) => timestamp < firstResultEvidence,
        )
      ) {
        effectiveResult = "unknown";
        reasons.push("result_lacks_before_state_evidence");
      }
      if (!task.visible_postcondition.trim()) {
        effectiveResult = "unknown";
        reasons.push("result_missing_visible_postcondition");
      }
    }
    if (
      task.result_status === "partial" &&
      (task.result_evidence_type !== "direct_visible_postcondition" ||
        task.result_observability === "not_visible" ||
        task.result_evidence_timestamps_ms.length === 0 ||
        !task.visible_postcondition.trim())
    ) {
      effectiveResult = "unknown";
      reasons.push("partial_result_lacks_direct_postcondition_evidence");
    }
    if (
      task.failure_recovery === "failure_without_recovery" &&
      task.failure_evidence_timestamps_ms.length === 0
    ) {
      effectiveRecovery = "not_assessable";
      reasons.push("failure_claim_missing_evidence");
    }
    if (
      (task.failure_recovery === "possible_failure" ||
        task.failure_recovery === "ambiguous") &&
      task.failure_evidence_timestamps_ms.length === 0
    ) {
      effectiveRecovery = "not_assessable";
      reasons.push("uncertain_failure_claim_missing_evidence");
    }
    if (
      task.failure_recovery === "failure_then_recovery" &&
      (task.failure_evidence_timestamps_ms.length === 0 ||
        task.recovery_evidence_timestamps_ms.length === 0)
    ) {
      effectiveRecovery = "not_assessable";
      reasons.push("recovery_claim_missing_before_after_evidence");
    }
    if (
      task.failure_recovery === "failure_then_recovery" &&
      task.failure_evidence_timestamps_ms.length > 0 &&
      task.recovery_evidence_timestamps_ms.length > 0 &&
      Math.max(...task.failure_evidence_timestamps_ms) >=
        Math.min(...task.recovery_evidence_timestamps_ms)
    ) {
      effectiveRecovery = "not_assessable";
      reasons.push("failure_recovery_evidence_order_invalid");
    }
    if (
      task.failure_recovery === "failure_without_recovery" &&
      task.recovery_evidence_timestamps_ms.length > 0
    ) {
      effectiveRecovery = "not_assessable";
      reasons.push("failure_without_recovery_contains_recovery_evidence");
    }
    if (
      task.failure_recovery === "none_observed" &&
      (task.failure_evidence_timestamps_ms.length > 0 ||
        task.recovery_evidence_timestamps_ms.length > 0)
    ) {
      effectiveRecovery = "not_assessable";
      reasons.push("none_observed_contains_failure_recovery_evidence");
    }
    const effectiveSignals = effectiveComplexitySignals(
      task,
      effectiveRecovery,
      warnings,
      context,
    );
    return {
      ...task,
      effective_completion: effectiveCompletion,
      effective_result_status: effectiveResult,
      effective_failure_recovery: effectiveRecovery,
      effective_complexity_signals: effectiveSignals,
      policy_reasons: [...new Set(reasons)],
    };
  });

  evidenceTimestampErrors({
    timestamps: input.raw.scene.evidence_timestamps_ms,
    sourceTimestamps: sourceTimestampSet,
    context: "scene.evidence_timestamps_ms",
    errors,
    warnings,
  });

  let effectiveAssessability = input.raw.model_assessability;
  let effectiveAssessabilityReason = input.raw.assessability_reason;
  if (errors.length > 0) {
    effectiveAssessability = "needs_review";
    effectiveAssessabilityReason = "候选标注存在结构或证据一致性错误，需要模型重试。";
  }

  const labelMappings = mapControlledLabels(
    input.raw,
    input.enabledLabels ?? [],
  );

  const candidate: Omit<VideoAnnotationCandidateSuccess, "gate"> = {
    status: "candidate",
    schemaVersion: input.schemaVersionOverride ?? VIDEO_ANNOTATION_SCHEMA_VERSION,
    policyVersion: input.policyVersionOverride ?? VIDEO_ANNOTATION_POLICY_VERSION,
    promptVersion: input.promptVersion,
    promptContentSha256: input.promptContentSha256,
    model: input.model,
    ...(input.responseModel !== undefined
      ? { responseModel: input.responseModel }
      : {}),
    requestId: input.requestId,
    durationMs: input.modelDurationMs,
    frameCount: input.frames.length,
    ...(input.usage ? { usage: input.usage } : {}),
    sampling: {
      maxFrameGapMs: gapMs,
      sourceTimestampsMs: sourceTimestamps,
    },
    labelMappings,
    raw: input.raw,
    effective: {
      ...input.raw,
      model_assessability: effectiveAssessability,
      assessability_reason: effectiveAssessabilityReason,
      tasks: effectiveTasks,
    },
    validation: { errors: [...new Set(errors)], warnings: [...new Set(warnings)] },
    reviewReasons: [],
  };
  const gate = evaluateAnnotationAutoGate({
    candidate,
    repairs: input.repairs,
  });
  const blockingReasons = gate.issues
    .filter(
      (issue) =>
        issue.level === "manual_review" ||
        (issue.level === "retryable" && issue.resolution === "unresolved"),
    )
    .map((issue) => `${issue.code}: ${issue.message}`);
  return {
    ...candidate,
    status: gate.eligibility === "eligible" ? "candidate" : "review_required",
    reviewReasons: [...new Set(blockingReasons)],
    gate,
  };
}

function normalizedLabelName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/gu, " ");
}

function mapControlledLabels(
  raw: RawVideoAnnotation,
  enabledLabels: Array<{
    id: string;
    name: string;
    type: "scene" | "action" | "object";
  }>,
): VideoAnnotationLabelMapping[] {
  const indexes = new Map<
    string,
    { id: string; name: string; type: "scene" | "action" | "object" }
  >();
  for (const label of enabledLabels) {
    indexes.set(`${label.type}:${normalizedLabelName(label.name)}`, label);
  }
  const sources: Array<{
    type: "scene" | "action" | "object";
    text: string;
    confidence: number;
  }> = [];
  const sceneText = raw.scene.fine_label ?? raw.scene.coarse_label;
  if (sceneText) {
    sources.push({
      type: "scene",
      text: sceneText,
      confidence: raw.scene.confidence,
    });
  }
  for (const task of raw.tasks) {
    sources.push({
      type: "action",
      text: task.task_label,
      confidence: task.confidence,
    });
    for (const object of [task.task_object, ...task.manipulated_objects]) {
      if (object.trim()) {
        sources.push({ type: "object", text: object, confidence: task.confidence });
      }
    }
  }

  const seen = new Set<string>();
  return sources.flatMap((source) => {
    const sourceText = source.text.trim();
    const sourceKey = `${source.type}:${normalizedLabelName(sourceText)}`;
    if (seen.has(sourceKey)) return [];
    seen.add(sourceKey);
    const matched = indexes.get(sourceKey);
    return [
      {
        type: source.type,
        sourceText,
        status: matched ? ("matched" as const) : ("proposed" as const),
        labelId: matched?.id ?? null,
        labelName: matched?.name ?? null,
        confidence: source.confidence,
      },
    ];
  });
}

export function parseRawVideoAnnotation(value: unknown): RawVideoAnnotation {
  return rawVideoAnnotationSchema.parse(value);
}
