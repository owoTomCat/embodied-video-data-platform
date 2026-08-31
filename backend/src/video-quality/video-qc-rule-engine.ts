import type {
  DimensionKey,
  ModelRunMetadata,
  NormalizedVideoQcResultV1,
  PreparedVideoEvidence,
  QualityDimension,
  QualityIssue,
  RawDimensionKey,
  RawQualityIssue,
  RawVideoQcResultV1,
  TaskComplianceItem,
  TaskComplianceResult,
  VideoQcInputV1,
} from "./video-quality.types.js";
import {
  VIDEO_QC_PROMPT_VERSION,
  VIDEO_QC_RESULT_SCHEMA,
  VIDEO_QC_RULE_VERSION,
} from "./video-quality.types.js";
import { coefficientForScore } from "../rules/rule-calculator.js";

export type NormalizeVideoQcInput = {
  raw: RawVideoQcResultV1;
  sourceInput: VideoQcInputV1;
  evidence: PreparedVideoEvidence;
  modelRuns: ModelRunMetadata[];
};

const RAW_DIMENSION_KEYS: RawDimensionKey[] = ["D1", "D2", "D3", "D4", "D5"];

const DIMENSION_BY_RAW: Record<RawDimensionKey, DimensionKey> = {
  D1: "first_person_and_composition",
  D2: "hand_forearm_object_integrity",
  D3: "frame_and_video_quality",
  D4: "task_authenticity_completeness",
  D5: "task_value_uniqueness",
};

const dimensionKeys: DimensionKey[] = [
  "first_person_and_composition",
  "hand_forearm_object_integrity",
  "frame_and_video_quality",
  "task_authenticity_completeness",
  "task_value_uniqueness",
];

const DIMENSION_SPECIAL_METRICS: Record<
  DimensionKey,
  Array<{ field: keyof Pick<QualityDimension, "hand_active_duration_ms" | "c_spec" | "c_visual" | "completion_coefficient" | "inventory_coefficient" | "unique_coefficient" | "similarity_total">; metricKey: string }>
> = {
  first_person_and_composition: [],
  hand_forearm_object_integrity: [
    { field: "hand_active_duration_ms", metricKey: "hand_active_duration_ms" },
  ],
  frame_and_video_quality: [
    { field: "c_spec", metricKey: "C_spec" },
    { field: "c_visual", metricKey: "C_visual" },
  ],
  task_authenticity_completeness: [
    { field: "completion_coefficient", metricKey: "C_completion" },
  ],
  task_value_uniqueness: [
    { field: "inventory_coefficient", metricKey: "C_inventory" },
    { field: "unique_coefficient", metricKey: "C_unique" },
    { field: "similarity_total", metricKey: "S_total" },
  ],
};

function roundOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function nearlyEqual(left: number | null, right: number | null, tolerance = 0.05): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= tolerance;
}

type Interval = { startMs: number; endMs: number };

function unionDuration(intervals: Interval[]): number {
  const sorted = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((left, right) => left.startMs - right.startMs);
  let total = 0;
  let current: Interval | null = null;
  for (const interval of sorted) {
    if (!current) {
      current = { ...interval };
    } else if (interval.startMs <= current.endMs) {
      current.endMs = Math.max(current.endMs, interval.endMs);
    } else {
      total += current.endMs - current.startMs;
      current = { ...interval };
    }
  }
  if (current) total += current.endMs - current.startMs;
  return total;
}

function clippedInterval(
  startMs: number | null,
  endMs: number | null,
  durationMs: number | null,
): Interval | null {
  if (startMs === null || endMs === null || durationMs === null) return null;
  const start = Math.max(0, Math.min(durationMs, startMs));
  const end = Math.max(0, Math.min(durationMs, endMs));
  return end > start ? { startMs: start, endMs: end } : null;
}

