import { describe, expect, it } from "vitest";

import {
  alignTaskComplianceToRequirements,
  applyServerTaskCompliance,
  normalizeTaskCompliance,
  serverComplianceRatio,
} from "../src/video-quality/video-qc-rule-engine.js";
import type { NormalizedVideoQcResultV1 } from "../src/video-quality/video-quality.types.js";
import { parseTaskRequirementsSnapshot } from "../src/ai-quality/evaluation-context.js";

function baseNormalized(overrides: Partial<NormalizedVideoQcResultV1> = {}): NormalizedVideoQcResultV1 {
  const score = (coefficient: number) => 20 * coefficient;
  return {
    schemaVersion: "video_qc_v2",
    ruleVersion: "video_qc_v2",
    promptVersion: "qwen_video_qc_prompt_v4",
    videoId: "SUB-1",
    evaluationStatus: "scored",
    dimensions: {
      first_person_and_composition: { coefficient: 0.9, score: score(0.9), confidence: 0.95, calculation_trace: "", segments: [], issues: [], metrics: {} },
      hand_forearm_object_integrity: { coefficient: 0.9, score: score(0.9), confidence: 0.95, calculation_trace: "", segments: [], issues: [], metrics: {} },
      frame_and_video_quality: { coefficient: 0.9, score: score(0.9), confidence: 0.95, calculation_trace: "", segments: [], issues: [], metrics: {} },
      task_authenticity_completeness: { coefficient: 0.9, score: score(0.9), confidence: 0.9, calculation_trace: "model", segments: [], issues: [], metrics: {} },
      task_value_uniqueness: { coefficient: 1, score: 20, confidence: 1, calculation_trace: "", segments: [], issues: [], metrics: {} },
    },
    rawTotalScore: 90,
    finalScore: 90,
    settlementRatio: 1,
    analysisDurationMs: 10_000,
    invalidDurationMs: 0,
    billableDurationMs: 10_000,
    invalidSegments: [],
    hardVeto: { triggered: false, reasons: [], candidates: [] },
    detectedTask: { task_id: "SUB-1", task_summary: "", confidence: null },
    taskCompliance: null,
    deductions: [],
    recommendations: [],
    summary: "",
    reviewRequired: false,
    reviewReasons: [],
    missingInputs: [],
    validation: { warnings: [], errors: [] },
    rawModelResult: {} as NormalizedVideoQcResultV1["rawModelResult"],
    modelRuns: [],
    media: {} as NormalizedVideoQcResultV1["media"],
    ...overrides,
  };
}

describe("serverComplianceRatio", () => {
  it("computes met=1 partial=0.5 unmet=0 averages", () => {
    const items = [
      { requirement: "a", type: "hard" as const, result: "met" as const, confidence: 0.9, evidence_timestamps_ms: [] },
      { requirement: "b", type: "hard" as const, result: "partial" as const, confidence: 0.8, evidence_timestamps_ms: [1] },
      { requirement: "c", type: "soft" as const, result: "unmet" as const, confidence: 0.9, evidence_timestamps_ms: [2] },
    ];
    expect(serverComplianceRatio(items)).toBeCloseTo(0.5);
  });

  it("returns 0 for an empty item list", () => {
    expect(serverComplianceRatio([])).toBe(0);
  });
});

describe("normalizeTaskCompliance", () => {
  it("shapes a well-formed model output and recomputes the ratio", () => {
    const compliance = normalizeTaskCompliance(
      {
        scene_match: { matched: true, confidence: 0.95 },
        items: [
          { requirement: "必须出现双手", type: "hard", result: "met", confidence: 0.96, evidence_timestamps_ms: [] },
          { requirement: "光线充足", type: "soft", result: "partial", confidence: 0.8, evidence_timestamps_ms: [100] },
        ],
        compliance_ratio: 0.6,
        review_required: false,
      },
      [],
    );
    expect(compliance).not.toBeNull();
    expect(compliance!.items).toHaveLength(2);
    expect(compliance!.compliance_ratio).toBeCloseTo(0.75);
  });

  it("drops malformed items and warns on ratio mismatch", () => {
    const warnings: string[] = [];
    const malformedItems: unknown[] = [
      { requirement: "", type: "hard", result: "met", confidence: 0.9, evidence_timestamps_ms: [] },
      "not-an-object",
      { requirement: "有效", type: "maybe", result: "weird", confidence: 2, evidence_timestamps_ms: [-5, 1_000_000] },
    ];
    const compliance = normalizeTaskCompliance(
      {
        scene_match: { matched: true, confidence: 0.5 },
        items: malformedItems,
        compliance_ratio: 0.99,
        review_required: true,
      } as never,
      warnings,
    );
    expect(compliance!.items).toHaveLength(1);
    expect(compliance!.items[0]!.type).toBe("soft");
    expect(compliance!.items[0]!.result).toBe("unmet");
    expect(compliance!.items[0]!.confidence).toBe(1);
    expect(compliance!.review_required).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
  });
});

