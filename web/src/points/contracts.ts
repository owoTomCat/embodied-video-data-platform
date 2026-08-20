export type BackendPointCycleItem = {
  id: string;
  submissionId: string;
  ownerId: string;
  ownerName: string;
  teamId: string;
  teamName: string;
  fileName: string;
  finalScore: number;
  settlementRatio: number;
  effectiveDurationMs: number;
  effectiveMinutes: number;
  pointsPerMinute: number;
  points: number;
  qualityRevision: number;
  qualityReviewedAt?: number;
  /** 是否被管理员人工调整过（最新调整生效后为 true） */
  adjusted?: boolean;
  adjustedAt?: number;
};

export type BackendPointCycle = {
  id: string;
  businessDate: string;
  status: "locked";
  submissionCount: number;
  effectiveDurationMs: number;
  effectiveMinutes: number;
  totalPoints: number;
  pointRuleVersionId?: string | null;
  pointRuleRevision?: number | null;
  createdByAccountId: string;
  createdByName: string;
  createdAt: number;
  items: BackendPointCycleItem[];
};

export type BackendPointCyclePreview = {
  submissionCount: number;
  effectiveDurationMs: number;
  effectiveMinutes: number;
  totalPoints: number;
  teamSummaries: Array<{
    teamId: string;
    teamName: string;
    submissionCount: number;
    effectiveDurationMs: number;
    points: number;
  }>;
};

export type BackendPointRuleCoefficientBand = {
  minScore: number;
  maxScore: number;
  ratio: number;
  label: string;
};

export type BackendPointRule = {
  id: string;
  revision: number;
  version: string;
  defaultPointsPerMinute: number;
  coefficientBands: BackendPointRuleCoefficientBand[];
  description: string;
  active: boolean;
  createdByAccountId: string;
  createdByName: string;
  createdAt: number;
};

export type CreatePointRuleInput = {
  version: string;
  defaultPointsPerMinute: number;
  coefficientBands: BackendPointRuleCoefficientBand[];
  description: string;
};

export type AdjustPointCycleItemInput = {
  reason: string;
  nextFinalScore?: number;
  nextInvalidDurationMs?: number;
};
