export const VIDEO_QC_RULE_VERSION = "video_qc_v2_traceable" as const;
export const VIDEO_QC_PROMPT_VERSION = "qwen_video_qc_prompt_v2_traceable" as const;
export const VIDEO_QC_INPUT_SCHEMA = "video_qc_input_v1" as const;
export const VIDEO_QC_RESULT_SCHEMA = "video_qc_result_v2" as const;

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
  };
  inventory_context: {
    snapshot_id: string;
    mode: "cold_start" | "guide_snapshot";
    demand_status?: "紧缺" | "推荐" | "已饱和";
    authoritative_coefficient: number;
    c_scene: number;
    c_standard_task: number;
    c_variant: number;
    current_video_excluded: true;
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

export type DimensionKey =
  | "first_person_and_composition"
  | "hand_forearm_object_integrity"
  | "frame_and_video_quality"
  | "task_authenticity_completeness"
  | "task_value_uniqueness";

export type QualityIssue = {
  reason_code: string;
  description: string;
  start_ms: number;
  end_ms: number;
  severity: "minor" | "moderate" | "major" | "critical";
  confidence: number;
  evidence_timestamps_ms: number[];
  subcriterion?: string;
  rule_id?: string;
  observed_value?: string;
  matched_level?: string;
  coefficient?: number;
  points_before?: number;
  deducted_points?: number;
  points_after?: number;
  scope?: "full_video" | "time_range";
  evidence_source?: "model" | "detector" | "demand_snapshot" | "human_review";
  recommendation?: string;
  is_controlling?: boolean;
};

export type QualityDimension = {
  coefficient: number;
  score: number;
  confidence: number;
  calculation_trace: string;
  segments: Array<Record<string, unknown>>;
  issues: QualityIssue[];
  hand_active_duration_ms?: number;
  c_spec?: number;
  c_visual?: number;
  completion_coefficient?: number;
  inventory_coefficient?: number;
  unique_coefficient?: number;
  similarity_total?: number;
};

export type RawVideoQcResultV1 = {
  schema_version: typeof VIDEO_QC_RESULT_SCHEMA;
  rule_version: typeof VIDEO_QC_RULE_VERSION;
  prompt_version: typeof VIDEO_QC_PROMPT_VERSION;
  video_id: string;
  evaluation_status: Exclude<EvaluationStatus, "system_failed">;
  hard_veto: {
    triggered: boolean;
    reasons: Array<string | Record<string, unknown>>;
  };
  detected_task: {
    scene_id: string;
    task_id: string;
    variant_id: string;
    task_summary: string;
    confidence: number;
  };
  dimensions: Record<DimensionKey, QualityDimension>;
  billing_observations: {
    candidate_invalid_segments: Array<{
      reason_code: string;
      description: string;
      start_ms: number;
      end_ms: number;
      confidence: number;
      evidence_timestamps_ms: number[];
    }>;
    candidate_valid_waiting_segments: Array<{
      waiting_type: string;
      description: string;
      start_ms: number;
      end_ms: number;
      confidence: number;
      evidence_timestamps_ms: number[];
    }>;
  };
  raw_total_score: number;
  final_score: number;
  summary: string;
  deductions: Array<QualityIssue & { dimension?: string }>;
  recommendations: string[];
  review_required: boolean;
  review_reasons: string[];
  missing_inputs: string[];
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
  qualityRawScore?: number;
  qualityScore?: number;
  demandCoefficient?: number;
  demandStatus?: "紧缺" | "推荐" | "已饱和" | "未配置";
  rawTotalScore: number;
  finalScore: number;
  settlementRatio: number | null;
  analysisDurationMs: number;
  invalidDurationMs: number;
  billableDurationMs: number;
  invalidSegments: Array<{
    reasonCode: string;
    startMs: number;
    endMs: number;
    source: "detector" | "model";
  }>;
  hardVeto: RawVideoQcResultV1["hard_veto"];
  detectedTask: RawVideoQcResultV1["detected_task"];
  deductions: RawVideoQcResultV1["deductions"];
  recommendations: string[];
  summary: string;
  reviewRequired: boolean;
  reviewReasons: string[];
  missingInputs: string[];
  validation: ValidationReport;
  rawModelResult: RawVideoQcResultV1;
  modelRuns: ModelRunMetadata[];
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
