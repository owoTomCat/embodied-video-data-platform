export type QualityRuleSnapshot = {
  id: string;
  revision: number;
  version: string;
  passThreshold: number;
  description: string;
};

export type LabelSnapshotItem = {
  id: string;
  name: string;
  type: "scene" | "action" | "object" | "issue";
  enabled: boolean;
};

export type LabelSetSnapshot = {
  id: string;
  revision: number;
  version: string;
  labels: LabelSnapshotItem[];
};

export type CoefficientBand = {
  minScore: number;
  maxScore: number;
  ratio: number;
  label: string;
};

export type PointRuleSnapshot = {
  id: string;
  revision: number;
  version: string;
  defaultPointsPerMinute: number;
  coefficientBands: CoefficientBand[];
  description: string;
};

export const DEFAULT_COEFFICIENT_BANDS: CoefficientBand[] = [
  { minScore: 80, maxScore: 100, ratio: 1, label: "优质" },
  { minScore: 70, maxScore: 79, ratio: 0.85, label: "合格" },
  { minScore: 60, maxScore: 69, ratio: 0.7, label: "基础" },
  { minScore: 0, maxScore: 59, ratio: 0, label: "不计分" },
];

export function qualityRuleSnapshot(input: QualityRuleSnapshot): QualityRuleSnapshot {
  return {
    id: input.id,
    revision: input.revision,
    version: input.version,
    passThreshold: input.passThreshold,
    description: input.description,
  };
}

export function labelSetSnapshot(input: LabelSetSnapshot): LabelSetSnapshot {
  return {
    id: input.id,
    revision: input.revision,
    version: input.version,
    labels: input.labels.map((label) => ({
      id: label.id,
      name: label.name,
      type: label.type,
      enabled: label.enabled,
    })),
  };
}

export function pointRuleSnapshot(input: PointRuleSnapshot): PointRuleSnapshot {
  return {
    id: input.id,
    revision: input.revision,
    version: input.version,
    defaultPointsPerMinute: input.defaultPointsPerMinute,
    coefficientBands: input.coefficientBands.map((band) => ({ ...band })),
    description: input.description,
  };
}

export function passesQualityRule(
  score: number,
  passThreshold: number,
): boolean {
  return (
    Number.isFinite(score) &&
    Number.isFinite(passThreshold) &&
    score >= passThreshold
  );
}

export function coefficientForScore(
  score: number,
  bands: readonly CoefficientBand[] = DEFAULT_COEFFICIENT_BANDS,
): number {
  if (!Number.isFinite(score)) return 0;
  const band = [...bands]
    .sort((left, right) => right.minScore - left.minScore)
    .find(
      (candidate) =>
        score >= candidate.minScore &&
        (candidate.maxScore >= 100 || score < candidate.maxScore + 1),
    );
  return band && Number.isFinite(band.ratio) ? band.ratio : 0;
}

export function settlementRatioForScore(input: {
  score: number;
  passThreshold: number;
  coefficientBands?: readonly CoefficientBand[];
}): number {
  if (!passesQualityRule(input.score, input.passThreshold)) return 0;
  return coefficientForScore(input.score, input.coefficientBands);
}

/**
 * 结算金额 = 单价（元/小时） × 有效时长（小时） × 质量系数。
 * 全系统单价统一为「元/小时」：pointsPerMinute 字段名保留（历史命名），
 * 实际语义为每小时单价；时长 ms 除以 3_600_000 换算为小时。
 */
export function pointsForRule(input: {
  pointsPerMinute: number;
  effectiveDurationMs: number;
  settlementRatio: number;
}): number {
  if (
    !Number.isFinite(input.pointsPerMinute) ||
    !Number.isFinite(input.effectiveDurationMs) ||
    !Number.isFinite(input.settlementRatio)
  ) {
    return 0;
  }
  return (
    Math.round(
      input.pointsPerMinute *
        (Math.max(0, input.effectiveDurationMs) / 3_600_000) *
        input.settlementRatio *
        100,
    ) / 100
  );
}
