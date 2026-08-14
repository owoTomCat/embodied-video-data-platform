import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Submission } from "../domain/types";
import { QualityBreakdown } from "./QualityBreakdown";

type QualityResult = NonNullable<Submission["qualityResult"]>;

function qualityResult(ruleVersion: string): QualityResult {
  return {
    status: "scored",
    summary: "测试结果",
    recommendations: [],
    reviewReasons: [],
    initialModel: "qwen3.7-plus",
    reviewModel: "qwen3.7-flash",
    promptRevision: 2,
    promptContentSha256: "test",
    settlementRatio: 1,
    qualityRawScore: 98,
    qualityScore: 98,
    demandCoefficient: 1,
    demandStatus: "紧缺",
    ruleVersion,
    dimensions: {
      first_person_and_composition: { score: 23 },
      hand_forearm_object_integrity: { score: 25 },
      frame_and_video_quality: { score: 25 },
      task_authenticity_completeness: { score: 25 },
      task_value_uniqueness: { score: 0, coefficient: 1 },
    },
    deductions: [{
      dimension: "first_person_and_composition",
      subcriterion: "ANGLE",
      rule_id: "POV.ANGLE.C092",
      reason_code: "NON_FIRST_PERSON",
      observed_value: "视角略高于自然头胸高度",
      description: "视角略高于自然头胸高度",
      matched_level: "轻微俯拍",
      coefficient: 0.92,
      deducted_points: 2,
      points_after: 23,
      start_ms: 0,
      end_ms: 10_000,
      severity: "minor",
      confidence: 0.9,
      evidence_timestamps_ms: [5_000],
      recommendation: "降低拍摄机位",
      is_controlling: true,
    }],
    attempts: 1,
  };
}

describe("QualityBreakdown", () => {
  it("renders historical 25-point dimensions with a /25 progress bar", () => {
    render(<QualityBreakdown finalScore={98} quality={qualityResult("video_qc_v2_25point")} />);

    const meter = screen.getByRole("progressbar", { name: "第一人称与构图 23.0 / 25" });
    expect(meter).toHaveAttribute("aria-valuemax", "25");
    expect(meter).toHaveAttribute("aria-valuenow", "23");
    expect(screen.getByText("23.0 / 25")).toBeInTheDocument();
    expect(screen.queryByText("23.0 / 20")).not.toBeInTheDocument();
  });
});
