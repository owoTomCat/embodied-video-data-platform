import type { VideoAnnotationCandidate } from "../video-annotation/video-annotation.js";

export const VIDEO_QC_RULE_VERSION = "video_qc_v2" as const;
export const VIDEO_QC_PROMPT_VERSION = "qwen_video_qc_prompt_v4" as const;
export const VIDEO_QC_INPUT_SCHEMA = "video_qc_input_v1" as const;
export const VIDEO_QC_RESULT_SCHEMA = "video_qc_v2" as const;

export type EvaluationStatus =
  | "scored"
  | "hard_reject"
  | "incomplete_input"
  | "review_pending"
  | "system_failed";

export type QualityStage =
  | "queued"
  | "uploading"
  | "media_analysis"
  | "initial_review"
  | "secondary_review"
  // Legacy values are retained so 30-day persisted task history remains readable.
  | "flash_review"
  | "plus_review"
  | "completed"
  | "review_pending"
  | "system_failed"
  | "cancelled";

export type DetectorWindow = {
  type: "black" | "freeze" | "blur" | "underexposed" | "overexposed";
  start_ms: number;
  end_ms: number;
  confidence: number;
  source: "ffmpeg";
};

export type VideoMediaMetadata = {
  display_width: number;
  display_height: number;
  display_aspect_ratio: number;
  duration_ms: number;
  nominal_fps: number;
  effective_fps: number;
  codec: string;
  bitrate_bps: number;
  file_size_bytes: number;
  rotation_degrees: number;
};

export type TechnicalMetrics = {
  decodable: boolean;
  decoded_duration_ms: number;
  black_ratio: number;
  freeze_ratio: number;
  blur_ratio: number | null;
  underexposure_ratio: number | null;
  overexposure_ratio: number | null;
  timestamp_discontinuity_ratio: number | null;
  detector_windows: DetectorWindow[];
};

export type VideoQcInputV1 = {
  schema_version: typeof VIDEO_QC_INPUT_SCHEMA;
  video_id: string;
  analysis_duration_ms: number;
  video_input_present: true;
  media_metadata: VideoMediaMetadata;
  technical_metrics: TechnicalMetrics;
  task_context: {
    submitted_task_name: string;
    expected_scene_id: string;
    expected_task_id: string;
    expected_variant_id: string;
    prohibited_content_policy: string[];
    /** 场景/动作/对象标签字典（供模型从中选择分类） */
    label_dictionary: string[];
  };
  inventory_context: {
    snapshot_id: string;
    mode: "cold_start" | "live_snapshot";
    authoritative_coefficient: number;
    c_scene: number;
    c_standard_task: number;
    c_variant: number;
    current_video_excluded: boolean;
    /** live_snapshot 模式下各层级的有效存量 */
    scene_inventory_count?: number | null;
    task_inventory_count?: number | null;
    variant_inventory_count?: number | null;
  };
  similarity_context: {
    snapshot_id: string;
    file_hash_exact: boolean;
    confirmed_duplicate: boolean;
    authoritative_coefficient: 1;
    s_video: 0;
    s_segment: 0;
    s_semantic: 0;
    matched_duration_ratio: 0;
    temporal_order_similarity: 0;
    top_candidates: Array<Record<string, unknown>>;
  };
  previous_model_observations: Array<Record<string, unknown>>;
  requested_output_schema: typeof VIDEO_QC_RESULT_SCHEMA;
  missing_inputs: string[];
};

export type TimestampedFrame = {
  timestampMs: number;
  dataUrl: string;
};

/** 调用方注入的库存稀缺度上下文（由 InventoryService 构建） */
export type InventoryContextInput = {
  snapshot_id: string;
  mode: "cold_start" | "live_snapshot";
  authoritative_coefficient: number;
  c_scene: number;
  c_standard_task: number;
  c_variant: number;
  scene_inventory_count?: number | null;
  task_inventory_count?: number | null;
  variant_inventory_count?: number | null;
};

export type DimensionKey =
  | "first_person_and_composition"
  | "hand_forearm_object_integrity"
  | "frame_and_video_quality"
  | "task_authenticity_completeness"
  | "task_value_uniqueness";

export type QualityIssue = {
  reason_code: string;
  description: string;
  start_ms: number | null;
  end_ms: number | null;
  severity: "info" | "minor" | "major" | "critical";
  confidence: number;
  evidence_timestamps_ms: number[];
};

export type QualityDimension = {
  coefficient: number | null;
  score: number | null;
  confidence: number;
  calculation_trace: string;
  segments: Array<Record<string, unknown>>;
  issues: QualityIssue[];
  metrics?: Record<string, number | null>;
  hand_active_duration_ms?: number | null;
  c_spec?: number | null;
  c_visual?: number | null;
  completion_coefficient?: number | null;
  inventory_coefficient?: number | null;
  unique_coefficient?: number | null;
  similarity_total?: number | null;
};

