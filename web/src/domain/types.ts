export type Role = "collector" | "leader" | "admin";
export type AccountStatus = "active" | "disabled";

export type ProcessingStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type ProcessingPipelineStage =
  | "uploading"
  | "queued"
  | "probing"
  | "awaiting_ai"
  | "ai_processing"
  | "completed"
  | "system_failed";

export type QualityStatus = "pending" | "passed" | "failed";
export type SettlementStatus = "unsettled" | "settled";
export type WithdrawalStatus =
  | "pending"
  | "approved"
  | "paid"
  | "rejected";

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
  processingStatus: ProcessingStatus;
  pipelineStage?: ProcessingPipelineStage;
  qualityStatus: QualityStatus;
  aiScore: number;
  finalScore: number;
  qualityResult?: {
    status:
      | "queued"
      | "running"
      | "scored"
      | "hard_reject"
      | "review_pending"
      | "system_failed";
    summary: string;
    recommendations: string[];
    reviewReasons: string[];
    initialModel: string;
    reviewModel: string;
    promptRevision: number;
    promptContentSha256: string;
    settlementRatio: number | null;
    qualityRawScore?: number;
    qualityScore?: number;
    demandCoefficient?: number;
    demandStatus?: string;
    ruleVersion?: string;
    dimensions?: Record<string, {
      score?: number;
      coefficient?: number;
      confidence?: number;
      calculation_trace?: string;
    }>;
    deductions?: Array<{
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
    attempts: number;
    lastError?: string;
    startedAt?: string;
    completedAt?: string;
  };
  settlementStatus: SettlementStatus;
  createdAt: string;
  completedAt?: string;
  tags: string[];
  issues: Array<{ label: string; start: number; end: number }>;
  audit: AuditRecord[];
}

export interface Withdrawal {
  id: string;
  userId: string;
  userName: string;
  amount: number;
  status: WithdrawalStatus;
  account: string;
  createdAt: string;
}

export interface SettlementBatch {
  id: string;
  date: string;
  submissionCount: number;
  effectiveMinutes: number;
  amount: number;
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

export interface ValidationResult {
  valid: boolean;
  message: string;
}
