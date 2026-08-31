import { describe, expect, it } from "vitest";

import { containsSensitiveRisk } from "../src/ai-quality/sensitive-risk.js";
import type { NormalizedVideoQcResultV1 } from "../src/video-quality/video-quality.types.js";

function result(
  overrides: Partial<NormalizedVideoQcResultV1> = {},
): NormalizedVideoQcResultV1 {
  return {
    hardVeto: { triggered: false, reasons: [], candidates: [] },
    deductions: [],
    reviewReasons: [],
    summary: "",
    ...overrides,
  } as NormalizedVideoQcResultV1;
}

describe("sensitive risk quarantine signal", () => {
  it("uses the structured privacy reason code", () => {
    expect(
      containsSensitiveRisk(
        result({
          hardVeto: {
            triggered: true,
            reasons: ["PRIVACY_OR_SAFETY"],
            candidates: [],
          },
        }),
      ),
    ).toBe(true);
    expect(
      containsSensitiveRisk(
        result({
          hardVeto: {
            triggered: false,
            reasons: [],
            candidates: [{ reason_code: "PRIVACY_OR_SAFETY" }],
          },
        }),
      ),
    ).toBe(true);
  });

  it("does not quarantine from free-text negation or unrelated safety wording", () => {
    expect(
      containsSensitiveRisk(
        result({
          summary: "未发现隐私、敏感、账号或安全问题，内容合规。",
          reviewReasons: ["请确认采集安全"],
        }),
      ),
    ).toBe(false);
  });
});