describe("applyServerTaskCompliance", () => {
  it("overrides D4 with the server ratio and recomputes the total", () => {
    const compliance = normalizeTaskCompliance(
      {
        scene_match: { matched: true, confidence: 0.95 },
        items: [
          { requirement: "第一人称", type: "hard", result: "met", confidence: 0.95, evidence_timestamps_ms: [] },
          { requirement: "双手可见", type: "hard", result: "met", confidence: 0.95, evidence_timestamps_ms: [] },
        ],
        compliance_ratio: null,
        review_required: false,
      },
      [],
    )!;
    const applied = applyServerTaskCompliance(baseNormalized(), compliance);
    // D4 = 20 × 1.0（全部 met，场景匹配因子 1）
    expect(applied.dimensions.task_authenticity_completeness.coefficient).toBe(1);
    expect(applied.dimensions.task_authenticity_completeness.score).toBe(20);
    // 总分 = 18 + 18 + 18 + 20 + 20 = 94
    expect(applied.finalScore).toBe(94);
    expect(applied.evaluationStatus).toBe("scored");
    expect(applied.reviewRequired).toBe(false);
  });

  it("enters review when a hard requirement is unmet", () => {
    const compliance = normalizeTaskCompliance(
      {
        scene_match: { matched: true, confidence: 0.9 },
        items: [
          { requirement: "必须出现双手操作", type: "hard", result: "unmet", confidence: 0.9, evidence_timestamps_ms: [500] },
          { requirement: "光线充足", type: "soft", result: "met", confidence: 0.9, evidence_timestamps_ms: [] },
        ],
        compliance_ratio: null,
        review_required: false,
      },
      [],
    )!;
    const applied = applyServerTaskCompliance(baseNormalized(), compliance);
    expect(applied.evaluationStatus).toBe("review_pending");
    expect(applied.reviewRequired).toBe(true);
    expect(
      applied.reviewReasons.some((reason) => reason.includes("硬性要求未满足")),
    ).toBe(true);
    // D4 = 20 × 0.5 × 1（1 条 met 1 条 unmet）
    expect(applied.dimensions.task_authenticity_completeness.coefficient).toBe(0.5);
    expect(applied.finalScore).toBe(84);
  });

  it("enters review on scene mismatch and halves the D4 coefficient", () => {
    const compliance = normalizeTaskCompliance(
      {
        scene_match: { matched: false, confidence: 0.95, note: "内容与任务场景不符" },
        items: [
          { requirement: "第一人称", type: "hard", result: "met", confidence: 0.95, evidence_timestamps_ms: [] },
        ],
        compliance_ratio: null,
        review_required: false,
      },
      [],
    )!;
    const applied = applyServerTaskCompliance(baseNormalized(), compliance);
    expect(applied.evaluationStatus).toBe("review_pending");
    expect(
      applied.reviewReasons.some((reason) => reason.includes("场景不匹配")),
    ).toBe(true);
    expect(applied.dimensions.task_authenticity_completeness.coefficient).toBe(0.5);
  });

  it("keeps evidence-incomplete compliance out of automatic settlement", () => {
    const compliance = normalizeTaskCompliance(
      {
        scene_match: { matched: true, confidence: 0.95 },
        items: [
          {
            requirement: "建议保持操作台整洁",
            type: "soft",
            result: "met",
            confidence: 0.8,
            evidence_timestamps_ms: [],
          },
        ],
        compliance_ratio: null,
        review_required: true,
      },
      [],
    )!;

    const applied = applyServerTaskCompliance(baseNormalized(), compliance);
    expect(applied.evaluationStatus).toBe("review_pending");
    expect(applied.reviewRequired).toBe(true);
    expect(applied.reviewReasons.join(" ")).toContain("证据不足");
  });

  it("keeps hard_reject status when already rejected", () => {
    const compliance = normalizeTaskCompliance(
      {
        scene_match: { matched: true, confidence: 0.9 },
        items: [
          { requirement: "x", type: "hard", result: "unmet", confidence: 0.9, evidence_timestamps_ms: [1] },
        ],
        compliance_ratio: null,
        review_required: false,
      },
      [],
    )!;
    const applied = applyServerTaskCompliance(
      baseNormalized({ evaluationStatus: "hard_reject", settlementRatio: 0 }),
      compliance,
    );
    expect(applied.evaluationStatus).toBe("hard_reject");
    expect(applied.settlementRatio).toBe(0);
  });
});