function rawIssueToQualityIssue(
  issue: RawQualityIssue,
  durationMs: number | null,
  errors: string[],
  context: string,
): QualityIssue | null {
  if (issue.start_ms !== null && issue.end_ms !== null) {
    if (issue.start_ms >= issue.end_ms) {
      errors.push(`${context}/${issue.reason_code} 的时间区间无效`);
      return null;
    }
    if (durationMs !== null && issue.end_ms > durationMs) {
      errors.push(`${context}/${issue.reason_code} 的证据超出视频时间轴`);
      return null;
    }
    if (
      issue.evidence_timestamps_ms.some(
        (timestamp) => timestamp < issue.start_ms! || timestamp > issue.end_ms!,
      )
    ) {
      errors.push(`${context}/${issue.reason_code} 的证据时间未位于问题区间内`);
    }
  } else if (issue.evidence_timestamps_ms.length > 0) {
    errors.push(`${context}/${issue.reason_code} 非时序问题不应带证据时间点`);
  }
  if (issue.evidence_timestamps_ms.length === 0 && issue.start_ms !== null) {
    errors.push(`${context}/${issue.reason_code} 扣分缺少证据时间点`);
  }
  return {
    reason_code: issue.reason_code,
    description: issue.description,
    start_ms: issue.start_ms,
    end_ms: issue.end_ms,
    severity: issue.severity,
    confidence: issue.confidence,
    evidence_timestamps_ms: issue.evidence_timestamps_ms,
  };
}

