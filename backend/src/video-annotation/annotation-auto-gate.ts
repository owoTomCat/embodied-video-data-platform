import type {
  RawVideoAnnotation,
  VideoAnnotationCandidateSuccess,
} from "./video-annotation.js";

export const ANNOTATION_AUTO_GATE_VERSION = "annotation_auto_gate_v1" as const;

export type AnnotationGateIssueLevel =
  | "repairable"
  | "retryable"
  | "manual_review"
  | "advisory";

export type AnnotationGateIssueResolution =
  | "repaired"
  | "retried"
  | "unresolved"
  | "not_applicable";

export type AnnotationGateIssue = {
  code: string;
  level: AnnotationGateIssueLevel;
  fieldPath: string | null;
  taskIndex: number | null;
  message: string;
  evidenceTimestampsMs: number[];
  resolution: AnnotationGateIssueResolution;
  previousValue?: unknown;
  nextValue?: unknown;
};

export type AnnotationAutoEligibility = "eligible" | "manual_required";

export type AnnotationAutoGateDecision = {
  version: typeof ANNOTATION_AUTO_GATE_VERSION;
  eligibility: AnnotationAutoEligibility;
  issues: AnnotationGateIssue[];
};

type CanonicalizedAnnotation = {
  raw: RawVideoAnnotation;
  repairs: AnnotationGateIssue[];
};

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function taskIndexFromPath(path: string | null): number | null {
  if (!path) return null;
  const match = /^tasks\[(\d+)\]/u.exec(path);
  return match ? Number(match[1]) : null;
}

function repairIssue(input: {
  code: string;
  fieldPath: string;
  message: string;
  previousValue: unknown;
  nextValue: unknown;
}): AnnotationGateIssue {
  return {
    code: input.code,
    level: "repairable",
    fieldPath: input.fieldPath,
    taskIndex: taskIndexFromPath(input.fieldPath),
    message: input.message,
    evidenceTimestampsMs: [],
    resolution: "repaired",
    previousValue: input.previousValue,
    nextValue: input.nextValue,
  };
}

function sortedUniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function uniqueTrimmedStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function repairArray<T>(input: {
  current: T[];
  next: T[];
  path: string;
  code: string;
  message: string;
  repairs: AnnotationGateIssue[];
  assign(next: T[]): void;
}): void {
  if (sameValue(input.current, input.next)) return;
  input.repairs.push(
    repairIssue({
      code: input.code,
      fieldPath: input.path,
      message: input.message,
      previousValue: input.current,
      nextValue: input.next,
    }),
  );
  input.assign(input.next);
}