describe("alignTaskComplianceToRequirements", () => {
  it("uses the locked requirement order and authoritative hard/soft types", () => {
    const warnings: string[] = [];
    const aligned = alignTaskComplianceToRequirements(
      normalizeTaskCompliance(
        {
          scene_match: { matched: true, confidence: 0.9 },
          items: [
            {
              requirement: "光线充足",
              type: "hard",
              result: "met",
              confidence: 0.9,
              evidence_timestamps_ms: [1_000],
            },
            {
              requirement: "必须出现双手",
              type: "soft",
              result: "partial",
              confidence: 0.8,
              evidence_timestamps_ms: [500],
            },
          ],
          compliance_ratio: null,
          review_required: false,
        },
        [],
      ),
      [
        { type: "hard", content: "必须出现双手" },
        { type: "soft", content: "光线充足" },
      ],
      warnings,
    );

    expect(aligned.items.map((item) => [item.requirement, item.type])).toEqual([
      ["必须出现双手", "hard"],
      ["光线充足", "soft"],
    ]);
    expect(aligned.compliance_ratio).toBe(0.75);
    expect(warnings.join(" ")).toContain("服务端快照覆盖");
  });

  it("makes missing and unexpected model items non-settleable", () => {
    const warnings: string[] = [];
    const aligned = alignTaskComplianceToRequirements(
      normalizeTaskCompliance(
        {
          scene_match: { matched: true, confidence: 0.9 },
          items: [
            {
              requirement: "模型自行增加的要求",
              type: "soft",
              result: "met",
              confidence: 0.9,
              evidence_timestamps_ms: [500],
            },
          ],
          compliance_ratio: null,
          review_required: false,
        },
        [],
      ),
      [{ type: "hard", content: "必须出现双手" }],
      warnings,
    );

    expect(aligned.items).toEqual([
      expect.objectContaining({
        requirement: "必须出现双手",
        type: "hard",
        result: "unmet",
        confidence: 0,
      }),
    ]);
    expect(aligned.review_required).toBe(true);
    expect(warnings.join(" ")).toContain("缺少锁定要求");
    expect(warnings.join(" ")).toContain("已忽略");
  });

  it("requires review when the model omits task compliance entirely", () => {
    const warnings: string[] = [];
    const aligned = alignTaskComplianceToRequirements(
      null,
      [{ type: "hard", content: "第一人称拍摄" }],
      warnings,
    );

    expect(aligned.scene_match.matched).toBe(false);
    expect(aligned.review_required).toBe(true);
    expect(aligned.compliance_ratio).toBe(0);
    expect(warnings).toContain("模型未返回任务符合度区块");
  });
});

describe("parseTaskRequirementsSnapshot", () => {
  it("parses a valid snapshot", () => {
    const parsed = parseTaskRequirementsSnapshot({
      scene_name: "家庭厨房",
      scene_description: "厨房场景",
      requirements: [
        { type: "hard", content: "必须出现双手" },
        { type: "soft", content: "光线充足", rationale: "影响清晰度" },
      ],
      quality_notes: ["注意反光"],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.sceneName).toBe("家庭厨房");
    expect(parsed!.snapshot.requirements).toHaveLength(2);
    expect(parsed!.snapshot.requirements[1]!.rationale).toBe("影响清晰度");
    expect(parsed!.snapshot.quality_notes).toEqual(["注意反光"]);
  });

  it("returns null for missing scene or empty requirements", () => {
    expect(
      parseTaskRequirementsSnapshot({ scene_name: "", requirements: [] }),
    ).toBeNull();
    expect(
      parseTaskRequirementsSnapshot({
        scene_name: "厨房",
        requirements: [{ type: "hard", content: "" }],
      }),
    ).toBeNull();
    expect(parseTaskRequirementsSnapshot("junk")).toBeNull();
    expect(parseTaskRequirementsSnapshot(null)).toBeNull();
  });
});
