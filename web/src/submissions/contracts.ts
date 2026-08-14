export type BackendUploadStatus =
  | "created"
  | "uploading"
  | "uploaded"
  | "aborted";

export type BackendProcessingStatus =
  | "uploading"
  | "queued"
  | "probing"
  | "awaiting_ai"
  | "ai_processing"
  | "completed"
  | "system_failed";

export type BackendQualityStatus =
  | "queued"
  | "running"
  | "scored"
  | "hard_reject"
  | "review_pending"
  | "system_failed";

export type BackendQualityResult = {
  status: BackendQualityStatus;
  attempts: number;
  promptRevision: number;
  promptContentSha256: string;
  initialModel: string;
  reviewModel: string;
  modelRuns: Array<Record<string, unknown>>;
  finalScore: number | null;
  rawTotalScore: number | null;
  settlementRatio: number | null;
  invalidDurationMs: number | null;
  billableDurationMs: number | null;
  summary: string;
  recommendations: string[];
  deductions: Array<{
    dimension?: string;
    subcriterion?: string;
    rule_id?: string;
    reason_code?: string;
    observed_value?: string;
    description?: string;
    matched_level?: string;
    coefficient?: number;
    deducted_points?: number;
    points_after?: number;
    start_ms?: number;
    end_ms?: number;
    severity?: string;
    confidence?: number;
    evidence_timestamps_ms?: number[];
    recommendation?: string;
    is_controlling?: boolean;
  }>;
  dimensions?: Record<string, {
    score?: number;
    coefficient?: number;
    confidence?: number;
    calculation_trace?: string;
  }>;
  qualityRawScore?: number;
  qualityScore?: number;
  demandCoefficient?: number;
  demandStatus?: string;
  ruleVersion?: string;
  reviewRequired: boolean;
  reviewReasons: string[];
  lastError?: string;
  detectedTask?: {
    scene_id?: string;
    task_id?: string;
    variant_id?: string;
    task_summary?: string;
    confidence?: number;
  };
  invalidSegments: Array<{
    reasonCode: string;
    startMs: number;
    endMs: number;
    source: string;
  }>;
  startedAt?: number;
  completedAt?: number;
};

export type BackendMediaSegment = {
  id: string;
  type: "black" | "freeze";
  startSeconds: number;
  endSeconds: number;
  invalid: boolean;
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
  failureCode?: string;
  failureMessage?: string;
  isTestData: boolean;
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
  quality?: BackendQualityResult;
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
  }): Promise<CreateUploadResult>;
  presignParts(id: string, partNumbers: number[]): Promise<PresignedPart[]>;
  completeUpload(
    id: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<BackendSubmission>;
  abortUpload(id: string): Promise<void>;
}
