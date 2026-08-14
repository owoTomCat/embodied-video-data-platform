import type { QualityStatus, ValidationResult } from "./types";

export function qualityCoefficient(score: number): number {
  if (score < 40) return 0.4;
  if (score < 60) return 0.6;
  if (score < 80) return 0.8;
  return 1;
}

export function qualityStatus(score: number): QualityStatus {
  return score >= 60 ? "passed" : "failed";
}

export function effectiveDuration(
  durationSeconds: number,
  invalidSeconds: number,
): number {
  return Math.max(0, durationSeconds - invalidSeconds);
}

export function estimateIncome(
  unitPricePerMinute: number,
  durationSeconds: number,
  invalidSeconds: number,
  score: number,
  settlementRatio?: number | null,
): number {
  const coefficient =
    settlementRatio === undefined
      ? qualityCoefficient(score)
      : settlementRatio ?? 0;
  const amount =
    unitPricePerMinute *
    (effectiveDuration(durationSeconds, invalidSeconds) / 60) *
    coefficient;

  return Math.round(amount * 100) / 100;
}

export function validateWithdrawal(
  amount: number,
  availableBalance: number,
  minimumAmount: number,
): ValidationResult {
  if (amount < minimumAmount) {
    return {
      valid: false,
      message: `最低提现金额为 ¥${minimumAmount}`,
    };
  }

  if (amount > availableBalance) {
    return {
      valid: false,
      message: "提现金额不能超过可用余额",
    };
  }

  return { valid: true, message: "" };
}
