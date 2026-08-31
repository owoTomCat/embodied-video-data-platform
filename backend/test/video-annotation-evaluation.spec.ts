import { describe, expect, it } from "vitest";

import {
  evaluateVideoAnnotationDataset,
  type EvaluableVideoAnnotation,
  type VideoAnnotationReference,
} from "../src/video-annotation/video-annotation-evaluation.js";

const reference: VideoAnnotationReference = {
  schema_version: "ego_video_annotation_reference_v1",
  video_id: "video-1",
  tasks: [
    {
      start_ms: 0,
      end_ms: 51_120,
      task_verb: "rub_or_wipe",
      execution_pattern: "continuous_operation",
      completion: "uncertain",
      result_status: "unknown",
      failure_recovery: "not_assessable",
      complexity_signals: ["bimanual_coordination", "tool_use", "multi_step"],
    },
  ],
  coverage: [0, 4_647, 9_295, 13_942, 18_589, 23_236, 27_884, 32_531, 37_178, 41_825, 46_473, 51_120].map(
    (timestamp_ms) => ({ timestamp_ms, segment_type: "task" as const }),
  ),
};

function candidate(endMs: number, coveredTaskFrames: number): EvaluableVideoAnnotation {
  return {
    videoId: "video-1",
    tasks: [
      {
        start_ms: 0,
        end_ms: endMs,
        task_verb: "rub_or_wipe",
        execution_pattern: "continuous_operation",
        completion: "uncertain",
        result_status: "unknown",
        failure_recovery: "not_assessable",
        complexity_signals: [
          "bimanual_coordination",
          "tool_use",
          "multi_step",
        ],
      },
    ],
    coverage: reference.coverage.map((item, index) => ({
      timestamp_ms: item.timestamp_ms,
      segment_type: index < coveredTaskFrames ? "task" : "transition",
    })),
  };
}

describe("video annotation evaluation", () => {
  it("quantifies the observed coverage regression instead of hiding it in task count", () => {
    const oldInput = evaluateVideoAnnotationDataset({
      pairs: [{ candidate: candidate(18_589, 5), reference }],
    });
    const frameGrounded = evaluateVideoAnnotationDataset({
      pairs: [{ candidate: candidate(51_120, 12), reference }],
    });

    expect(oldInput.taskDetection.f1).toBe(1);
    expect(oldInput.meanTaskTemporalIou).toBeCloseTo(18_589 / 51_120);
    expect(oldInput.taskCoverage.recall).toBeCloseTo(5 / 12);
    expect(frameGrounded).toMatchObject({
      meanTaskTemporalIou: 1,
      taskVerbAccuracy: 1,
      executionPatternAccuracy: 1,
      completionAccuracy: 1,
      resultStatusAccuracy: 1,
      failureRecoveryAccuracy: 1,
      complexitySignalF1: 1,
      taskCoverage: { precision: 1, recall: 1, f1: 1 },
    });
  });

  it("counts unmatched tasks as false positives and false negatives", () => {
    const result = evaluateVideoAnnotationDataset({
      pairs: [
        {
          candidate: {
            videoId: "video-1",
            tasks: [
              {
                start_ms: 60_000,
                end_ms: 70_000,
                task_verb: "open",
              },
            ],
            coverage: reference.coverage.map((item) => ({
              ...item,
              segment_type: "transition" as const,
            })),
          },
          reference,
        },
      ],
    });

    expect(result.taskDetection).toMatchObject({
      truePositive: 0,
      falsePositive: 1,
      falseNegative: 1,
      precision: 0,
      recall: 0,
      f1: 0,
    });
  });
});
