export type BackendPointCycleItem = {
  id: string;
  submissionId: string;
  ownerId: string;
  ownerName: string;
  teamId: string;
  teamName: string;
  fileName: string;
  taskId?: string | null;
  taskName?: string | null;
  taskSceneName?: string | null;
  taskPricePerHour?: number | null;
  finalScore: number;
  settlementRatio: number;
  effectiveDurationMs: number;
  effectiveMinutes: number;
  invalidDurationMs: number;
  pointsPerMinute: number;
  points: number;
  qualityRevision: number;
  qualityReviewedAt?: number;
  /** 是否被管理员人工调整过（最新调整生效后为 true） */
  adjusted?: boolean;
  adjustedAt?: number;
  thumbnail?: {
    url: string;
    expiresAt: number;
    contentType: "image/jpeg";
  };
};

export type BackendPointCycle = {
  id: string;
  businessDate: string;
  status: "locked" | "settled";
  submissionCount: number;
  effectiveDurationMs: number;
  effectiveMinutes: number;
  totalPoints: number;
  pointRuleVersionId?: string | null;
  pointRuleRevision?: number | null;
  createdByAccountId: string | null;
  createdByName: string;
  /** 北京时间质检通过次日 02:00 转为可提现；历史缺失时间为 null */
  settleDueAt: number | null;
  settledAt: number | null;
  createdAt: number;
  items: BackendPointCycleItem[];
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
  createdByAccountId: string | null;
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
