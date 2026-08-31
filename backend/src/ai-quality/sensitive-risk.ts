import type { NormalizedVideoQcResultV1 } from "../video-quality/video-quality.types.js";

const PRIVACY_OR_SAFETY_REASON_CODE = "PRIVACY_OR_SAFETY";

function structuredReasonCode(value: unknown): string | null {
  if (typeof value === "string") return value.trim().toUpperCase();
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const code = record.reason_code ?? record.reasonCode ?? record.code;
  return typeof code === "string" ? code.trim().toUpperCase() : null;
}

export function containsSensitiveRisk(
  result: NormalizedVideoQcResultV1,
): boolean {
  return (
    [...result.hardVeto.reasons, ...result.hardVeto.candidates].some(
      (reason) =>
        structuredReasonCode(reason) === PRIVACY_OR_SAFETY_REASON_CODE,
    ) ||
    result.deductions.some(
      (deduction) =>
        structuredReasonCode(deduction.reason_code) ===
        PRIVACY_OR_SAFETY_REASON_CODE,
    )
  );
}
