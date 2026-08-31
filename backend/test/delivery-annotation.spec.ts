import { describe, expect, it } from "vitest";

import {
  acceptedAnnotationRun,
} from "../src/delivery/delivery-annotation.js";
import type { AnnotationReviewEntity } from "../src/database/entities/annotation-review.entity.js";
import type { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";

describe("acceptedAnnotationRun", () => {
  function verifiedRun(): {
    run: AnnotationRunEntity;
    review: AnnotationReviewEntity;
  } {
    const candidate = {
      status: "candidate",
      schemaVersion: "ego_video_annotation_v2",
      policyVersion: "ego_annotation_evidence_policy_v2",
      promptVersion: "prompt-v2",
      promptContentSha256: "a".repeat(64),
      model: "qwen-vl-max",
      effective: { video_id: "SUB-1", tasks: [] },
      labelMappings: [],
      validation: { errors: [], warnings: [] },
    };
    return {
      run: {
        id: "ANR-1",
        executionStatus: "succeeded",
        reviewStatus: "accepted_unchanged",
        publicationStatus: "human_verified",
        reviewRevision: 1,
        schemaVersion: "ego_video_annotation_v2",
        evidencePolicyVersion: "ego_annotation_evidence_policy_v2",
        promptVersion: "prompt-v2",
        promptContentSha256: "a".repeat(64),
        systemPromptSnapshot: "locked historical system prompt",
        outputExampleSnapshot: { video_id: "example" },
        model: "qwen-vl-max",
        normalizedResult: candidate,
        humanResult: null,
      } as unknown as AnnotationRunEntity,
      review: {
        annotationRunId: "ANR-1",
        revision: 1,
        disposition: "accepted_unchanged",
        reviewerAccountId: "U-ADMIN",
        reviewerName: "审核员",
        reason: "逐字段核验",
        correctedResult: null,
        createdAt: new Date("2026-08-27T12:00:00Z"),
      } as unknown as AnnotationReviewEntity,
    };
  }

  it("publishes only the independently human-verified revision", () => {
    const { run, review } = verifiedRun();

    expect(acceptedAnnotationRun(run, review)).toMatchObject({
      schemaVersion: "ego_video_annotation_v2",
      source: "candidate",
      review: { reviewedByAccountId: "U-ADMIN", reason: "逐字段核验" },
    });
  });

  it("rejects stale or candidate-only runs at the delivery boundary", () => {
    const { run, review } = verifiedRun();
    review.revision = 0;
    expect(acceptedAnnotationRun(run, review)).toBeNull();
    review.revision = 1;
    run.publicationStatus = "candidate_only";
    expect(acceptedAnnotationRun(run, review)).toBeNull();
  });

  it("uses the run snapshot instead of the current online prompt or schema", () => {
    const { run, review } = verifiedRun();
    run.schemaVersion = "historical_schema_v7";
    run.evidencePolicyVersion = "historical_evidence_v3";
    (run.normalizedResult as Record<string, unknown>).schemaVersion = "historical_schema_v7";
    (run.normalizedResult as Record<string, unknown>).policyVersion = "historical_evidence_v3";

    expect(acceptedAnnotationRun(run, review)).toMatchObject({
      schemaVersion: "historical_schema_v7",
      policyVersion: "historical_evidence_v3",
    });
  });

  it("rejects a review attached to another run", () => {
    const { run, review } = verifiedRun();
    review.annotationRunId = "ANR-OTHER";
    expect(acceptedAnnotationRun(run, review)).toBeNull();
  });

  it("rejects a candidate that no longer matches its locked run snapshot", () => {
    const { run, review } = verifiedRun();
    (run.normalizedResult as Record<string, unknown>).promptContentSha256 = "b".repeat(64);
    expect(acceptedAnnotationRun(run, review)).toBeNull();
  });

  it("accepts only an automatic publication with a complete non-blocking gate snapshot", () => {
    const { run } = verifiedRun();
    run.evidencePolicyVersion = "ego_annotation_evidence_policy_v3";
    (run.normalizedResult as Record<string, unknown>).policyVersion =
      "ego_annotation_evidence_policy_v3";
    run.reviewStatus = "not_required";
    run.publicationStatus = "auto_accepted";
    run.reviewRevision = 0;
    run.autoEligibility = "eligible";
    run.autoGateVersion = "annotation_auto_gate_v1";
    run.autoGateIssues = [];
    run.wouldAutoAccept = true;
    run.autoAcceptEnabledSnapshot = true;
    run.autoGateEvaluatedAt = new Date("2026-08-28T12:00:00Z");
    run.auditStatus = "pending";

    expect(acceptedAnnotationRun(run, null)).toMatchObject({
      source: "candidate",
      acceptance: {
        mode: "automatic",
        acceptedAt: Date.parse("2026-08-28T12:00:00Z"),
        autoGateVersion: "annotation_auto_gate_v1",
      },
      review: null,
    });

    run.autoGateIssues = [{
      code: "NO_TASK_DETECTED",
      level: "manual_review",
      fieldPath: null,
      taskIndex: null,
      message: "视频未识别到任务",
      evidenceTimestampsMs: [],
      resolution: "not_applicable",
    }];
    expect(acceptedAnnotationRun(run, null)).toBeNull();
  });
});
