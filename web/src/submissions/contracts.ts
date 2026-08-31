export type BackendUploadStatus =
  | "created"
  | "uploading"
  | "completing"
  | "uploaded"
  | "aborted";

export type BackendProcessingStatus =
  | "uploading"
  | "queued"
  | "probing"
  | "awaiting_ai"
  | "ai_processing"
  | "completed"
  | "stuck"
  | "system_failed";

export type BackendQualityStatus =
  | "queued"
  | "running"
  | "scored"
  | "hard_reject"
  | "review_pending"
  | "stuck"
  | "system_failed";

export type BackendQualityDimension = {
  coefficient: number;
  score: number;
  confidence: number;
  calculation_trace?: string;
  segments?: Array<Record<string, unknown>>;
  issues: Array<{
    reason_code: string;
    description: string;
    start_ms: number;
    end_ms: number;
    severity: "minor" | "moderate" | "major" | "critical";
    confidence: number;
    evidence_timestamps_ms: number[];
  }>;
  hand_active_duration_ms?: number;
  c_spec?: number;
  c_visual?: number;
  completion_coefficient?: number;
  inventory_coefficient?: number;
  unique_coefficient?: number;
  similarity_total?: number;
};

export type BackendQualityHardVeto = {
  triggered: boolean;
  reasons: Array<string | Record<string, unknown>>;
};

