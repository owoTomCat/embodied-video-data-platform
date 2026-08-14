import type {
  DimensionKey,
  ModelRunMetadata,
  NormalizedVideoQcResultV1,
  PreparedVideoEvidence,
  QualityDimension,
  RawVideoQcResultV1,
  VideoQcInputV1,
} from "./video-quality.types.js";

export type NormalizeVideoQcInput = {
  raw: RawVideoQcResultV1;
  sourceInput: VideoQcInputV1;
  evidence: PreparedVideoEvidence;
  modelRuns: ModelRunMetadata[];
};

const dimensionKeys: DimensionKey[] = [
  "first_person_and_composition",
  "hand_forearm_object_integrity",
  "frame_and_video_quality",
  "task_authenticity_completeness",
  "task_value_uniqueness",
];

const qualityDimensionKeys = dimensionKeys.slice(0, 4);
const demandDimensionKey: DimensionKey = "task_value_uniqueness";

function roundOne(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function roundFour(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function nearlyEqual(left: number, right: number, tolerance = 0.05): boolean {
  return Math.abs(left - right) <= tolerance;
}

function coefficientOnGrid(
  errors: string[],
  path: string,
  value: number,
  allowed: readonly number[],
): void {
  if (!allowed.some((candidate) => nearlyEqual(candidate, value, 0.001))) {
    errors.push(`${path}=${value} 不属于规则允许档位 ${allowed.join("/")}`);
  }
}

function segmentNumber(segment: Record<string, unknown>, key: string): number {
  return Number(segment[key]);
}

function segmentTimes(segment: Record<string, unknown>): {
  startMs: number;
  endMs: number;
} {
  return {
    startMs: segmentNumber(segment, "start_ms"),
    endMs: segmentNumber(segment, "end_ms"),
  };
}

function validateSegmentTimeline(input: {
  key: DimensionKey;
  segments: Array<Record<string, unknown>>;
  durationMs: number;
  expectedCoveredMs: number;
  requireFullCoverage: boolean;
  errors: string[];
}): boolean {
  const sorted = [...input.segments].sort(
    (left, right) => segmentNumber(left, "start_ms") - segmentNumber(right, "start_ms"),
  );
  let coveredMs = 0;
  let previousEnd = 0;
  let valid = sorted.length > 0;
  for (const [index, segment] of sorted.entries()) {
    const { startMs, endMs } = segmentTimes(segment);
    const evidence = Array.isArray(segment.evidence_timestamps_ms)
      ? segment.evidence_timestamps_ms.map(Number)
      : [];
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs < 0 ||
      endMs > input.durationMs ||
      endMs <= startMs
    ) {
      input.errors.push(`${input.key}.segments.${index} 时间区间无效`);
      valid = false;
      continue;
    }
    if (index > 0 && startMs < previousEnd) {
      input.errors.push(`${input.key}.segments 存在重叠区间`);
      valid = false;
    }
    if (input.requireFullCoverage && startMs !== previousEnd) {
      input.errors.push(`${input.key}.segments 未连续覆盖完整分析时长`);
      valid = false;
    }
    if (
      evidence.length === 0 ||
      evidence.some((timestamp) => timestamp < startMs || timestamp > endMs)
    ) {
      input.errors.push(`${input.key}.segments.${index} 缺少区间内证据时间点`);
      valid = false;
    }
    coveredMs += endMs - startMs;
    previousEnd = Math.max(previousEnd, endMs);
  }
  if (
    input.requireFullCoverage &&
    (sorted.length === 0 || segmentNumber(sorted[0]!, "start_ms") !== 0 || previousEnd !== input.durationMs)
  ) {
    input.errors.push(`${input.key}.segments 必须从 0 连续覆盖到 ${input.durationMs}ms`);
    valid = false;
  }
  if (!nearlyEqual(coveredMs, input.expectedCoveredMs, 1)) {
    input.errors.push(
      `${input.key}.segments 覆盖 ${coveredMs}ms，与规则分母 ${input.expectedCoveredMs}ms 不一致`,
    );
    valid = false;
  }
  return valid;
}

type RecalculatedDimension = {
  coefficient: number;
  calculationTrace: string;
};

type FactorObservation = {
  coefficient: number;
  startMs: number;
  endMs: number;
};

function factorObservations(input: {
  key: DimensionKey;
  dimension: QualityDimension;
  durationMs: number;
  metadata: PreparedVideoEvidence["metadata"];
}): Map<string, FactorObservation[]> {
  const result = new Map<string, FactorObservation[]>();
  const add = (subcriterion: string, coefficient: number, startMs: number, endMs: number) => {
    result.set(subcriterion, [
      ...(result.get(subcriterion) ?? []),
      { coefficient, startMs, endMs },
    ]);
  };
  const segmentFactors: Partial<Record<DimensionKey, Record<string, string>>> = {
    first_person_and_composition: {
      POV: "c_pov",
      ANGLE: "c_angle",
      ORIENTATION: "c_orientation",
      ARM_ENTRY: "c_arm_entry",
    },
    hand_forearm_object_integrity: {
      COMPLETENESS: "c_completeness",
      EDGE: "c_edge",
      SCALE: "c_scale",
      OCCLUSION: "c_occlusion",
      OBJECT_VISIBILITY: "c_object_visibility",
    },
    frame_and_video_quality: {
      SHARPNESS: "c_sharpness",
      EXPOSURE: "c_exposure",
      STABILITY: "c_stability",
      CONTINUITY: "c_continuity",
    },
    task_authenticity_completeness: {
      LEVEL: "c_level",
      AUTHENTICITY: "c_authenticity",
      PROGRESS: "c_progress",
    },
  };
  for (const segment of input.dimension.segments) {
    if (
      input.key === "hand_forearm_object_integrity" &&
      segment.hand_required !== true
    ) {
      continue;
    }
    const { startMs, endMs } = segmentTimes(segment);
    for (const [subcriterion, field] of Object.entries(segmentFactors[input.key] ?? {})) {
      add(subcriterion, segmentNumber(segment, field), startMs, endMs);
    }
  }
  if (input.key === "frame_and_video_quality") {
    add("RESOLUTION", resolutionCoefficient(Math.min(input.metadata.display_width, input.metadata.display_height)), 0, input.durationMs);
    add("FPS", fpsCoefficient(input.metadata.effective_fps), 0, input.durationMs);
  }
  if (input.key === "task_authenticity_completeness") {
    add("COMPLETION", Number(input.dimension.completion_coefficient), 0, input.durationMs);
  }
  return result;
}

function validateDimensionIssues(input: {
  key: DimensionKey;
  dimension: QualityDimension;
  durationMs: number;
  metadata: PreparedVideoEvidence["metadata"];
  errors: string[];
}): void {
  const observations = factorObservations(input);
  const deficient = [...observations.entries()]
    .filter(([, values]) => values.some((value) => value.coefficient < 0.999))
    .map(([subcriterion]) => subcriterion);
  const reported = new Set(input.dimension.issues.map((issue) => issue.subcriterion));
  for (const subcriterion of deficient) {
    if (!reported.has(subcriterion)) {
      input.errors.push(`${input.key}.${subcriterion} 存在低于满档的规则因子，但缺少对应 issue`);
    }
  }
  for (const [index, issue] of input.dimension.issues.entries()) {
    const path = `${input.key}.issues.${index}`;
    if (!issue.subcriterion || !observations.has(issue.subcriterion)) {
      input.errors.push(`${path}.subcriterion 不是该维度允许的固定子项`);
      continue;
    }
    if (!issue.observed_value?.trim()) input.errors.push(`${path}.observed_value 缺少观察事实`);
    if (!issue.matched_level?.trim()) input.errors.push(`${path}.matched_level 缺少命中档位`);
    if (!issue.recommendation?.trim()) input.errors.push(`${path}.recommendation 缺少可执行建议`);
    if (!issue.evidence_source) input.errors.push(`${path}.evidence_source 缺少证据来源`);
    if (typeof issue.coefficient !== "number") {
      input.errors.push(`${path}.coefficient 缺少档位系数`);
      continue;
    }
    const matches = observations.get(issue.subcriterion)!.some(
      (observation) =>
        observation.coefficient < 0.999 &&
        nearlyEqual(observation.coefficient, issue.coefficient!, 0.001) &&
        issue.start_ms < observation.endMs &&
        issue.end_ms > observation.startMs,
    );
    if (!matches) {
      input.errors.push(`${path} 的系数或时间区间与实际 segment 因子不一致`);
    }
  }
}

function orientationCoefficient(aspectRatio: number): number {
  if (aspectRatio >= 1.2) return 1;
  if (aspectRatio >= 0.9) return 0.7;
  return 0.2;
}

function resolutionCoefficient(shortSide: number): number {
  if (shortSide >= 1080) return 1;
  if (shortSide >= 720) return 0.8;
  if (shortSide >= 540) return 0.55;
  if (shortSide >= 480) return 0.35;
  return 0.15;
}

function fpsCoefficient(fps: number): number {
  if (fps >= 55) return 1;
  if (fps >= 45) return 0.9;
  if (fps >= 30) return 0.7;
  if (fps >= 24) return 0.45;
  return 0.2;
}

function deterministicFrameIssue(input: {
  subcriterion: "RESOLUTION" | "FPS";
  observedValue: string;
  matchedLevel: string;
  coefficient: number;
  durationMs: number;
}): QualityDimension["issues"][number] {
  const isResolution = input.subcriterion === "RESOLUTION";
  return {
    reason_code: isResolution ? "RESOLUTION_LOW" : "FPS_LOW",
    description: `${input.observedValue}，命中${input.matchedLevel}档位`,
    start_ms: 0,
    end_ms: input.durationMs,
    severity: input.coefficient <= 0.35
      ? "major"
      : input.coefficient <= 0.7
        ? "moderate"
        : "minor",
    confidence: 1,
    evidence_timestamps_ms: [0],
    subcriterion: input.subcriterion,
    rule_id: stableRuleId("frame_and_video_quality", input.subcriterion, input.coefficient),
    observed_value: input.observedValue,
    matched_level: input.matchedLevel,
    coefficient: input.coefficient,
    evidence_source: "detector",
    recommendation: isResolution
      ? "提升采集分辨率至 1080p，最低不低于 720p"
      : "优先使用 55fps 或以上拍摄，最低保持 30fps",
  };
}

function withDeterministicFrameIssues(input: {
  dimension: QualityDimension;
  durationMs: number;
  metadata: PreparedVideoEvidence["metadata"];
}): QualityDimension {
  const issues = [...input.dimension.issues];
  const reported = new Set(issues.map((issue) => issue.subcriterion));
  const shortSide = Math.min(input.metadata.display_width, input.metadata.display_height);
  const resolution = resolutionCoefficient(shortSide);
  if (resolution < 0.999 && !reported.has("RESOLUTION")) {
    issues.push(deterministicFrameIssue({
      subcriterion: "RESOLUTION",
      observedValue: `画面短边分辨率为 ${shortSide}px`,
      matchedLevel: shortSide >= 720 ? "720～1079" : shortSide >= 540 ? "540～719" : shortSide >= 480 ? "480～539" : "<480",
      coefficient: resolution,
      durationMs: input.durationMs,
    }));
  }
  const fps = fpsCoefficient(input.metadata.effective_fps);
  if (fps < 0.999 && !reported.has("FPS")) {
    issues.push(deterministicFrameIssue({
      subcriterion: "FPS",
      observedValue: `有效帧率为 ${input.metadata.effective_fps.toFixed(1)}fps`,
      matchedLevel: input.metadata.effective_fps >= 45 ? "45～54fps" : input.metadata.effective_fps >= 30 ? "30～44fps" : input.metadata.effective_fps >= 24 ? "24～29fps" : "<24fps",
      coefficient: fps,
      durationMs: input.durationMs,
    }));
  }
  return { ...input.dimension, issues };
}

function recalculateQualityDimension(input: {
  key: DimensionKey;
  dimension: QualityDimension;
  durationMs: number;
  metadata: PreparedVideoEvidence["metadata"];
  errors: string[];
}): RecalculatedDimension | null {
  const { key, dimension, durationMs, metadata, errors } = input;
  if (key === "first_person_and_composition") {
    if (!validateSegmentTimeline({ key, segments: dimension.segments, durationMs, expectedCoveredMs: durationMs, requireFullCoverage: true, errors })) return null;
    let weighted = 0;
    for (const [index, segment] of dimension.segments.entries()) {
      const values = {
        c_pov: segmentNumber(segment, "c_pov"),
        c_angle: segmentNumber(segment, "c_angle"),
        c_orientation: segmentNumber(segment, "c_orientation"),
        c_arm_entry: segmentNumber(segment, "c_arm_entry"),
      };
      coefficientOnGrid(errors, `${key}.segments.${index}.c_pov`, values.c_pov, [1, 0.8, 0.5, 0.2, 0]);
      coefficientOnGrid(errors, `${key}.segments.${index}.c_angle`, values.c_angle, [1, 0.8, 0.5, 0.2]);
      coefficientOnGrid(errors, `${key}.segments.${index}.c_orientation`, values.c_orientation, [1, 0.7, 0.2]);
      coefficientOnGrid(errors, `${key}.segments.${index}.c_arm_entry`, values.c_arm_entry, [1, 0.8, 0.4, 0.2]);
      const expectedOrientation = orientationCoefficient(metadata.display_aspect_ratio);
      if (!nearlyEqual(values.c_orientation, expectedOrientation, 0.001)) {
        errors.push(`${key}.segments.${index}.c_orientation 与媒体宽高比不一致`);
      }
      const coefficient = 0.5 * values.c_pov + 0.25 * values.c_angle + 0.15 * expectedOrientation + 0.1 * values.c_arm_entry;
      const { startMs, endMs } = segmentTimes(segment);
      weighted += (endMs - startMs) * coefficient;
    }
    const coefficient = weighted / durationMs;
    return { coefficient, calculationTrace: `服务端复算：C_view=Σ(时长×[0.50×c_pov+0.25×c_angle+0.15×c_orientation+0.10×c_arm_entry])/${durationMs}=${coefficient.toFixed(4)}；得分=25×C_view=${roundOne(25 * coefficient).toFixed(1)}` };
  }

  if (key === "hand_forearm_object_integrity") {
    if (!validateSegmentTimeline({ key, segments: dimension.segments, durationMs, expectedCoveredMs: durationMs, requireFullCoverage: true, errors })) return null;
    const handSegments = dimension.segments.filter(
      (segment) => segment.hand_required === true,
    );
    const derivedHandDuration = handSegments.reduce((sum, segment) => {
      const { startMs, endMs } = segmentTimes(segment);
      return sum + (endMs - startMs);
    }, 0);
    const reportedHandDuration = Number(dimension.hand_active_duration_ms);
    if (
      !Number.isFinite(reportedHandDuration) ||
      reportedHandDuration <= 0 ||
      derivedHandDuration <= 0
    ) {
      errors.push(`${key}.hand_active_duration_ms 必须大于 0`);
      return null;
    }
    if (!nearlyEqual(reportedHandDuration, derivedHandDuration, 1)) {
      errors.push(
        `${key}.hand_active_duration_ms 与 hand_required=true 的区间总时长不一致`,
      );
    }
    let weighted = 0;
    for (const [index, segment] of handSegments.entries()) {
      const values = [
        segmentNumber(segment, "c_completeness"),
        segmentNumber(segment, "c_edge"),
        segmentNumber(segment, "c_scale"),
        segmentNumber(segment, "c_occlusion"),
        segmentNumber(segment, "c_object_visibility"),
      ];
      const allowed = [
        [1, 0.85, 0.6, 0.25, 0],
        [1, 0.85, 0.6, 0.25, 0],
        [1, 0.85, 0.6, 0.55, 0.25],
        [1, 0.85, 0.55, 0.2],
        [1, 0.85, 0.5, 0.2, 0],
      ] as const;
      ["c_completeness", "c_edge", "c_scale", "c_occlusion", "c_object_visibility"].forEach((name, factorIndex) => coefficientOnGrid(errors, `${key}.segments.${index}.${name}`, values[factorIndex]!, allowed[factorIndex]!));
      const { startMs, endMs } = segmentTimes(segment);
      weighted += (endMs - startMs) * Math.min(...values);
    }
    const coefficient = weighted / derivedHandDuration;
    return { coefficient, calculationTrace: `服务端复算：完整时间轴逐段标注 hand_required；T_hand=${derivedHandDuration}；C_hand=Σ(hand_required=true 区间时长×min(c_completeness,c_edge,c_scale,c_occlusion,c_object_visibility))/${derivedHandDuration}=${coefficient.toFixed(4)}；得分=25×C_hand=${roundOne(25 * coefficient).toFixed(1)}` };
  }

  if (key === "frame_and_video_quality") {
    if (!validateSegmentTimeline({ key, segments: dimension.segments, durationMs, expectedCoveredMs: durationMs, requireFullCoverage: true, errors })) return null;
    const cResolution = resolutionCoefficient(Math.min(metadata.display_width, metadata.display_height));
    const cFps = fpsCoefficient(metadata.effective_fps);
    const cSpec = Math.min(cResolution, cFps);
    let visualWeighted = 0;
    for (const [index, segment] of dimension.segments.entries()) {
      const values = [
        segmentNumber(segment, "c_sharpness"),
        segmentNumber(segment, "c_exposure"),
        segmentNumber(segment, "c_stability"),
        segmentNumber(segment, "c_continuity"),
      ];
      const allowed = [[1, 0.85, 0.55, 0.2, 0], [1, 0.85, 0.55, 0.2], [1, 0.85, 0.55, 0.2], [1, 0.85, 0.5, 0.1]] as const;
      ["c_sharpness", "c_exposure", "c_stability", "c_continuity"].forEach((name, factorIndex) => coefficientOnGrid(errors, `${key}.segments.${index}.${name}`, values[factorIndex]!, allowed[factorIndex]!));
      const { startMs, endMs } = segmentTimes(segment);
      visualWeighted += (endMs - startMs) * Math.min(...values);
    }
    const cVisual = visualWeighted / durationMs;
    if (typeof dimension.c_spec !== "number" || !nearlyEqual(dimension.c_spec, cSpec, 0.001)) errors.push(`${key}.c_spec 与分辨率/帧率确定性复算不一致`);
    if (typeof dimension.c_visual !== "number" || !nearlyEqual(dimension.c_visual, cVisual, 0.001)) errors.push(`${key}.c_visual 与区间复算不一致`);
    const coefficient = Math.min(cSpec, cVisual);
    return { coefficient, calculationTrace: `服务端复算：C_spec=min(${cResolution.toFixed(2)},${cFps.toFixed(2)})=${cSpec.toFixed(2)}；C_visual=${cVisual.toFixed(4)}；C_frame=min(C_spec,C_visual)=${coefficient.toFixed(4)}；得分=25×C_frame=${roundOne(25 * coefficient).toFixed(1)}` };
  }

  if (key === "task_authenticity_completeness") {
    if (!validateSegmentTimeline({ key, segments: dimension.segments, durationMs, expectedCoveredMs: durationMs, requireFullCoverage: true, errors })) return null;
    const completion = Number(dimension.completion_coefficient);
    coefficientOnGrid(errors, `${key}.completion_coefficient`, completion, [1, 0.85, 0.65, 0.4, 0.2, 0]);
    let weighted = 0;
    const levelCoefficients = { L3: 1, L2: 0.7, L1: 0.4, L0: 0.1, INVALID: 0 } as const;
    for (const [index, segment] of dimension.segments.entries()) {
      const level = String(segment.level) as keyof typeof levelCoefficients;
      const cLevel = segmentNumber(segment, "c_level");
      if (!(level in levelCoefficients) || !nearlyEqual(cLevel, levelCoefficients[level], 0.001)) errors.push(`${key}.segments.${index}.c_level 与 level=${level} 不一致`);
      const authenticity = segmentNumber(segment, "c_authenticity");
      const progress = segmentNumber(segment, "c_progress");
      coefficientOnGrid(errors, `${key}.segments.${index}.c_authenticity`, authenticity, [1, 0.85, 0.5, 0.2, 0]);
      coefficientOnGrid(errors, `${key}.segments.${index}.c_progress`, progress, [1, 0.85, 0.6, 0.3, 0]);
      const { startMs, endMs } = segmentTimes(segment);
      weighted += (endMs - startMs) * Math.min(cLevel, authenticity, progress);
    }
    const cSegment = weighted / durationMs;
    const coefficient = Math.min(cSegment, completion);
    return { coefficient, calculationTrace: `服务端复算：C_segment=Σ(任务片段时长×min(c_level,c_authenticity,c_progress))/${durationMs}=${cSegment.toFixed(4)}；C_task=min(C_segment,${completion.toFixed(2)})=${coefficient.toFixed(4)}；得分=25×C_task=${roundOne(25 * coefficient).toFixed(1)}` };
  }

  return null;
}

function qualityBand(score: number): number | null {
  if (score >= 80) return 1;
  if (score >= 60) return 0.8;
  if (score >= 40) return 0.6;
  return null;
}

function demandStatus(coefficient: number): NormalizedVideoQcResultV1["demandStatus"] {
  if (coefficient >= 0.9) return "紧缺";
  if (coefficient >= 0.5) return "推荐";
  if (coefficient >= 0.3) return "已饱和";
  return "未配置";
}

const dimensionRulePrefixes: Record<DimensionKey, string> = {
  first_person_and_composition: "VIEW",
  hand_forearm_object_integrity: "HAND",
  frame_and_video_quality: "FRAME",
  task_authenticity_completeness: "TASK",
  task_value_uniqueness: "DEMAND",
};

function stableRuleId(
  dimension: DimensionKey,
  subcriterion: string,
  coefficient: number,
): string {
  const coefficientCode = `C${String(Math.round(coefficient * 100)).padStart(3, "0")}`;
  return `${dimensionRulePrefixes[dimension]}.${subcriterion}.${coefficientCode}`;
}

function addContribution(
  target: Map<string, number>,
  subcriterion: string,
  points: number,
): void {
  target.set(subcriterion, (target.get(subcriterion) ?? 0) + points);
}

function deductionContributions(input: {
  dimensions: Record<DimensionKey, QualityDimension>;
  durationMs: number;
  metadata: PreparedVideoEvidence["metadata"];
}): Record<string, Map<string, number>> {
  const result: Record<string, Map<string, number>> = {};
  const view = new Map<string, number>();
  const viewWeights: Record<string, { field: string; weight: number }> = {
    POV: { field: "c_pov", weight: 0.5 },
    ANGLE: { field: "c_angle", weight: 0.25 },
    ORIENTATION: { field: "c_orientation", weight: 0.15 },
    ARM_ENTRY: { field: "c_arm_entry", weight: 0.1 },
  };
  for (const segment of input.dimensions.first_person_and_composition.segments) {
    const { startMs, endMs } = segmentTimes(segment);
    for (const [subcriterion, config] of Object.entries(viewWeights)) {
      const factorValue = subcriterion === "ORIENTATION"
        ? orientationCoefficient(input.metadata.display_aspect_ratio)
        : segmentNumber(segment, config.field);
      addContribution(
        view,
        subcriterion,
        25 * ((endMs - startMs) / input.durationMs) * config.weight * (1 - factorValue),
      );
    }
  }
  result.first_person_and_composition = view;

  const hand = new Map<string, number>();
  const handDimension = input.dimensions.hand_forearm_object_integrity;
  const handDuration = Number(handDimension.hand_active_duration_ms);
  const handFactors = [
    ["COMPLETENESS", "c_completeness"],
    ["EDGE", "c_edge"],
    ["SCALE", "c_scale"],
    ["OCCLUSION", "c_occlusion"],
    ["OBJECT_VISIBILITY", "c_object_visibility"],
  ] as const;
  for (const segment of handDimension.segments) {
    if (segment.hand_required !== true) continue;
    const values = handFactors.map(([, field]) => segmentNumber(segment, field));
    const controllingIndex = values.indexOf(Math.min(...values));
    const { startMs, endMs } = segmentTimes(segment);
    addContribution(hand, handFactors[controllingIndex]![0], 25 * ((endMs - startMs) / handDuration) * (1 - values[controllingIndex]!));
  }
  result.hand_forearm_object_integrity = hand;

  const frame = new Map<string, number>();
  const frameDimension = input.dimensions.frame_and_video_quality;
  const cResolution = resolutionCoefficient(Math.min(input.metadata.display_width, input.metadata.display_height));
  const cFps = fpsCoefficient(input.metadata.effective_fps);
  const cSpec = Math.min(cResolution, cFps);
  const cVisual = Number(frameDimension.c_visual);
  if (cSpec <= cVisual) {
    addContribution(frame, cResolution <= cFps ? "RESOLUTION" : "FPS", 25 * (1 - cSpec));
  } else {
    const visualFactors = [
      ["SHARPNESS", "c_sharpness"],
      ["EXPOSURE", "c_exposure"],
      ["STABILITY", "c_stability"],
      ["CONTINUITY", "c_continuity"],
    ] as const;
    for (const segment of frameDimension.segments) {
      const values = visualFactors.map(([, field]) => segmentNumber(segment, field));
      const controllingIndex = values.indexOf(Math.min(...values));
      const { startMs, endMs } = segmentTimes(segment);
      addContribution(frame, visualFactors[controllingIndex]![0], 25 * ((endMs - startMs) / input.durationMs) * (1 - values[controllingIndex]!));
    }
  }
  result.frame_and_video_quality = frame;

  const task = new Map<string, number>();
  const taskDimension = input.dimensions.task_authenticity_completeness;
  const completion = Number(taskDimension.completion_coefficient);
  let segmentWeighted = 0;
  const taskFactors = [
    ["LEVEL", "c_level"],
    ["AUTHENTICITY", "c_authenticity"],
    ["PROGRESS", "c_progress"],
  ] as const;
  for (const segment of taskDimension.segments) {
    const values = taskFactors.map(([, field]) => segmentNumber(segment, field));
    const { startMs, endMs } = segmentTimes(segment);
    segmentWeighted += ((endMs - startMs) / input.durationMs) * Math.min(...values);
  }
  if (completion <= segmentWeighted) {
    addContribution(task, "COMPLETION", 25 * (1 - completion));
  } else {
    for (const segment of taskDimension.segments) {
      const values = taskFactors.map(([, field]) => segmentNumber(segment, field));
      const controllingIndex = values.indexOf(Math.min(...values));
      const { startMs, endMs } = segmentTimes(segment);
      addContribution(task, taskFactors[controllingIndex]![0], 25 * ((endMs - startMs) / input.durationMs) * (1 - values[controllingIndex]!));
    }
  }
  result.task_authenticity_completeness = task;
  return result;
}

function enrichedDeductions(
  dimensions: Record<DimensionKey, QualityDimension>,
  durationMs: number,
  metadata: PreparedVideoEvidence["metadata"],
  otherObservations: RawVideoQcResultV1["deductions"],
): RawVideoQcResultV1["deductions"] {
  const contributions = deductionContributions({ dimensions, durationMs, metadata });
  const qualityDeductions = qualityDimensionKeys.flatMap((dimension) => {
    const value = dimensions[dimension];
    const usedSubcriteria = new Set<string>();
    const allocated = value.issues.map((issue) => {
      const subcriterion = issue.subcriterion ?? issue.reason_code;
      if (usedSubcriteria.has(subcriterion)) return 0;
      usedSubcriteria.add(subcriterion);
      return roundOne(contributions[dimension]?.get(subcriterion) ?? 0);
    });
    const targetDeduction = roundOne(Math.max(0, 25 - value.score));
    const allocatedTotal = roundOne(allocated.reduce((sum, points) => sum + points, 0));
    const residual = roundOne(targetDeduction - allocatedTotal);
    if (Math.abs(residual) >= 0.05 && allocated.length > 0) {
      const largestIndex = allocated.reduce(
        (selected, points, index, all) => (points > all[selected]! ? index : selected),
        0,
      );
      allocated[largestIndex] = roundOne(Math.max(0, allocated[largestIndex]! + residual));
    }
    return value.issues.map((issue, index) => {
      const deductedPoints = allocated[index] ?? 0;
      const isControlling = deductedPoints > 0;
      return {
        ...issue,
        dimension,
        subcriterion: issue.subcriterion ?? issue.reason_code,
        rule_id: stableRuleId(
          dimension,
          issue.subcriterion ?? issue.reason_code,
          Number(issue.coefficient ?? value.coefficient),
        ),
        observed_value: issue.observed_value ?? issue.description,
        matched_level: issue.matched_level ?? issue.severity,
        coefficient: issue.coefficient ?? value.coefficient,
        points_before: 25,
        deducted_points: deductedPoints,
        points_after: value.score,
        scope: issue.scope ?? (issue.start_ms === 0 ? "full_video" : "time_range"),
        evidence_source: issue.evidence_source ?? "model",
        is_controlling: isControlling,
      };
    });
  });
  return [
    ...qualityDeductions,
    ...otherObservations.map((issue) => ({
      ...issue,
      dimension: "other",
      subcriterion: issue.subcriterion ?? "其他观察",
      rule_id: "OTHER.OBSERVATION",
      observed_value: issue.observed_value ?? issue.description,
      matched_level: issue.matched_level ?? "不影响评分",
      coefficient: 1,
      points_before: 0,
      deducted_points: 0,
      points_after: 0,
      scope: issue.scope ?? (issue.start_ms === 0 ? "full_video" : "time_range"),
      evidence_source: issue.evidence_source ?? "model",
      is_controlling: false,
    })),
  ];
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
  startMs: number,
  endMs: number,
  durationMs: number,
): Interval | null {
  const start = Math.max(0, Math.min(durationMs, startMs));
  const end = Math.max(0, Math.min(durationMs, endMs));
  return end > start ? { startMs: start, endMs: end } : null;
}

export function normalizeVideoQcResult(
  input: NormalizeVideoQcInput,
): NormalizedVideoQcResultV1 {
  const errors: string[] = [];
  const warnings: string[] = [];
  const durationMs = input.sourceInput.analysis_duration_ms;
  const normalizedDimensions = {} as Record<DimensionKey, QualityDimension>;
  let unroundedQualityTotal = 0;

  for (const key of dimensionKeys) {
    const sourceDimension = input.raw.dimensions[key];
    const dimension = key === "frame_and_video_quality"
      ? withDeterministicFrameIssues({
          dimension: sourceDimension,
          durationMs,
          metadata: input.evidence.metadata,
        })
      : sourceDimension;
    if (key === demandDimensionKey) {
      const effectiveCoefficient = input.sourceInput.inventory_context.authoritative_coefficient;
      if (!nearlyEqual(dimension.coefficient, effectiveCoefficient)) {
        warnings.push("模型第五维系数已由服务端需求快照覆盖");
      }
      normalizedDimensions[key] = {
        ...dimension,
        coefficient: effectiveCoefficient,
        // D5 是乘数，不是 /25 分项；score 仅为旧结构兼容字段，统一归零。
        score: 0,
        calculation_trace: `服务端需求快照：C_demand=${effectiveCoefficient.toFixed(2)}`,
      };
      continue;
    }

    const recalculated = recalculateQualityDimension({
      key,
      dimension,
      durationMs,
      metadata: input.evidence.metadata,
      errors,
    });
    const effectiveCoefficient = recalculated?.coefficient ?? dimension.coefficient;
    const unroundedScore = 25 * effectiveCoefficient;
    const score = roundOne(unroundedScore);
    unroundedQualityTotal += unroundedScore;
    if (!nearlyEqual(dimension.coefficient, effectiveCoefficient, 0.001)) {
      errors.push(`${key} 的模型总系数与服务端从区间因子复算的系数不一致`);
    }
    if (!nearlyEqual(dimension.score, score)) {
      errors.push(`${key} 的模型分数与服务端从规则因子复算的分数不一致`);
    }
    for (const issue of dimension.issues) {
      if (issue.evidence_timestamps_ms.length === 0) {
        errors.push(`${key}/${issue.reason_code} 缺少证据时间点`);
      }
    }
    normalizedDimensions[key] = {
      ...dimension,
      coefficient: effectiveCoefficient,
      score,
      calculation_trace:
        recalculated?.calculationTrace ?? "服务端缺少可复算的区间因子，保留模型候选值并转人工复核",
    };
    validateDimensionIssues({
      key,
      dimension,
      durationMs,
      metadata: input.evidence.metadata,
      errors,
    });
  }

  const demandCoefficient = input.sourceInput.inventory_context.authoritative_coefficient;
  const qualityScore = Math.max(0, Math.min(100, unroundedQualityTotal));
  const finalScore = roundOne(qualityScore * demandCoefficient);
  if (!nearlyEqual(input.raw.raw_total_score, roundOne(unroundedQualityTotal), 0.11)) {
    errors.push("模型 raw_total_score 与前四个未舍入分项之和不一致");
  }
  if (!nearlyEqual(input.raw.final_score, finalScore, 0.11)) {
    errors.push("模型 final_score 与服务端复算结果不一致");
  }

  for (const key of qualityDimensionKeys) {
    const dimension = normalizedDimensions[key];
    if (dimension.score >= 24.95) continue;
    const hasExplanation = normalizedDimensions[key].issues.length > 0;
    if (!hasExplanation) {
      errors.push(`${key} 得分为 ${dimension.score}/25，但缺少对应扣分原因和证据`);
    }
  }

  const reasonDimensions = new Map<string, string>();
  const otherObservations = input.raw.deductions.filter(
    (issue) => issue.dimension === "other" && issue.rule_id === "OTHER.OBSERVATION",
  );
  if (otherObservations.length !== input.raw.deductions.length) {
    errors.push("顶层 deductions 只能包含 dimension=other、rule_id=OTHER.OBSERVATION 的非评分观察");
  }
  const modelIssues = [
    ...qualityDimensionKeys.flatMap((dimension) =>
      normalizedDimensions[dimension].issues.map((issue) => ({ ...issue, dimension })),
    ),
    ...otherObservations,
  ];
  for (const deduction of modelIssues) {
    if (deduction.evidence_timestamps_ms.length === 0) {
      errors.push(`${deduction.reason_code} 扣分缺少证据时间点`);
    }
    if (deduction.start_ms >= deduction.end_ms) {
      errors.push(`${deduction.reason_code} 的时间区间无效`);
    }
    if (
      deduction.end_ms > durationMs ||
      deduction.evidence_timestamps_ms.some(
        (timestamp) => timestamp < 0 || timestamp > durationMs,
      )
    ) {
      errors.push(`${deduction.reason_code} 的证据超出视频时间轴`);
    }
    const dimension = deduction.dimension ?? "unknown";
    const previous = reasonDimensions.get(deduction.reason_code);
    if (previous && previous !== dimension) {
      errors.push(`${deduction.reason_code} 在多个维度重复扣分`);
    }
    reasonDimensions.set(deduction.reason_code, dimension);
  }

  if (input.raw.hard_veto.triggered !== (input.raw.evaluation_status === "hard_reject")) {
    errors.push("hard_veto 与 evaluation_status 不一致");
  }
  if (
    input.raw.hard_veto.reasons.some((reason) => reason === "EXACT_DUPLICATE") &&
    !input.sourceInput.similarity_context.file_hash_exact
  ) {
    errors.push("EXACT_DUPLICATE 缺少权威文件哈希依据");
  }

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
  for (const segment of input.raw.billing_observations.candidate_invalid_segments) {
    if (segment.evidence_timestamps_ms.length === 0) {
      errors.push(`${segment.reason_code} 无效片段缺少证据时间点`);
    }
    const clipped = clippedInterval(segment.start_ms, segment.end_ms, durationMs);
    if (!clipped) {
      errors.push(`${segment.reason_code} 无效片段时间范围无效`);
      continue;
    }
    invalidSegments.push({
      reasonCode: segment.reason_code,
      ...clipped,
      source: "model",
    });
  }

  const invalidDurationMs = unionDuration(invalidSegments);
  const billableDurationMs = Math.max(0, durationMs - invalidDurationMs);
  let evaluationStatus = input.raw.evaluation_status;
  const qualityCoefficient = qualityBand(unroundedQualityTotal);
  if (evaluationStatus === "scored" && qualityCoefficient === null) {
    evaluationStatus = "review_pending";
    warnings.push("四维质量总分低于 40，按规则转人工复核");
  }
  if (errors.length > 0) {
    evaluationStatus = "review_pending";
  }
  const settlementRatio =
    evaluationStatus === "hard_reject"
      ? 0
      : evaluationStatus === "scored"
        ? roundFour((qualityCoefficient ?? 0) * demandCoefficient)
        : null;

  if (input.raw.review_required && input.raw.review_reasons.length === 0) {
    warnings.push("模型要求复核但没有给出复核原因");
  }

  return {
    schemaVersion: "video_qc_result_v2",
    ruleVersion: "video_qc_v2_traceable",
    promptVersion: "qwen_video_qc_prompt_v2_traceable",
    videoId: input.raw.video_id,
    evaluationStatus,
    dimensions: normalizedDimensions,
    qualityRawScore: roundOne(unroundedQualityTotal),
    qualityScore: roundOne(qualityScore),
    demandCoefficient,
    demandStatus:
      input.sourceInput.inventory_context.demand_status ??
      demandStatus(demandCoefficient),
    rawTotalScore: unroundedQualityTotal,
    finalScore,
    settlementRatio,
    analysisDurationMs: durationMs,
    invalidDurationMs,
    billableDurationMs,
    invalidSegments,
    hardVeto: input.raw.hard_veto,
    detectedTask: input.raw.detected_task,
    deductions: enrichedDeductions(
      normalizedDimensions,
      durationMs,
      input.evidence.metadata,
      otherObservations,
    ),
    recommendations: input.raw.recommendations,
    summary: input.raw.summary,
    reviewRequired: input.raw.review_required || errors.length > 0,
    reviewReasons: [
      ...input.raw.review_reasons,
      ...(errors.length > 0 ? ["服务端规则校验未通过"] : []),
    ],
    missingInputs: [...new Set([...input.sourceInput.missing_inputs, ...input.raw.missing_inputs])],
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