/** Only normalizes representations whose meaning is unchanged. */
export function canonicalizeVideoAnnotation(
  input: RawVideoAnnotation,
): CanonicalizedAnnotation {
  const raw = structuredClone(input);
  const repairs: AnnotationGateIssue[] = [];

  const trimField = (
    path: string,
    current: string,
    assign: (next: string) => void,
    required = false,
  ) => {
    const next = current.trim();
    if (next === current) return;
    if (required && next.length === 0) return;
    repairs.push(
      repairIssue({
        code: "STRING_WHITESPACE_NORMALIZED",
        fieldPath: path,
        message: "已移除字段首尾空白",
        previousValue: current,
        nextValue: next,
      }),
    );
    assign(next);
  };

  trimField("video_id", raw.video_id, (value) => { raw.video_id = value; }, true);
  trimField("video_summary", raw.video_summary, (value) => { raw.video_summary = value; });
  trimField("assessability_reason", raw.assessability_reason, (value) => {
    raw.assessability_reason = value;
  }, true);
  if (raw.scene.coarse_label !== null) {
    trimField("scene.coarse_label", raw.scene.coarse_label, (value) => {
      raw.scene.coarse_label = value || null;
    });
  }
  if (raw.scene.fine_label !== null) {
    trimField("scene.fine_label", raw.scene.fine_label, (value) => {
      raw.scene.fine_label = value || null;
    });
  }
  repairArray({
    current: raw.scene.evidence_timestamps_ms,
    next: sortedUniqueNumbers(raw.scene.evidence_timestamps_ms),
    path: "scene.evidence_timestamps_ms",
    code: "EVIDENCE_TIMESTAMPS_CANONICALIZED",
    message: "场景证据时间点已去重并排序",
    repairs,
    assign: (value) => { raw.scene.evidence_timestamps_ms = value; },
  });

  raw.tasks.forEach((task, taskIndex) => {
    const prefix = `tasks[${taskIndex}]`;
    trimField(`${prefix}.task_label`, task.task_label, (value) => { task.task_label = value; }, true);
    trimField(`${prefix}.task_object`, task.task_object, (value) => { task.task_object = value; });
    trimField(`${prefix}.visible_postcondition`, task.visible_postcondition, (value) => {
      task.visible_postcondition = value;
    });
    repairArray({
      current: task.evidence_timestamps_ms,
      next: sortedUniqueNumbers(task.evidence_timestamps_ms),
      path: `${prefix}.evidence_timestamps_ms`,
      code: "EVIDENCE_TIMESTAMPS_CANONICALIZED",
      message: "任务证据时间点已去重并排序",
      repairs,
      assign: (value) => { task.evidence_timestamps_ms = value; },
    });
    for (const field of [
      "result_evidence_timestamps_ms",
      "failure_evidence_timestamps_ms",
      "recovery_evidence_timestamps_ms",
    ] as const) {
      repairArray({
        current: task[field],
        next: sortedUniqueNumbers(task[field]),
        path: `${prefix}.${field}`,
        code: "EVIDENCE_TIMESTAMPS_CANONICALIZED",
        message: "专项证据时间点已去重并排序",
        repairs,
        assign: (value) => { task[field] = value; },
      });
    }
    for (const field of ["manipulated_objects", "tools", "uncertainty_reasons"] as const) {
      repairArray({
        current: task[field],
        next: uniqueTrimmedStrings(task[field]),
        path: `${prefix}.${field}`,
        code: "STRING_ARRAY_CANONICALIZED",
        message: "无序字符串数组已去重并规范空白",
        repairs,
        assign: (value) => { task[field] = value; },
      });
    }
    task.atomic_action_sequence.forEach((action, actionIndex) => {
      trimField(
        `${prefix}.atomic_action_sequence[${actionIndex}].object`,
        action.object,
        (value) => { action.object = value; },
      );
      repairArray({
        current: action.evidence_timestamps_ms,
        next: sortedUniqueNumbers(action.evidence_timestamps_ms),
        path: `${prefix}.atomic_action_sequence[${actionIndex}].evidence_timestamps_ms`,
        code: "EVIDENCE_TIMESTAMPS_CANONICALIZED",
        message: "原子动作证据时间点已去重并排序",
        repairs,
        assign: (value) => { action.evidence_timestamps_ms = value; },
      });
    });
  });

  raw.coverage_segments.forEach((segment, segmentIndex) => {
    const prefix = `coverage_segments[${segmentIndex}]`;
    trimField(`${prefix}.visible_activity`, segment.visible_activity, (value) => {
      segment.visible_activity = value;
    }, true);
    const canonicalEvidence = sortedUniqueNumbers(segment.evidence_timestamps_ms);
    repairArray({
      current: segment.evidence_timestamps_ms,
      next: canonicalEvidence,
      path: `${prefix}.evidence_timestamps_ms`,
      code: "EVIDENCE_TIMESTAMPS_CANONICALIZED",
      message: "Coverage证据时间点已去重并排序",
      repairs,
      assign: (value) => { segment.evidence_timestamps_ms = value; },
    });
    if (canonicalEvidence.length > 0) {
      const nextBoundary = {
        start_ms: canonicalEvidence[0]!,
        end_ms: canonicalEvidence.at(-1)!,
      };
      const currentBoundary = {
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
      };
      if (!sameValue(currentBoundary, nextBoundary)) {
        repairs.push(
          repairIssue({
            code: "COVERAGE_BOUNDARY_CANONICALIZED",
            fieldPath: prefix,
            message: "Coverage边界已与自身首尾证据对齐",
            previousValue: currentBoundary,
            nextValue: nextBoundary,
          }),
        );
        segment.start_ms = nextBoundary.start_ms;
        segment.end_ms = nextBoundary.end_ms;
      }
    }
  });

  const coverageSetsAreDisjoint = (() => {
    const seen = new Set<number>();
    for (const segment of raw.coverage_segments) {
      for (const timestamp of segment.evidence_timestamps_ms) {
        if (seen.has(timestamp)) return false;
        seen.add(timestamp);
      }
    }
    return true;
  })();
  if (coverageSetsAreDisjoint) {
    const sorted = [...raw.coverage_segments].sort(
      (left, right) =>
        (left.evidence_timestamps_ms[0] ?? Number.MAX_SAFE_INTEGER) -
        (right.evidence_timestamps_ms[0] ?? Number.MAX_SAFE_INTEGER),
    );
    repairArray({
      current: raw.coverage_segments,
      next: sorted,
      path: "coverage_segments",
      code: "COVERAGE_SEGMENTS_SORTED",
      message: "Coverage区间已按证据时间稳定排序",
      repairs,
      assign: (value) => { raw.coverage_segments = value; },
    });
  }

  repairArray({
    current: raw.uncertain_fields,
    next: uniqueTrimmedStrings(raw.uncertain_fields),
    path: "uncertain_fields",
    code: "STRING_ARRAY_CANONICALIZED",
    message: "不确定字段已去重并规范空白",
    repairs,
    assign: (value) => { raw.uncertain_fields = value; },
  });
  repairArray({
    current: raw.global_limitations,
    next: uniqueTrimmedStrings(raw.global_limitations),
    path: "global_limitations",
    code: "STRING_ARRAY_CANONICALIZED",
    message: "全局限制已去重并规范空白",
    repairs,
    assign: (value) => { raw.global_limitations = value; },
  });

  return { raw, repairs };
}