export type RawVideoQcResultV1 = {
  schema_version: typeof VIDEO_QC_RESULT_SCHEMA;
  // v2 提示词的标准输出不再要求模型回填这两个字段；缺失时由服务端归一化填充。
  rule_version?: typeof VIDEO_QC_RULE_VERSION;
  prompt_version?: typeof VIDEO_QC_PROMPT_VERSION;
  task_id: string;
  evaluation_status: Exclude<EvaluationStatus, "system_failed" | "completed"> | "completed";
  input_status: {
    is_complete: boolean;
    missing_required_inputs: string[];
    conflicts: Array<string | Record<string, unknown>>;
  };
  task_summary: string;
  overall_result: {
    raw_total_score: number | null;
    final_score: number | null;
    summary: string;
  };
  hard_reject: {
    triggered: boolean;
    reasons: Array<string | Record<string, unknown>>;
    candidates: Array<string | Record<string, unknown>>;
  };
  dimensions: Record<RawDimensionKey, RawQualityDimension>;
  review: {
    review_required: boolean;
    review_reasons: string[];
  };
  duration_result: {
    analysis_duration_ms: number | null;
    invalid_duration_ms: number | null;
    effective_duration_ms: number | null;
    effective_duration_ratio: number | null;
    invalid_segments: Array<RawDurationSegment>;
    necessary_wait_segments: Array<RawDurationSegment>;
  };
  recommendations: string[];
  /** 模型按标签字典输出的结构化任务分类（v3 提示词起） */
  detectedTask?: {
    scene_id?: string | null;
    standard_task_id?: string | null;
    variant_id?: string | null;
  } | null;
  /** 任务符合度（v2 提示词起；提供任务要求区块时必须输出） */
  task_compliance?: TaskComplianceResult | null;
};

export type RawDimensionKey = "D1" | "D2" | "D3" | "D4" | "D5";

export type RawDurationSegment = {
  reason_code: string;
  description: string;
  start_ms: number | null;
  end_ms: number | null;
  confidence: number;
  evidence_timestamps_ms: number[];
  source?: string;
};

export type RawQualityIssue = {
  reason_code: string;
  start_ms: number | null;
  end_ms: number | null;
  severity: "info" | "minor" | "major" | "critical";
  confidence: number;
  evidence_timestamps_ms: number[];
  description: string;
  source:
    | "visual_model"
    | "technical_metrics"
    | "deterministic_detector"
    | "inventory_context"
    | "similarity_context"
    | "caller_input";
};

export type RawQualityDimension = {
  score: number | null;
  coefficient: number | null;
  confidence: number;
  metrics: Record<string, number | null>;
  issues: RawQualityIssue[];
};

export type DetectedTaskSummary = {
  task_id: string;
  task_summary: string;
  confidence: number | null;
  /** 从标签字典中选择的场景分类 */
  scene_id?: string | null;
  /** 从标签字典中选择的动作/标准任务分类 */
  standard_task_id?: string | null;
  /** 从标签字典中选择的任务变体分类 */
  variant_id?: string | null;
};

/** 任务符合度条目判定（模型输出，服务端复算为准） */
export type TaskComplianceItemResult = "met" | "partial" | "unmet";

export type TaskComplianceItem = {
  requirement: string;
  type: "hard" | "soft";
  result: TaskComplianceItemResult;
  confidence: number;
  evidence_timestamps_ms: number[];
};

export type TaskComplianceResult = {
  scene_match: {
    matched: boolean;
    confidence: number;
    note?: string;
  };
  items: TaskComplianceItem[];
  compliance_ratio: number | null;
  review_required: boolean;
};

export type ValidationReport = {
  warnings: string[];
  errors: string[];
};

export type NormalizedVideoQcResultV1 = {
  schemaVersion: typeof VIDEO_QC_RESULT_SCHEMA;
  ruleVersion: typeof VIDEO_QC_RULE_VERSION;
  promptVersion: typeof VIDEO_QC_PROMPT_VERSION;
  videoId: string;
  evaluationStatus: EvaluationStatus;
  dimensions: Record<DimensionKey, QualityDimension>;
  rawTotalScore: number | null;
  finalScore: number | null;
  settlementRatio: number | null;
  analysisDurationMs: number | null;
  invalidDurationMs: number | null;
  billableDurationMs: number | null;
  invalidSegments: Array<{
    reasonCode: string;
    startMs: number;
    endMs: number;
    source: "detector" | "model";
  }>;
  hardVeto: RawVideoQcResultV1["hard_reject"];
  detectedTask: DetectedTaskSummary;
  /** 任务符合度（任务要求区块存在时由模型输出；服务端以复算结果为准） */
  taskCompliance: TaskComplianceResult | null;
  deductions: Array<QualityIssue & { dimension?: string }>;
  recommendations: string[];
  summary: string;
  reviewRequired: boolean;
  reviewReasons: string[];
  missingInputs: string[];
  validation: ValidationReport;
  rawModelResult: RawVideoQcResultV1;
  modelRuns: ModelRunMetadata[];
  /** 任务盲内容标注 Shadow 结果；不参与质检、通过或结算决策。 */
  candidateAnnotation?: VideoAnnotationCandidate;
  media: {
    metadata: VideoMediaMetadata;
    technicalMetrics: TechnicalMetrics;
    fullVideoSamplingFps: number;
    fullVideoFrameCount: number;
  };
};

export type ModelRunMetadata = {
  stage: "initial" | "review" | "flash" | "plus";
  model: string;
  requestId: string | null;
  durationMs: number;
  frameCount: number;
};

export type PreparedVideoEvidence = {
  sha256: string;
  metadata: VideoMediaMetadata;
  technicalMetrics: TechnicalMetrics;
  fullVideoFrames: TimestampedFrame[];
  fullVideoSamplingFps: number;
  missingMetrics: string[];
};

export type VideoQualityModelConfig = {
  apiKey: string;
  baseUrl: string;
  initialModel: string;
  reviewModel: string;
  timeoutMs: number;
};

export type BailianCallDiagnostic = {
  taskId: string;
  modelStage: "initial" | "review" | "flash" | "plus";
  operation: "analysis" | "review" | "repair";
  model: string;
  attempt: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: "success" | "http_error" | "network_error" | "invalid_response";
  httpStatus: number | null;
  requestId: string | null;
  retryable: boolean;
  errorName?: string;
  errorCode?: string;
  errorMessage?: string;
};
