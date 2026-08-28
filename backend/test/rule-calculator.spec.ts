import { describe, expect, it } from "vitest";

import {
  coefficientForScore,
  passesQualityRule,
  pointsForRule,
  settlementRatioForScore,
} from "../src/rules/rule-calculator.js";

describe("published rule calculator", () => {
  it.each([
    [59, 0],
    [60, 0.7],
    [65, 0.7],
    [69, 0.7],
    [70, 0.85],
    [79, 0.85],
    [80, 1],
  ])("uses one coefficient definition at the %s boundary", (score, ratio) => {
    expect(coefficientForScore(score)).toBe(ratio);
    expect(
      settlementRatioForScore({ score, passThreshold: 60 }),
    ).toBe(ratio);
  });

  it("applies the locked quality threshold before coefficient bands", () => {
    expect(passesQualityRule(69, 70)).toBe(false);
    expect(
      settlementRatioForScore({ score: 69, passThreshold: 70 }),
    ).toBe(0);
    expect(passesQualityRule(70, 70)).toBe(true);
    expect(
      settlementRatioForScore({ score: 70, passThreshold: 70 }),
    ).toBe(0.85);
  });

  it("uses a locked point rule for coefficient and point calculation", () => {
    const coefficientBands = [
      { minScore: 80, maxScore: 100, ratio: 0.5, label: "新优质档" },
      { minScore: 0, maxScore: 79, ratio: 0.25, label: "新基础档" },
    ];
    const settlementRatio = settlementRatioForScore({
      score: 80,
      passThreshold: 70,
      coefficientBands,
    });
    expect(settlementRatio).toBe(0.5);
    // 单价统一为元/小时：15 元/小时 × 2 分钟(1/30 小时) × 0.5 = 0.25 元
    expect(
      pointsForRule({
        pointsPerMinute: 15,
        effectiveDurationMs: 120_000,
        settlementRatio,
      }),
    ).toBe(0.25);
  });
});