function retryableIssue(error: string): AnnotationGateIssue {
  const taskIndex = taskIndexFromPath(error);
  const fieldPath = error.match(/^(tasks\[\d+\](?:\.[^ ]+)?|coverage_segments\[\d+\](?:\.[^ ]+)?)/u)?.[1] ?? null;
  let code = "SCHEMA_INVALID";
  if (/未绑定有效任务索引|超出所绑定任务|非任务区间不得绑定|对应 task coverage/u.test(error)) {
    code = "TASK_COVERAGE_REFERENCE_INVALID";
  } else if (/未被 coverage 覆盖|被 coverage 重复覆盖|coverage 区间不连续|coverage_segments\[\d+\].*(?:证据帧必须|前一 coverage|边界必须)/u.test(error)) {
    code = "COVERAGE_ASSIGNMENT_CONFLICT";
  } else if (/证据时间点|未提供的证据|未列入任务主证据/u.test(error)) {
    code = "EVIDENCE_REFERENCE_INVALID";
  }
  return {
    code,
    level: "retryable",
    fieldPath,
    taskIndex,
    message: error,
    evidenceTimestampsMs: [...error.matchAll(/\b(\d{1,12})\b/gu)].map((match) => Number(match[1])),
    resolution: "unresolved",
  };
}