export function normalizeVideoQcResult(
  input: NormalizeVideoQcInput,
): NormalizedVideoQcResultV1 {
  const errors: string[] = [];
  const warnings: string[] = [];
  const durationMs = input.sourceInput.analysis_duration_ms;
  const normalizedDimensions = {} as Record<DimensionKey, QualityDimension>;
  const deductions: Array<QualityIssue & { dimension?: string }> = [];
  const unroundedScores = new Map<RawDimensionKey, number | null>();

  for (const rawKey of RAW_DIMENSION_KEYS) {
    const key = DIMENSION_BY_RAW[rawKey];
    const dimension = input.raw.dimensions[rawKey];
    const context = `${rawKey}（${key}）`;
    const unroundedScore =
      dimension.coefficient === null
        ? null
        : 20 * dimension.coefficient;
    unroundedScores.set(rawKey, unroundedScore);

    if (dimension.coefficient !== null && dimension.score !== null) {
      if (!nearlyEqual(dimension.score, roundOne(unroundedScore!))) {
        errors.push(`${context} 的模型分数与 20 × 系数不一致`);
      }
    } else if (dimension.coefficient === null && dimension.score === null) {
      errors.push(`${context} 缺少必需评分数据（coefficient 与 score 均为空）`);
    }

    const issues: QualityIssue[] = [];
    for (const issue of dimension.issues) {
      const normalized = rawIssueToQualityIssue(
        issue,
        durationMs,
        errors,
        context,
      );
      if (normalized) issues.push(normalized);
    }
    deductions.push(
      ...issues.map((issue) => ({ ...issue, dimension: key })),
    );

    const special: Partial<QualityDimension> = {};
    for (const { field, metricKey } of DIMENSION_SPECIAL_METRICS[key]) {
      const value = dimension.metrics[metricKey] ?? null;
      if (value !== null && Number.isFinite(value)) {
        (special as Record<string, unknown>)[field] = value;
      }
    }

    normalizedDimensions[key] = {
      coefficient: dimension.coefficient,
      score:
        unroundedScore === null ? null : roundOne(unroundedScore),
      confidence: dimension.confidence,
      calculation_trace:
        dimension.metrics && Object.keys(dimension.metrics).length > 0
          ? JSON.stringify(dimension.metrics)
          : "",
      segments: [],
      issues,
      metrics: dimension.metrics,
      ...special,
    };
  }

  const rawTotal =
    input.raw.overall_result.raw_total_score === null
      ? null
      : Number(input.raw.overall_result.raw_total_score);
  const reportedFinal = input.raw.overall_result.final_score;
  const unroundedTotal = [...unroundedScores.values()].reduce<number | null>(
    (total, score) => {
      if (score === null) return null;
      return total === null ? score : total + score;
    },
    0,
  );
  const finalScore =
    unroundedTotal === null
      ? null
      : roundOne(Math.max(0, Math.min(100, unroundedTotal)));

  if (unroundedTotal === null) {
    errors.push("任一必需维度无法计算，总分应为空");
  } else if (
    rawTotal !== null &&
    !nearlyEqual(rawTotal, roundOne(unroundedTotal))
  ) {
    errors.push("模型 raw_total_score 与五个未舍入分项之和不一致");
  }
  if (finalScore !== null && reportedFinal !== null && !nearlyEqual(reportedFinal, finalScore)) {
    errors.push("模型 final_score 与服务端复算结果不一致");
  }

  const reasonDimensions = new Map<string, string>();
  for (const deduction of deductions) {
    const previous = reasonDimensions.get(deduction.reason_code);
    if (previous && previous !== deduction.dimension) {
      errors.push(`${deduction.reason_code} 在多个维度重复扣分`);
    }
    reasonDimensions.set(deduction.reason_code, deduction.dimension ?? "unknown");
  }

  if (input.raw.hard_reject.triggered !== (input.raw.evaluation_status === "hard_reject")) {
    errors.push("hard_reject 与 evaluation_status 不一致");
  }
  if (
    input.raw.hard_reject.reasons.some((reason) => reason === "EXACT_DUPLICATE") &&
    !input.sourceInput.similarity_context.file_hash_exact
  ) {
    errors.push("EXACT_DUPLICATE 缺少权威文件哈希依据");
  }

  const taskCompliance = normalizeTaskCompliance(
    input.raw.task_compliance,
    warnings,
  );

  const invalidSegments: NormalizedVideoQcResultV1["invalidSegments"] = [];
  for (const window of input.evidence.technicalMetrics.detector_windows) {
    if (window.type !== "black" && window.type !== "freeze") continue;
    const clipped = clippedInterval(window.start_ms, window.end_ms, durationMs);
    if (clipped) {
      invalidSegments.push({
        reasonCode: window.type === "black" ? "BLACK_SCREEN" : "FREEZE",
        ...clipped,
        source: "detector",
      });
    }
  }
  for (const segment of input.raw.duration_result.invalid_segments) {
    if (segment.evidence_timestamps_ms.length === 0) {
      errors.push(`${segment.reason_code} 无效片段缺少证据时间点`);
    }
    const clipped = clippedInterval(segment.start_ms, segment.end_ms, durationMs);
    if (!clipped) {
      if (segment.start_ms !== null || segment.end_ms !== null) {
        errors.push(`${segment.reason_code} 无效片段时间范围无效`);
      }
      continue;
    }
    invalidSegments.push({
      reasonCode: segment.reason_code,
      ...clipped,
      source: "model",
    });
  }

  const invalidDurationMs =
    durationMs === null ? null : unionDuration(invalidSegments);
  const billableDurationMs =
    durationMs === null || invalidDurationMs === null
      ? null
      : Math.max(0, durationMs - invalidDurationMs);
  if (
    input.raw.duration_result.effective_duration_ms !== null &&
    billableDurationMs !== null &&
    Math.abs(input.raw.duration_result.effective_duration_ms - billableDurationMs) > 1_000
  ) {
    errors.push("模型 effective_duration_ms 与服务端复算结果不一致");
  }

  let evaluationStatus: NormalizedVideoQcResultV1["evaluationStatus"] =
    input.raw.evaluation_status === "completed"
      ? "scored"
      : input.raw.evaluation_status;
  if (errors.length > 0) {
    evaluationStatus = "review_pending";
  }
  const settlementRatio =
    evaluationStatus === "hard_reject"
      ? 0
      : evaluationStatus === "scored"
        ? coefficientForScore(finalScore ?? 0)
        : null;

  if (input.raw.review.review_required && input.raw.review.review_reasons.length === 0) {
    warnings.push("模型要求复核但没有给出复核原因");
  }

  const reviewReasons = [...input.raw.review.review_reasons];
  if (
    input.raw.hard_reject.candidates.length > 0 &&
    input.raw.evaluation_status !== "hard_reject"
  ) {
    reviewReasons.push(
      `疑似硬性否决候选：${input.raw.hard_reject.candidates.join("、")}`,
    );
  }
  if (errors.length > 0) reviewReasons.push("服务端规则校验未通过");

  return {
    schemaVersion: VIDEO_QC_RESULT_SCHEMA,
    ruleVersion: VIDEO_QC_RULE_VERSION,
    promptVersion: VIDEO_QC_PROMPT_VERSION,
    videoId: input.raw.task_id,
    evaluationStatus,
    dimensions: normalizedDimensions,
    rawTotalScore: unroundedTotal === null ? null : roundOne(unroundedTotal),
    finalScore,
    settlementRatio,
    analysisDurationMs: durationMs,
    invalidDurationMs,
    billableDurationMs,
    invalidSegments,
    hardVeto: input.raw.hard_reject,
    detectedTask: {
      task_id: input.raw.task_id,
      task_summary: input.raw.task_summary,
      confidence: null,
      scene_id:
        typeof input.raw.detectedTask?.scene_id === "string"
          ? input.raw.detectedTask.scene_id
          : null,
      standard_task_id:
        typeof input.raw.detectedTask?.standard_task_id === "string"
          ? input.raw.detectedTask.standard_task_id
          : null,
      variant_id:
        typeof input.raw.detectedTask?.variant_id === "string"
          ? input.raw.detectedTask.variant_id
          : null,
    },
    taskCompliance,
    deductions,
    recommendations: input.raw.recommendations,
    summary: input.raw.overall_result.summary,
    reviewRequired: input.raw.review.review_required || errors.length > 0,
    reviewReasons: [...new Set(reviewReasons)],
    missingInputs: [
      ...new Set([
        ...input.sourceInput.missing_inputs,
        ...input.raw.input_status.missing_required_inputs,
      ]),
    ],
    validation: { warnings, errors },
    rawModelResult: input.raw,
    modelRuns: input.modelRuns,
    media: {
      metadata: input.evidence.metadata,
      technicalMetrics: input.evidence.technicalMetrics,
      fullVideoSamplingFps: input.evidence.fullVideoSamplingFps,
      fullVideoFrameCount: input.evidence.fullVideoFrames.length,
    },
  };
}

