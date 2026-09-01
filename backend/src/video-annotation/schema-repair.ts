import {
  ATOMIC_ACTION_VERBS,
  COMPLEXITY_SIGNALS,
  EXECUTION_PATTERNS,
  INTERACTION_PRIMITIVES,
  TASK_VERBS,
} from "./video-annotation.js";

/**
 * 确定性结构修复器：处理模型输出与 Schema 的机械性约束冲突，不依赖模型第二次输出。
 * - 枚举字段非法值 → 映射为该字段的保守合法值（证据不足语义），记录修复；
 * - 证据时间戳数组超上限 → 均匀降采样（保留首尾，仍覆盖任务时间范围），记录修复；
 * - 只有此类确定性修复解决不了的（真 JSON 损坏）才交给模型 schema_repair。
 *
 * 不修改 Schema，不修改 Prompt；修复记录进入 Gate 审计（repairable/repaired）。
 */

export type SchemaRepairChange = {
  code: string;
  fieldPath: string;
  previousValue: unknown;
  nextValue: unknown;
  message: string;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 解包模型输出的元数据包装：部分模型会把标注对象填在 output_contract/annotation 等
 * 子字段下（顶层为 duration_ms/frame_manifest 等元数据）。
 * 规则：对象自身含 schema_version 则直接用；否则按常见键名找含 schema_version 的子对象；
 * 兜底遍历所有子对象。找不到时原样返回（交由模型 schema_repair）。
 */
export function unwrapAnnotationCandidate(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (typeof value.schema_version === "string") return value;
  for (const key of ["output_contract", "annotation", "result", "data", "output"] as const) {
    const nested = value[key];
    if (isRecord(nested) && typeof nested.schema_version === "string") return nested;
  }
  for (const nested of Object.values(value)) {
    if (isRecord(nested) && typeof nested.schema_version === "string") return nested;
  }
  return value;
}

/** 枚举字段 → 保守合法值（模型输出非法枚举时降级到“证据不足”语义） */
const ENUM_CONSERVATIVE_VALUES: Array<{ path: string; allowed: readonly string[]; fallback: string }> = [
  { path: "task_verb", allowed: TASK_VERBS, fallback: "uncertain" },
  { path: "evidence_level", allowed: ["direct_visual", "partially_inferred", "uncertain"], fallback: "uncertain" },
  { path: "execution_pattern", allowed: EXECUTION_PATTERNS, fallback: "uncertain" },
  { path: "hand_mode", allowed: ["left", "right", "both", "unclear", "no_hand_visible"], fallback: "unclear" },
  { path: "completion", allowed: ["complete", "incomplete", "partial", "uncertain"], fallback: "uncertain" },
  { path: "result_observability", allowed: ["visible", "partial", "not_visible"], fallback: "partial" },
  { path: "result_status", allowed: ["success", "failure", "partial", "not_applicable", "unknown"], fallback: "unknown" },
  { path: "result_evidence_type", allowed: ["direct_visible_postcondition", "action_completion_only", "contextual_inference", "not_observed"], fallback: "contextual_inference" },
  { path: "failure_recovery", allowed: ["none_observed", "failure_without_recovery", "failure_then_recovery", "possible_failure", "ambiguous", "not_assessable"], fallback: "not_assessable" },
  { path: "segment_type", allowed: ["task", "transition", "unclear"], fallback: "unclear" },
  { path: "temporal_structure_type", allowed: ["single_task", "multiple_tasks", "continuous_repetitive", "unclear"], fallback: "unclear" },
  { path: "model_assessability", allowed: ["assessable", "needs_review"], fallback: "needs_review" },
] as const;

/** 证据数组上限（与 Schema 一致） */
const ARRAY_LIMITS: Array<{ path: string; limit: number }> = [
  { path: "scene.evidence_timestamps_ms", limit: 20 },
  { path: "tasks[].evidence_timestamps_ms", limit: 20 },
  { path: "tasks[].result_evidence_timestamps_ms", limit: 20 },
  { path: "tasks[].failure_evidence_timestamps_ms", limit: 20 },
  { path: "tasks[].recovery_evidence_timestamps_ms", limit: 20 },
  { path: "tasks[].atomic_action_sequence[].evidence_timestamps_ms", limit: 8 },
  { path: "coverage_segments[].evidence_timestamps_ms", limit: 100 },
] as const;

function downsample(values: number[], limit: number): number[] {
  if (values.length <= limit) return values;
  if (limit <= 1) return [values[0]!];
  const step = (values.length - 1) / (limit - 1);
  const result: number[] = [];
  for (let i = 0; i < limit; i += 1) {
    result.push(values[Math.round(i * step)]!);
  }
  return result;
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function repairEnumField(
  target: JsonRecord,
  path: string,
  changes: SchemaRepairChange[],
): void {
  const config = ENUM_CONSERVATIVE_VALUES.find((item) => item.path === path);
  if (!config) return;
  const current = target[path];
  if (typeof current !== "string") return;
  if (config.allowed.includes(current as never)) return;
  target[path] = config.fallback;
  changes.push({
    code: "ENUM_VALUE_CONSERVATIVE_FIX",
    fieldPath: path,
    previousValue: current,
    nextValue: config.fallback,
    message: `枚举值 "${String(current)}" 非法，已保守映射为 "${config.fallback}"`,
  });
}

function repairArrayLimit(
  target: JsonRecord,
  path: string,
  limit: number,
  changes: SchemaRepairChange[],
  sourceTimestamps?: Set<number>,
  maxDeltaMs = 2_000,
): void {
  const current = target[path];
  if (!isNumberArray(current)) return;
  let next = current;
  let downsampled = false;
  if (current.length > limit) {
    next = downsample(current, limit);
    downsampled = true;
  }
  let aligned = false;
  if (sourceTimestamps && sourceTimestamps.size > 0) {
    const alignedNext = alignToSourceFrames(next, sourceTimestamps, maxDeltaMs);
    if (alignedNext !== next) {
      next = alignedNext;
      aligned = true;
    }
  }
  if (!downsampled && !aligned) return;
  target[path] = next;
  changes.push({
    code: downsampled ? "EVIDENCE_ARRAY_DOWNSAMPLED" : "EVIDENCE_TIMESTAMPS_ALIGNED",
    fieldPath: path,
    previousValue: current,
    nextValue: next,
    message: downsampled
      ? `证据数组 ${current.length} 项超过上限 ${limit}，已均匀降采样并对齐采样帧（保留首尾）`
      : `证据时间戳已对齐到最近采样帧（最大偏差 ${maxDeltaMs}ms）`,
  });
}

/**
 * 把证据时间戳对齐到最近的采样帧（模型常输出近似/整秒时间戳）。
 * 仅当偏差不超过 maxDeltaMs 时对齐，避免把明显编造的远点扭曲到帧上。
 */
function alignToSourceFrames(
  values: number[],
  sourceTimestamps: Set<number>,
  maxDeltaMs: number,
): number[] {
  let changed = false;
  const next = values.map((value) => {
    if (sourceTimestamps.has(value)) return value;
    let best = value;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const frame of sourceTimestamps) {
      const delta = Math.abs(frame - value);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = frame;
      }
    }
    if (bestDelta <= maxDeltaMs && best !== value) {
      changed = true;
      return best;
    }
    return value;
  });
  return changed ? next : values;
}