export type BackendQualityBillingObservations = {
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

export type BackendVideoAnnotationTask = {
  start_ms: number;
  end_ms: number;
  task_label: string;
  task_verb: string;
  task_object: string;
  evidence_level: "direct_visual" | "partially_inferred" | "uncertain";
  execution_pattern?: "single_goal" | "repeated_cycles" | "continuous_operation" | "uncertain";
  evidence_timestamps_ms: number[];
  manipulated_objects: string[];
  tools: string[];
  hand_mode: string;
  atomic_action_sequence?: Array<{
    order: number;
    verb: string;
    object: string;
    evidence_timestamps_ms: number[];
  }>;
  interaction_primitives: string[];
  completion: "complete" | "incomplete" | "partial" | "uncertain";
  result_observability?: "visible" | "partial" | "not_visible";
  result_status: "success" | "failure" | "partial" | "not_applicable" | "unknown";
  result_evidence_type?: "direct_visible_postcondition" | "action_completion_only" | "contextual_inference" | "not_observed";
  visible_postcondition?: string;
  result_evidence_timestamps_ms?: number[];
  failure_recovery?: string;
  complexity_signals?: string[];
  confidence: number;
  effective_completion: "complete" | "incomplete" | "partial" | "uncertain";
  effective_result_status: "success" | "failure" | "partial" | "not_applicable" | "unknown";
  effective_failure_recovery: string;
  effective_complexity_signals?: string[];
  policy_reasons: string[];
};

export type BackendAnnotationGateIssue = {
  code: string;
  level: "repairable" | "retryable" | "manual_review" | "advisory";
  fieldPath: string | null;
  taskIndex: number | null;
  message: string;
  evidenceTimestampsMs: number[];
  resolution: "repaired" | "retried" | "unresolved" | "not_applicable";
};

export type BackendVideoAnnotationCandidate =
  | {
      status: "system_failed";
      schemaVersion: string;
      policyVersion: string;
      promptVersion: string;
      promptContentSha256: string;
      model: string;
      error: string;
    }
  | {
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
      labelMappings: Array<{
        type: "scene" | "action" | "object";
        sourceText: string;
        status: "matched" | "proposed";
        labelId: string | null;
        labelName: string | null;
        confidence: number;
      }>;
      raw: Record<string, unknown> & {
        video_summary: string;
        scene: {
          coarse_label: string | null;
          fine_label: string | null;
          confidence: number;
        };
      };
      effective: {
        video_summary: string;
        temporal_structure_type?: string;
        model_assessability?: "assessable" | "needs_review";
        assessability_reason?: string;
        scene: {
          coarse_label: string | null;
          fine_label: string | null;
          confidence: number;
        };
        tasks: BackendVideoAnnotationTask[];
        coverage_segments?: Array<{
          start_ms: number;
          end_ms: number;
          segment_type: "task" | "transition" | "unclear";
          linked_task_index: number | null;
          visible_activity: string;
          evidence_timestamps_ms: number[];
        }>;
        uncertain_fields?: string[];
      };
      validation: { errors: string[]; warnings: string[] };
      reviewReasons: string[];
      gate?: {
        version: string;
        eligibility: "eligible" | "manual_required";
        issues: BackendAnnotationGateIssue[];
      };
    };

export type BackendQualityResult = {
  status: BackendQualityStatus;
  attempts: number;
  promptRevision: number;
  promptContentSha256: string;
  initialModel: string;
  reviewModel: string;
  modelRuns: Array<Record<string, unknown>>;
  finalScore: number | null;
  aiFinalScore?: number | null;
  rawTotalScore: number | null;
  settlementRatio: number | null;
  passed?: boolean | null;
  passThreshold?: number;
  invalidDurationMs: number | null;
  billableDurationMs: number | null;
  summary: string;
  recommendations: string[];
  deductions: Array<Record<string, unknown>>;
  reviewRequired: boolean;
  reviewReasons: string[];
  reviewRevision?: number;
  manualReview?: {
    reviewedByAccountId: string;
    reviewedByName: string;
    reviewedAt: number;
    reason: string;
    issues: Array<{ label: string; start: number; end: number }>;
    finalScore: number | null;
  };
  manualIssues?: Array<{ label: string; start: number; end: number }>;
  lastError?: string;
  progressStage?: string;
  progressUpdatedAt?: number;
  stuckReason?: string;
  detectedTask?: {
    scene_id?: string;
    task_id?: string;
    variant_id?: string;
    task_summary?: string;
    confidence?: number | null;
  };
  invalidSegments: Array<{
    reasonCode: string;
    startMs: number;
    endMs: number;
    source: string;
  }>;
  dimensions?: Record<string, BackendQualityDimension>;
  hardVeto?: BackendQualityHardVeto;
  taskCompliance?: {
    scene_match: { matched: boolean; confidence: number; note?: string };
    items: Array<{
      requirement: string;
      type: "hard" | "soft";
      result: "met" | "partial" | "unmet";
      confidence: number;
      evidence_timestamps_ms: number[];
    }>;
    compliance_ratio: number | null;
    review_required: boolean;
  };
  billingObservations?: BackendQualityBillingObservations;
  candidateAnnotation?: BackendVideoAnnotationCandidate;
  annotationReview?: {
    decision: "accepted" | "needs_correction";
    reason: string;
    reviewedByAccountId: string;
    reviewedByName: string;
    reviewedAt: number;
    candidateSchemaVersion: string | null;
    candidatePolicyVersion: string | null;
    candidatePromptVersion: string | null;
    candidatePromptContentSha256: string | null;
    correctedAnnotation?: {
      source: "human_correction";
      schemaVersion: string;
      policyVersion: string;
      raw: Record<string, unknown>;
      effective: Record<string, unknown>;
      labelMappings: unknown[];
      validation: { errors: string[]; warnings: string[] };
    };
  };
  startedAt?: number;
  completedAt?: number;
};

export type BackendMediaSegment = {
  id: string;
  type: "black" | "freeze";
  startSeconds: number;
  endSeconds: number;
  invalid: boolean;
  evidenceObjectKey?: string;
};

export type BackendSubmission = {
  id: string;
  fileName: string;
  ownerId: string;
  ownerName: string;
  teamId: string;
  teamName: string;
  sizeBytes: string;
  uploadStatus: BackendUploadStatus;
  processingStatus: BackendProcessingStatus;
  settlementStatus?: "settled" | "unsettled";
  duplicateCandidates?: Array<{
    id: string;
    candidateSubmissionId: string;
    candidateFileName?: string;
    similarity: number;
    status: "candidate" | "cleared";
    details?: Record<string, unknown>;
    createdAt: number;
  }>;
  failureCode?: string;
  failureMessage?: string;
  isTestData: boolean;
  assetStatus?: "active" | "quarantined";
  storageStatus?: "available" | "delete_pending" | "deleted";
  storage?: {
    status: "available" | "delete_pending" | "deleted";
    retainUntil?: number;
    deletedAt?: number;
    deletedByAccountId?: string;
    deletedByName?: string;
    deleteReason?: string;
  };
  quarantine?: {
    reason: string;
    quarantinedAt?: number;
    quarantinedByAccountId?: string;
    quarantinedByName?: string;
  };
  task?: {
    taskId: string;
    title?: string;
    revision: number | null;
    sceneName: string;
    taskType: "generic" | "preset" | "custom";
    requirements?: unknown;
    pricePointsPerMinute: number | null;
  } | null;
  authorization?: {
    dataUsageAuthorized: boolean;
    privacyConfirmed: boolean;
    sensitiveContentConfirmed: boolean;
    uploadPolicyVersion: string;
    confirmedAt?: number;
  };
  createdAt: number;
  uploadedAt?: number;
  media?: {
    durationSeconds: number;
    width: number;
    height: number;
    frameRate: number;
    codec: string;
    bitrate: string | null;
    sizeBytes: string;
  };
  segments: BackendMediaSegment[];
  thumbnail?: {
    url: string;
    expiresAt: number;
    contentType: string;
  };
  quality?: BackendQualityResult;
  audit?: Array<{
    id: string;
    actor: string;
    action: string;
    reason: string;
    createdAt: number;
    previousScore?: number;
    nextScore?: number;
  }>;
};

export type BackendSubmissionListPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type BackendSubmissionListResult = {
  submissions: BackendSubmission[];
  pagination: BackendSubmissionListPagination;
  taskSources?: Array<{
    taskId: string;
    title: string;
    sceneName: string;
  }>;
};

export type ReviewSubmissionQualityInput = {
  finalScore: number;
  reason: string;
  issues: Array<{ label: string; start: number; end: number }>;
  expectedReviewRevision?: number;
  quarantine?: boolean;
};

export type RerunAiQualityInput = {
  reason: string;
};

export type RenameSubmissionInput = {
  fileName: string;
  reason?: string;
};

export type DeleteSubmissionInput = {
  reason: string;
  force?: boolean;
};

export type DeleteSubmissionResult = {
  deletedSubmissionId: string;
  deletedFileName: string;
  deletedObjectKeys: string[];
  abortedUploadId?: string;
};

export type ClearDuplicateCandidateInput = {
  reason: string;
};

export type BackendAnnotationRun = {
  id: string;
  submissionId: string;
  trigger: "initial" | "manual";
  pipelineVersion: string;
  schemaVersion: string;
  evidencePolicyVersion: string;
  promptVersion: string | null;
  promptContentSha256: string | null;
  model: string | null;
  labelSetVersionId: string | null;
  labelSetRevision: number | null;
  executionStatus:
    | "queued"
    | "running"
    | "retry_scheduled"
    | "succeeded"
    | "system_failed"
    | "stuck"
    | "cancelled";
  reviewStatus:
    | "pending"
    | "not_required"
    | "accepted_unchanged"
    | "accepted_corrected"
    | "rejected"
    | "unable_to_judge";
  publicationStatus:
    | "candidate_only"
    | "human_verified"
    | "auto_accepted"
    | "rejected"
    | "superseded";
  attemptCount: number;
  fullModelAttempts: number;
  schemaRepairCalls: number;
  targetedRepairCalls: number;
  infrastructureRetryCount: number;
  providerCallCount: number;
  reviewRevision: number;
  autoEligibility: "not_evaluated" | "eligible" | "manual_required";
  autoGateVersion: string | null;
  autoGateIssues: BackendAnnotationGateIssue[];
  wouldAutoAccept: boolean;
  autoAcceptEnabledSnapshot: boolean;
  autoGateEvaluatedAt: number | null;
  auditStatus: "not_selected" | "pending" | "completed";
  auditSelectedAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  nextRetryAt: number | null;
  candidate: BackendVideoAnnotationCandidate | null;
  humanResult: Record<string, unknown> | null;
  review: {
    id: string;
    revision: number;
    disposition: Exclude<BackendAnnotationRun["reviewStatus"], "pending" | "not_required">;
    reviewKind: "blocking" | "audit";
    reviewedFields: string[];
    reasonCodes: string[];
    reviewDurationMs: number;
    reason: string;
    reviewerAccountId: string;
    reviewerName: string;
    createdAt: number;
  } | null;
  modelCalls: Array<{
    id: string;
    logicalFullAttempt: number;
    callKind: "full" | "schema_repair" | "targeted_repair";
    callStatus: "succeeded" | "failed";
    httpStatus: number | null;
    providerRequestId: string | null;
    responseModel: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    latencyMs: number;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: number;
  }>;
  corrections: Array<{
    id: string;
    targetType: string;
    targetId: string;
    fieldPath: string;
    previousValue: unknown;
    nextValue: unknown;
    reasonCode: string;
    comment: string | null;
    reviewerAccountId: string;
    createdAt: number;
  }>;
  queuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ReviewAnnotationRunInput = {
  expectedReviewRevision: number;
  disposition:
    | "accepted_unchanged"
    | "accepted_corrected"
    | "rejected"
    | "unable_to_judge";
  reviewedFields: string[];
  reasonCodes: string[];
  reviewDurationMs: number;
  reason: string;
  correctedResult?: Record<string, unknown>;
  corrections?: Array<{
    targetType:
      | "scene"
      | "task_segment"
      | "object"
      | "tool"
      | "completion"
      | "outcome"
      | "failure_recovery"
      | "annotation";
    targetId: string;
    fieldPath: string;
    reasonCode: string;
    comment?: string;
  }>;
};

export type DiscardAnnotationRunInput = {
  expectedReviewRevision: number;
  reasonCode:
    | "version_replaced"
    | "configuration_error"
    | "operator_cancelled";
  reason: string;
};

export type BackendSubmissionPreview = {
  url: string;
  expiresAt: number;
  contentType: string;
  fileName: string;
  source?: "web_preview" | "original";
  hls?: {
    url: string;
    contentType: string;
    qualities: Array<{ quality: string; width: number; height: number }>;
  };
  thumbnail?: {
    url: string;
    expiresAt: number;
    contentType: string;
  };
  evidenceFrames?: Array<{
    segmentId: string;
    type: "black" | "freeze";
    startSeconds: number;
    endSeconds: number;
    url: string;
    expiresAt: number;
    contentType: string;
  }>;
};

export type CreateUploadResult = {
  submission: BackendSubmission;
  upload: {
    uploadId: string;
    partSizeBytes: number;
    partCount: number;
    expiresInSeconds: number;
  };
};

export type ActiveUploadResult = CreateUploadResult;

export type PresignedPart = {
  partNumber: number;
  url: string;
  expiresAt: number;
};

export interface SubmissionUploadApi {
  createUpload(input: {
    fileName: string;
    contentType: "video/mp4" | "video/quicktime";
    sizeBytes: number;
    checksumSha256: string;
    dataUsageAuthorized: boolean;
    privacyConfirmed: boolean;
    sensitiveContentConfirmed: boolean;
    taskId: string;
    taskRequirementsConfirmed: boolean;
  }): Promise<CreateUploadResult>;
  presignParts(id: string, partNumbers: number[]): Promise<PresignedPart[]>;
  verifyResumeUpload(
    id: string,
    input: { fileName: string; sizeBytes: number; checksumSha256: string },
  ): Promise<ActiveUploadResult>;
  completeUpload(
    id: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<BackendSubmission>;
  abortUpload(id: string): Promise<void>;
}

/** 任务维度统计（按任务汇总提交/质检/积分；taskId 为 null 表示未关联任务） */
export type BackendSubmissionTaskStat = {
  taskId: string | null;
  title: string;
  sceneName: string;
  taskType: "generic" | "preset" | "custom" | "none";
  total: number;
  reviewed: number;
  passed: number;
  failed: number;
  pending: number;
  passRate: number | null;
  avgScore: number | null;
  effectiveMinutes: number;
  lockedPoints: number;
};