const OPTIONAL_UNCERTAIN_PATHS = [
  /^video_summary$/u,
  /^scene\.(?:coarse_label|fine_label|confidence)$/u,
  /^temporal_structure_type$/u,
  /^model_assessability$/u,
  /^assessability_reason$/u,
  /^tasks\[\d+\]\.(?:atomic_action_sequence|completion|result_status|result_observability|result_evidence_type|visible_postcondition|failure_recovery|manipulated_objects|tools|interaction_primitives|uncertainty_reasons|confidence)(?:\.|\[|$)/u,
  /^global_limitations$/u,
] as const;

const CORE_UNCERTAIN_PATH =
  /^tasks\[(\d+)\]\.(?:task_label|task_verb|start_ms|end_ms)$/u;

function issue(input: {
  code: string;
  level: "manual_review" | "advisory";
  fieldPath?: string | null;
  taskIndex?: number | null;
  message: string;
  evidenceTimestampsMs?: number[];
}): AnnotationGateIssue {
  return {
    code: input.code,
    level: input.level,
    fieldPath: input.fieldPath ?? null,
    taskIndex: input.taskIndex ?? null,
    message: input.message,
    evidenceTimestampsMs: input.evidenceTimestampsMs ?? [],
    resolution: "not_applicable",
  };
}

export function evaluateAnnotationAutoGate(input: {
  candidate: Omit<VideoAnnotationCandidateSuccess, "gate">;
  repairs?: AnnotationGateIssue[];
}): AnnotationAutoGateDecision {
  const issues: AnnotationGateIssue[] = [...(input.repairs ?? [])];
  for (const error of input.candidate.validation.errors) {
    issues.push(retryableIssue(error));
  }

  const raw = input.candidate.raw;
  if (raw.tasks.length === 0) {
    issues.push(
      issue({
        code: "NO_TASK_DETECTED",
        level: "manual_review",
        message: "视频未识别到任何可见任务",
      }),
    );
  }
  raw.tasks.forEach((task, taskIndex) => {
    if (task.task_verb === "uncertain") {
      issues.push(
        issue({
          code: "UNRESOLVED_CORE_TASK_UNCERTAINTY",
          level: "manual_review",
          fieldPath: `tasks[${taskIndex}].task_verb`,
          taskIndex,
          message: "核心任务动作仍为uncertain",
          evidenceTimestampsMs: task.evidence_timestamps_ms,
        }),
      );
    }
    const effective = input.candidate.effective.tasks[taskIndex];
    for (const reason of effective?.policy_reasons ?? []) {
      issues.push(
        issue({
          code: "CONSERVATIVE_FIELD_DOWNGRADE",
          level: "advisory",
          fieldPath: `tasks[${taskIndex}]`,
          taskIndex,
          message: reason,
          evidenceTimestampsMs: task.evidence_timestamps_ms,
        }),
      );
    }
  });

  for (const path of raw.uncertain_fields) {
    const coreMatch = CORE_UNCERTAIN_PATH.exec(path);
    if (coreMatch) {
      issues.push(
        issue({
          code: "UNRESOLVED_CORE_TASK_UNCERTAINTY",
          level: "manual_review",
          fieldPath: path,
          taskIndex: Number(coreMatch[1]),
          message: `模型明确声明核心任务字段不确定：${path}`,
        }),
      );
      continue;
    }
    if (OPTIONAL_UNCERTAIN_PATHS.some((pattern) => pattern.test(path))) {
      issues.push(
        issue({
          code: "OPTIONAL_FIELD_UNCERTAINTY",
          level: "advisory",
          fieldPath: path,
          taskIndex: taskIndexFromPath(path),
          message: `可选或允许保守输出的字段不确定：${path}`,
        }),
      );
      continue;
    }
    issues.push(
      issue({
        code: "UNKNOWN_UNCERTAIN_FIELD_PATH",
        level: "manual_review",
        fieldPath: path,
        taskIndex: taskIndexFromPath(path),
        message: `无法分类的不确定字段路径：${path}`,
      }),
    );
  }

  if (input.candidate.sampling.maxFrameGapMs !== null && input.candidate.sampling.maxFrameGapMs > 1_000) {
    issues.push(
      issue({
        code: "SPARSE_SAMPLING_OBSERVED",
        level: "advisory",
        message: `最大采样间隔为${input.candidate.sampling.maxFrameGapMs}ms，仅作为运行元数据`,
      }),
    );
  }
  if (raw.model_assessability === "needs_review") {
    issues.push(
      issue({
        code: "MODEL_ASSESSABILITY_NOTE",
        level: "advisory",
        message: raw.assessability_reason,
      }),
    );
  }

  const eligibility = issues.some(
    (item) =>
      item.level === "manual_review" ||
      (item.level === "retryable" && item.resolution === "unresolved"),
  )
    ? "manual_required"
    : "eligible";
  return {
    version: ANNOTATION_AUTO_GATE_VERSION,
    eligibility,
    issues,
  };
}

export function unresolvedRetryableIssues(
  gate: AnnotationAutoGateDecision,
): AnnotationGateIssue[] {
  return gate.issues.filter(
    (item) => item.level === "retryable" && item.resolution === "unresolved",
  );
}

export function blockingGateIssues(
  gate: AnnotationAutoGateDecision,
): AnnotationGateIssue[] {
  return gate.issues.filter((item) => item.level === "manual_review");
}

export function advisoryGateIssues(
  gate: AnnotationAutoGateDecision,
): AnnotationGateIssue[] {
  return gate.issues.filter((item) => item.level === "advisory");
}

export function repairedGateIssues(
  gate: AnnotationAutoGateDecision,
): AnnotationGateIssue[] {
  return gate.issues.filter(
    (item) => item.level === "repairable" || item.resolution === "retried",
  );
}