/** 采样帧中位间隔 ×2 作为对齐容忍度；帧太少时用固定 2000ms 兜底 */
function samplingToleranceMs(sourceTimestamps: Set<number>): number {
  const frames = [...sourceTimestamps].sort((a, b) => a - b);
  if (frames.length < 2) return 2_000;
  const gaps: number[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    gaps.push(frames[i]! - frames[i - 1]!);
  }
  gaps.sort((a, b) => a - b);
  const mid = gaps[Math.floor(gaps.length / 2)]!;
  return Math.max(2_000, mid * 2);
}


function filterEnumArray(
  target: JsonRecord,
  path: string,
  allowed: readonly string[],
  changes: SchemaRepairChange[],
): void {
  const current = target[path];
  if (!Array.isArray(current)) return;
  const next = current.filter((item) => typeof item === "string" && allowed.includes(item as never));
  if (next.length === current.length) return;
  target[path] = next;
  changes.push({
    code: "ENUM_ARRAY_INVALID_FILTERED",
    fieldPath: path,
    previousValue: current,
    nextValue: next,
    message: `数组 ${path} 中存在非法枚举值，已过滤`,
  });
}


function repairNullableStringFields(
  target: JsonRecord,
  path: string,
  changes: SchemaRepairChange[],
): void {
  // 这些字段在 Schema 中为 z.string().max(...)（允许空串），模型输出 null 时归一为空串
  for (const field of ["video_summary", "task_object", "visible_postcondition"] as const) {
    const current = target[field];
    if (current === null) {
      target[field] = "";
      changes.push({
        code: "NULL_STRING_NORMALIZED",
        fieldPath: `${path}.${field}`,
        previousValue: null,
        nextValue: "",
        message: `字段 ${field} 为 null，已归一为空字符串`,
      });
    }
  }
}


/**
 * task start_ms/end_ms 对齐到最近采样帧（容差内），消除“边界必须引用输入采样时间点”错误；
 * 对齐后保持 end > start，否则恢复原值（异常边界留给模型修复）。
 */
