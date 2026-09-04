import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Submission } from "../domain/types";
import { QualityReportCard } from "./QualityReportCard";

function makeSubmission(overrides: Partial<Submission>): Submission {
  return {
    id: "SUB-test",
    fileName: "test.mp4",
    ownerId: "U-COL-01",
    ownerName: "数采人员1",
    teamId: "TEAM-01",
    teamName: "一队",
    scene: "抓取",
    action: "拿取",
    object: "水杯",
    durationSeconds: 64.333,
    invalidSeconds: 0,
    sizeMb: 30,
    resolution: "854x480",
    processingStatus: "completed",
    qualityStatus: "passed",
    aiScore: 86.5,
    finalScore: 86.5,
    issues: [],
    invalidIssues: [],
    qualityResult: {
      status: "scored",
      summary: "质量通过",
      recommendations: [],
      reviewReasons: [],
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      promptRevision: 1,
      promptContentSha256: "abc",
      settlementRatio: 1,
      passThreshold: 80,
      reviewRevision: 0,
      attempts: 1,
      dimensions: {},
    },
    settlementStatus: "unsettled",
    createdAt: "2026-08-19T08:39:56Z",
    tags: [],
    audit: [],
    ...overrides,
  };
}

describe("QualityReportCard", () => {
  it("shows effective and invalid durations precisely so they add up to the total", () => {
    render(
      <QualityReportCard
        submission={makeSubmission({})}
        pointsLabel="3.22 分"
        evidenceByRange={new Map()}
      />,
    );

    // 64.333s - 0s invalid = 64s effective; must not round down to "1 分钟"
    expect(screen.getByText("1分04秒")).toBeInTheDocument();
    expect(screen.getByText("0秒")).toBeInTheDocument();
  });

  it("deducts invalid duration from effective duration", () => {
    render(
      <QualityReportCard
        submission={makeSubmission({
          durationSeconds: 120,
          invalidSeconds: 10,
        })}
        pointsLabel="5.50 分"
        evidenceByRange={new Map()}
      />,
    );

    expect(screen.getByText("1分50秒")).toBeInTheDocument();
    expect(screen.getByText("10秒")).toBeInTheDocument();
  });

  it("shows evidence-qualified shadow annotations without presenting them as QC decisions", () => {
    const submission = makeSubmission({});
    submission.qualityResult!.candidateAnnotation = {
      status: "review_required",
      schemaVersion: "ego_video_annotation_v1",
      policyVersion: "ego_annotation_evidence_policy_v1",
      promptVersion: "ego_video_annotation_prompt_v1",
      promptContentSha256: "a".repeat(64),
      model: "qwen3.7-plus",
      requestId: "request-1",
      durationMs: 100,
      frameCount: 4,
      sampling: { maxFrameGapMs: 5_000, sourceTimestampsMs: [0, 5_000] },
      labelMappings: [],
      raw: {
        video_summary: "将杯子放到桌面。",
        scene: { coarse_label: "indoor", fine_label: "kitchen", confidence: 0.9 },
      },
      effective: {
        video_summary: "将杯子放到桌面。",
        scene: { coarse_label: "indoor", fine_label: "kitchen", confidence: 0.9 },
        tasks: [
          {
            start_ms: 0,
            end_ms: 5_000,
            task_label: "放置杯子",
            task_verb: "pick_and_place",
            task_object: "杯子",
            evidence_level: "direct_visual",
            evidence_timestamps_ms: [0, 5_000],
            manipulated_objects: ["杯子"],
            tools: [],
            hand_mode: "right",
            interaction_primitives: ["grasp", "place"],
            completion: "complete",
            result_status: "success",
            confidence: 0.9,
            effective_completion: "uncertain",
            effective_result_status: "unknown",
            effective_failure_recovery: "not_assessable",
            policy_reasons: ["sparse_sampling_cannot_verify_completion"],
          },
        ],
      },
      validation: { errors: [], warnings: ["采样稀疏"] },
      reviewReasons: ["稀疏证据"],
    };

    render(
      <QualityReportCard
        submission={submission}
        pointsLabel="3.22 分"
        evidenceByRange={new Map()}
      />,
    );
    fireEvent.click(screen.getByText("更多信息（内容理解）"));

    expect(screen.getByText("结构化内容标注（影子运行）")).toBeInTheDocument();
    expect(screen.getByText("待人工确认")).toBeInTheDocument();
    expect(screen.getByText(/完成度：无法确认/)).toBeInTheDocument();
    expect(screen.getByText(/不参与当前质检与结算/)).toBeInTheDocument();
  });
});
