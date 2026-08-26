export type Role = "collector" | "leader" | "admin";
export type AccountStatus = "active" | "disabled";

export type ProcessingStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "stuck"
  | "failed";

export type ProcessingPipelineStage =
  | "uploading"
  | "queued"
  | "probing"
  | "awaiting_ai"
  | "ai_processing"
  | "completed"
  | "stuck"
  | "system_failed";

export type QualityStatus = "pending" | "passed" | "failed";
export type SettlementStatus = "unsettled" | "settled";
export type AssetStatus = "active" | "quarantined";
export type StorageStatus = "available" | "delete_pending" | "deleted";

export interface DuplicateCandidate {
  id: string;
  candidateSubmissionId: string;
  candidateFileName?: string;
  similarity: number;
  status: "candidate" | "cleared";
  createdAt: string;
}

export interface User {
  id: string;
  name: string;
  account: string;
  role: Role;
  teamId?: string;
  avatar: string;
  phone: string;
  alipayAccount?: string;
  status: AccountStatus;
  updatedAt: number;
}

export interface Team {
  id: string;
  name: string;
  leaderId: string;
  memberIds: string[];
  unitPricePerMinute: number;
}

export interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  reason: string;
  createdAt: string;
  previousScore?: number;
  nextScore?: number;
}

export interface Submission {
  id: string;
  fileName: string;
  ownerId: string;
  ownerName: string;
  teamId: string;
  teamName: string;
  scene: string;
  action: string;
  object: string;
  durationSeconds: number;
  invalidSeconds: number;
  sizeMb: number;
  resolution: string;
  thumbnailUrl?: string;
  processingStatus: ProcessingStatus;
  pipelineStage?: ProcessingPipelineStage;
  qualityStatus: QualityStatus;
  assetStatus?: AssetStatus;
  storageStatus?: StorageStatus;
  storage?: {
    status: StorageStatus;
    retainUntil?: string;
    deletedAt?: string;
    deletedByName?: string;
    deleteReason?: string;
  };
  quarantine?: {
    reason: string;
    quarantinedAt?: string;
    quarantinedByName?: string;
  };
  duplicateCandidates?: DuplicateCandidate[];
  aiScore: number;
  finalScore: number;
  qualityResult?: {
    status:
      | "queued"
      | "running"
      | "scored"
      | "hard_reject"
      | "review_pending"
      | "stuck"
      | "system_failed";
    progressStage?: string;
    progressUpdatedAt?: number;
    stuckReason?: string;
    summary: string;
    recommendations: string[];
    reviewReasons: string[];
    initialModel: string;
    reviewModel: string;
    promptRevision: number;
    promptContentSha256: string;
    settlementRatio: number | null;
    passed?: boolean | null;
    passThreshold?: number;
    reviewRevision: number;
    manualReview?: {
      reviewedByAccountId: string;
      reviewedByName: string;
      reviewedAt: string;
      reason: string;
      issues: Array<{ label: string; start: number; end: number }>;
      finalScore: number | null;
    };
    attempts: number;
    lastError?: string;
    startedAt?: string;
    completedAt?: string;
    dimensions?: Record<
      string,
      {
        coefficient: number;
        score: number;
        confidence: number;
        calculation_trace?: string;
        issues: Array<{
          reason_code: string;
          description: string;
          start_ms: number;
          end_ms: number;
          severity: string;
          confidence: number;
          evidence_timestamps_ms: number[];
        }>;
      }
    >;
    hardVeto?: {
      triggered: boolean;
      reasons: Array<string | Record<string, unknown>>;
    };
    detectedTask?: {
      task_id?: string;
      task_summary?: string;
      confidence?: number | null;
    };
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
    billingObservations?: {
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
  };
  settlementStatus: SettlementStatus;
  task?: {
    taskId: string;
    title?: string;
    revision: number | null;
    sceneName: string;
    taskType: "generic" | "preset" | "custom";
    pricePointsPerMinute: number | null;
  } | null;
  createdAt: string;
  completedAt?: string;
  tags: string[];
  issues: Array<{ label: string; start: number; end: number }>;
  audit: AuditRecord[];
}

export interface SettlementBatch {
  id: string;
  date: string;
  businessDate?: string;
  submissionCount: number;
  effectiveMinutes: number;
  points: number;
  status: "locked" | "processing";
}

export interface DeliveryPackage {
  id: string;
  name: string;
  assetCount: number;
  status: "ready";
  createdAt: string;
}

export interface RuleConfig {
  version: string;
  passThreshold: number;
  description: string;
}

export interface LabelConfig {
  id: string;
  name: string;
  type: "scene" | "action" | "object" | "issue";
  associationCount: number;
  enabled: boolean;
}

export interface OperationLog {
  id: string;
  actor: string;
  action: string;
  target: string;
  reason: string;
  createdAt: string;
}