function repairTaskBoundaries(
  task: JsonRecord,
  changes: SchemaRepairChange[],
  sourceTimestamps?: Set<number>,
  maxDeltaMs = 2_000,
): void {
  if (!sourceTimestamps || sourceTimestamps.size === 0) return;
  const align = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return Number.NaN;
    if (sourceTimestamps!.has(value)) return value;
    let best = value;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const frame of sourceTimestamps!) {
      const delta = Math.abs(frame - value);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = frame;
      }
    }
    return bestDelta <= maxDeltaMs ? best : value;
  };
  const start = align(task.start_ms);
  const end = align(task.end_ms);
  if (Number.isNaN(start) || Number.isNaN(end)) return;
  if (start === task.start_ms && end === task.end_ms) return;
  if (end <= start) return; // 对齐后区间非法则放弃
  changes.push({
    code: "TASK_BOUNDARY_ALIGNED",
    fieldPath: "tasks[]",
    previousValue: { start_ms: task.start_ms, end_ms: task.end_ms },
    nextValue: { start_ms: start, end_ms: end },
    message: `任务边界已对齐到最近采样帧（最大偏差 ${maxDeltaMs}ms）`,
  });
  task.start_ms = start;
  task.end_ms = end;
}

function repairTask(
  task: JsonRecord,
  path: string,
  changes: SchemaRepairChange[],
  sourceTimestamps?: Set<number>,
  maxDeltaMs = 2_000,
): void {
  for (const field of ENUM_CONSERVATIVE_VALUES) {
    if (field.path === "segment_type" || field.path === "temporal_structure_type" || field.path === "model_assessability") continue;
    repairEnumField(task, field.path, changes);
  }
  repairArrayLimit(task, "evidence_timestamps_ms", 20, changes, sourceTimestamps, maxDeltaMs);
  repairArrayLimit(task, "result_evidence_timestamps_ms", 20, changes, sourceTimestamps, maxDeltaMs);
  repairArrayLimit(task, "failure_evidence_timestamps_ms", 20, changes, sourceTimestamps, maxDeltaMs);
  repairArrayLimit(task, "recovery_evidence_timestamps_ms", 20, changes, sourceTimestamps, maxDeltaMs);
  repairNullableStringFields(task, "tasks[]", changes);
  repairTaskBoundaries(task, changes, sourceTimestamps, maxDeltaMs);
  filterEnumArray(task, "interaction_primitives", INTERACTION_PRIMITIVES, changes);
  filterEnumArray(task, "complexity_signals", COMPLEXITY_SIGNALS, changes);
  const actions = task.atomic_action_sequence;
  if (Array.isArray(actions)) {
    for (const [actionIndex, value] of actions.entries()) {
      if (!isRecord(value)) continue;
      repairEnumField(value, "verb", changes);
      repairArrayLimit(value, "evidence_timestamps_ms", 8, changes, sourceTimestamps, maxDeltaMs);
      void actionIndex;
    }
  }
}

export function repairSchemaOutput(
  value: unknown,
  sourceTimestamps?: Set<number>,
  maxDeltaMs?: number,
): {
  value: unknown;
  changes: SchemaRepairChange[];
} {
  if (!isRecord(value)) return { value, changes: [] };
  const changes: SchemaRepairChange[] = [];
  const tolerance = maxDeltaMs ?? (sourceTimestamps ? samplingToleranceMs(sourceTimestamps) : 2_000);

  repairEnumField(value, "temporal_structure_type", changes);
  repairEnumField(value, "model_assessability", changes);
  if (value.video_summary === null) {
    value.video_summary = "";
    changes.push({
      code: "NULL_STRING_NORMALIZED",
      fieldPath: "video_summary",
      previousValue: null,
      nextValue: "",
      message: "字段 video_summary 为 null，已归一为空字符串",
    });
  }
  if (isRecord(value.scene)) {
    repairArrayLimit(value.scene, "evidence_timestamps_ms", 20, changes, sourceTimestamps, tolerance);
  }
  const tasks = value.tasks;
  if (Array.isArray(tasks)) {
    for (const task of tasks) {
      if (isRecord(task)) repairTask(task, "tasks[]", changes, sourceTimestamps, tolerance);
    }
  }
  const coverage = value.coverage_segments;
  if (Array.isArray(coverage)) {
    for (const segment of coverage) {
      if (!isRecord(segment)) continue;
      repairEnumField(segment, "segment_type", changes);
      repairArrayLimit(segment, "evidence_timestamps_ms", 100, changes, sourceTimestamps, tolerance);
    }
  }
  return { value, changes };
}