function clampRatio(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * 把模型输出的任务符合度规整为受控结构（缺失/非法字段容错）。
 */
export function normalizeTaskCompliance(
  raw: RawVideoQcResultV1["task_compliance"],
  warnings: string[],
): TaskComplianceResult | null {
  if (!raw || typeof raw !== "object") return null;
  const items = Array.isArray(raw.items)
    ? raw.items
        .filter(
          (item): item is TaskComplianceResult["items"][number] =>
            item !== null &&
            typeof item === "object" &&
            typeof (item as { requirement?: unknown }).requirement === "string" &&
            (item as { requirement: string }).requirement.trim() !== "",
        )
        .map((item): TaskComplianceItem => {
          const record = item as Record<string, unknown>;
          const type: TaskComplianceItem["type"] =
            record.type === "hard" ? "hard" : "soft";
          const result: TaskComplianceItem["result"] =
            record.result === "met" || record.result === "partial"
              ? record.result
              : "unmet";
          return {
            requirement: String(record.requirement).slice(0, 2_000),
            type,
            result,
            confidence: Number.isFinite(Number(record.confidence))
              ? clampRatio(Number(record.confidence))
              : 0.5,
            evidence_timestamps_ms: Array.isArray(record.evidence_timestamps_ms)
              ? record.evidence_timestamps_ms
                  .filter((timestamp) => Number.isFinite(Number(timestamp)))
                  .map((timestamp) => Math.max(0, Number(timestamp)))
                  .slice(0, 200)
              : [],
          };
        })
        .slice(0, 100)
    : [];
  const sceneMatch =
    raw.scene_match && typeof raw.scene_match === "object"
      ? {
          matched: raw.scene_match.matched === true,
          confidence: Number.isFinite(Number(raw.scene_match.confidence))
            ? clampRatio(Number(raw.scene_match.confidence))
            : 0.5,
          ...(typeof raw.scene_match.note === "string" &&
          raw.scene_match.note.trim()
            ? { note: raw.scene_match.note.slice(0, 500) }
            : {}),
        }
      : { matched: true, confidence: 0.5 };
  const ratio = serverComplianceRatio(items);
  if (
    raw.compliance_ratio !== null &&
    raw.compliance_ratio !== undefined &&
    Number.isFinite(Number(raw.compliance_ratio)) &&
    Math.abs(Number(raw.compliance_ratio) - ratio) > 0.05
  ) {
    warnings.push(
      `模型 compliance_ratio 与条目复算结果不一致（模型 ${raw.compliance_ratio} / 复算 ${ratio.toFixed(2)}）`,
    );
  }
  return {
    scene_match: sceneMatch,
    items,
    compliance_ratio: ratio,
    review_required: raw.review_required === true,
  };
}

function canonicalRequirement(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

/**
 * 将模型条目逐条绑定到提交时锁定的任务要求。
 * 要求文本和 hard/soft 类型由服务端快照覆盖；缺项不得静默跳过。
 */
export function alignTaskComplianceToRequirements(
  compliance: TaskComplianceResult | null,
  expectedRequirements: Array<{
    type: "hard" | "soft";
    content: string;
  }>,
  warnings: string[],
): TaskComplianceResult {
  const available = new Map<string, TaskComplianceItem[]>();
  for (const item of compliance?.items ?? []) {
    const key = canonicalRequirement(item.requirement);
    const candidates = available.get(key) ?? [];
    candidates.push(item);
    available.set(key, candidates);
  }

  let requiresReview = compliance?.review_required === true;
  const items = expectedRequirements.map((expected) => {
    const key = canonicalRequirement(expected.content);
    const candidates = available.get(key) ?? [];
    const matched = candidates.shift();
    if (candidates.length === 0) available.delete(key);
    else available.set(key, candidates);

    if (!matched) {
      warnings.push(`任务符合度缺少锁定要求：${expected.content}`);
      requiresReview = true;
      return {
        requirement: expected.content,
        type: expected.type,
        result: "unmet" as const,
        confidence: 0,
        evidence_timestamps_ms: [],
      };
    }
    if (matched.type !== expected.type) {
      warnings.push(`任务要求类型已由服务端快照覆盖：${expected.content}`);
    }
    if (matched.evidence_timestamps_ms.length === 0) {
      warnings.push(`任务符合度判定缺少证据时间点：${expected.content}`);
      requiresReview = true;
    }
    return {
      ...matched,
      requirement: expected.content,
      type: expected.type,
    };
  });

  const unexpectedCount = [...available.values()].reduce(
    (total, candidates) => total + candidates.length,
    0,
  );
  if (unexpectedCount > 0) {
    warnings.push(`模型返回 ${unexpectedCount} 条不属于锁定快照的任务要求，已忽略`);
    requiresReview = true;
  }
  if (!compliance) {
    warnings.push("模型未返回任务符合度区块");
    requiresReview = true;
  }

  return {
    scene_match: compliance?.scene_match ?? {
      matched: false,
      confidence: 0,
      note: "模型未返回场景匹配结论",
    },
    items,
    compliance_ratio: serverComplianceRatio(items),
    review_required: requiresReview,
  };
}

/** 服务端按条目复算符合度比例：met=1、partial=0.5、unmet=0（无条目时为 0） */
export function serverComplianceRatio(
  items: TaskComplianceResult["items"],
): number {
  if (items.length === 0) return 0;
  const total = items.reduce((sum, item) => {
    if (item.result === "met") return sum + 1;
    if (item.result === "partial") return sum + 0.5;
    return sum;
  }, 0);
  return total / items.length;
}

/**
 * 服务端任务符合度复算：覆盖模型 D4 分数并重算总分。
 * - D4 系数 = 符合度比例 × 场景匹配因子（场景不匹配 0.5）；
 * - 硬性要求未满足 ≥ 1 项或场景不匹配 → 进入人工复核（review_pending）；
 * - 重算 raw_total_score / final_score / settlement_ratio。
 * 返回新的 normalized 对象，不修改入参。
 */
export function applyServerTaskCompliance(
  normalized: NormalizedVideoQcResultV1,
  compliance: TaskComplianceResult,
): NormalizedVideoQcResultV1 {
  const ratio = serverComplianceRatio(compliance.items);
  const sceneMatched = compliance.scene_match.matched;
  const sceneFactor = sceneMatched ? 1 : 0.5;
  const d4Coefficient = clampRatio(ratio * sceneFactor);

  const hardUnmet = compliance.items.filter(
    (item) => item.type === "hard" && item.result === "unmet",
  );
  const complianceReview =
    compliance.review_required || !sceneMatched || hardUnmet.length > 0;
  const reviewReasons = [...normalized.reviewReasons];
  if (compliance.review_required) {
    reviewReasons.push("任务符合度：条目不完整或证据不足，需人工复核");
  }
  if (!sceneMatched) {
    reviewReasons.push("任务符合度：视频内容与任务声明场景不匹配");
  }
  if (hardUnmet.length > 0) {
    reviewReasons.push(
      `任务符合度：${hardUnmet.length} 条硬性要求未满足（${hardUnmet
        .slice(0, 5)
        .map((item) => item.requirement)
        .join("；")}）`,
    );
  }

  const dimensions = { ...normalized.dimensions };
  const d4 = dimensions.task_authenticity_completeness;
  dimensions.task_authenticity_completeness = {
    ...d4,
    coefficient: d4Coefficient,
    score: Math.round((d4Coefficient * 20 + Number.EPSILON) * 10) / 10,
    calculation_trace: [
      d4.calculation_trace,
      `server_task_compliance: ratio=${ratio.toFixed(3)}, scene_matched=${sceneMatched}, coefficient=${d4Coefficient.toFixed(3)}`,
    ]
      .filter(Boolean)
      .join("\n"),
    metrics: {
      ...d4.metrics,
      task_compliance_ratio: ratio,
      ...(sceneMatched ? {} : { scene_matched: 0 }),
    },
  };

  const unroundedTotal = (
    Object.values(dimensions) as QualityDimension[]
  ).reduce<number | null>((total, dimension) => {
    if (dimension.coefficient === null) return null;
    const score = 20 * dimension.coefficient;
    return total === null ? score : total + score;
  }, 0);
  const finalScore =
    unroundedTotal === null
      ? null
      : Math.round(
          (Math.max(0, Math.min(100, unroundedTotal)) + Number.EPSILON) * 10,
        ) / 10;

  const evaluationStatus: NormalizedVideoQcResultV1["evaluationStatus"] =
    complianceReview && normalized.evaluationStatus === "scored"
      ? "review_pending"
      : normalized.evaluationStatus;
  const settlementRatio =
    evaluationStatus === "hard_reject"
      ? 0
      : evaluationStatus === "scored"
        ? coefficientForScore(finalScore ?? 0)
        : null;

  return {
    ...normalized,
    dimensions,
    rawTotalScore:
      unroundedTotal === null ? null : Math.round((unroundedTotal + Number.EPSILON) * 10) / 10,
    finalScore,
    settlementRatio,
    taskCompliance: {
      ...compliance,
      review_required:
        compliance.review_required || complianceReview,
    },
    evaluationStatus,
    reviewRequired:
      normalized.reviewRequired || complianceReview,
    reviewReasons: [...new Set(reviewReasons)],
    validation: {
      ...normalized.validation,
      warnings: [
        ...normalized.validation.warnings,
        "任务符合度已由服务端按条目复算并覆盖 D4 分数",
      ],
    },
  };
}
