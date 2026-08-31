import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import type { Role } from "../../domain/types";
import { getPointRule } from "../../points/client/pointCycleApi";
import type { BackendAnnotationRun, BackendSubmission } from "../../submissions/contracts";
import {
  clearDuplicateCandidate,
  getSubmission,
  getAnnotationRun,
  getSubmissionPreview,
  listAnnotationRuns,
  reviewAnnotationRun,
  reviewSubmissionQuality,
  searchSubmissions,
} from "../../submissions/client/submissionApi";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

vi.mock("../../submissions/client/submissionApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../submissions/client/submissionApi")>();
  return {
    ...actual,
    clearDuplicateCandidate: vi.fn(),
    getSubmission: vi.fn(),
    getAnnotationRun: vi.fn(),
    getSubmissionPreview: vi.fn(),
    listAnnotationRuns: vi.fn(),
    reviewAnnotationRun: vi.fn(),
    reviewSubmissionQuality: vi.fn(),
    searchSubmissions: vi.fn(),
  };
});

vi.mock("../../points/client/pointCycleApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../points/client/pointCycleApi")>();
  return {
    ...actual,
    getPointRule: vi.fn(),
  };
});

function backendSubmission(
  overrides: Partial<BackendSubmission> = {},
): BackendSubmission {
  return {
    id: "SUB-TEAM-REVIEW",
    fileName: "team-review.mp4",
    ownerId: "U-COL-01",
    ownerName: "测试人员1",
    teamId: "TEAM-01",
    teamName: "星火一队",
    sizeBytes: "1048576",
    uploadStatus: "uploaded",
    processingStatus: "completed",
    settlementStatus: "unsettled",
    isTestData: false,
    createdAt: Date.parse("2026-08-11T01:00:00.000Z"),
    media: {
      durationSeconds: 10,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: "1048576",
    },
    segments: [],
    quality: {
      status: "scored",
      attempts: 1,
      promptRevision: 1,
      promptContentSha256: "a".repeat(64),
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      modelRuns: [],
      finalScore: 88,
      rawTotalScore: 88,
      settlementRatio: 1,
      invalidDurationMs: 0,
      billableDurationMs: 10_000,
      summary: "AI 判定质量合格",
      recommendations: [],
      deductions: [],
      reviewRequired: false,
      reviewReasons: [],
      reviewRevision: 0,
      invalidSegments: [],
    },
    audit: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(clearDuplicateCandidate).mockReset();
  vi.mocked(getSubmission).mockReset();
  vi.mocked(getAnnotationRun).mockReset();
  vi.mocked(getSubmissionPreview).mockReset();
  vi.mocked(listAnnotationRuns).mockReset();
  vi.mocked(reviewAnnotationRun).mockReset();
  vi.mocked(reviewSubmissionQuality).mockReset();
  vi.mocked(searchSubmissions).mockReset();
  vi.mocked(getSubmission).mockResolvedValue(backendSubmission());
  vi.mocked(getSubmissionPreview).mockResolvedValue({
    url: "http://minio.local/preview.mp4",
    expiresAt: Date.now() + 60_000,
    contentType: "video/mp4",
    fileName: "team-review.mp4",
  });
  vi.mocked(listAnnotationRuns).mockResolvedValue([]);
  vi.mocked(searchSubmissions).mockResolvedValue({
    submissions: [backendSubmission()],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    },
  });
  vi.mocked(getPointRule).mockResolvedValue({
    id: "PRV-REVIEW",
    revision: 1,
    version: "POINTS-REVIEW",
    defaultPointsPerMinute: 12,
    coefficientBands: [
      { minScore: 80, maxScore: 100, ratio: 1, label: "优质" },
      { minScore: 70, maxScore: 79, ratio: 0.85, label: "合格" },
      { minScore: 60, maxScore: 69, ratio: 0.7, label: "基础" },
      { minScore: 0, maxScore: 59, ratio: 0, label: "不计分" },
    ],
    description: "复核测试积分规则",
    active: true,
    createdByAccountId: "U-ADMIN-01",
    createdByName: "管理员",
    createdAt: 1,
  });
});

function renderRole(path: string, role: Role) {
  window.history.replaceState({}, "", path);
  const account = accountForRole(role);
  return render(
    <IdentityProvider currentAccount={account} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath={path} />
    </IdentityProvider>,
  );
}

function renderAdminWithSubmissions(submissions: BackendSubmission[]) {
  window.history.replaceState({}, "", "/admin/review");
  const admin = accountForRole("admin");
  vi.mocked(searchSubmissions).mockResolvedValue({
    submissions,
    pagination: {
      page: 1,
      pageSize: 20,
      total: submissions.length,
      totalPages: 1,
    },
  });
  vi.mocked(getSubmission).mockImplementation(async (id: string) => {
    return submissions.find((submission) => submission.id === id) ?? backendSubmission();
  });
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath="/admin/review" />
    </IdentityProvider>,
  );
}

describe("review workflows", () => {
  it("keeps annotation review pinned to the run-id route and never exposes QC controls", async () => {
    const path = "/admin/ai/annotation-runs/ANR-PINNED/review";
    const submission = backendSubmission({ id: "SUB-PINNED" });
    const run: BackendAnnotationRun = {
      id: "ANR-PINNED",
      submissionId: submission.id,
      trigger: "manual",
      pipelineVersion: "pipeline-v1",
      schemaVersion: "schema-v1",
      evidencePolicyVersion: "evidence-v1",
      promptVersion: "prompt-v1",
      promptContentSha256: "a".repeat(64),
      model: "qwen-vl-max",
      labelSetVersionId: null,
      labelSetRevision: null,
      executionStatus: "system_failed",
      reviewStatus: "pending",
      publicationStatus: "candidate_only",
      attemptCount: 2,
      fullModelAttempts: 2,
      schemaRepairCalls: 0,
      targetedRepairCalls: 0,
      infrastructureRetryCount: 0,
      providerCallCount: 2,
      reviewRevision: 0,
      autoEligibility: "not_evaluated",
      autoGateVersion: null,
      autoGateIssues: [],
      wouldAutoAccept: false,
      autoAcceptEnabledSnapshot: false,
      autoGateEvaluatedAt: null,
      auditStatus: "not_selected",
      auditSelectedAt: null,
      lastErrorCode: "MODEL_HTTP_500",
      lastErrorMessage: "模型调用失败",
      nextRetryAt: null,
      candidate: null,
      humanResult: null,
      review: null,
      corrections: [],
      modelCalls: [],
      queuedAt: Date.now() - 2_000,
      startedAt: Date.now() - 1_500,
      completedAt: Date.now() - 1_000,
      createdAt: Date.now() - 2_000,
      updatedAt: Date.now() - 1_000,
    };
    window.history.replaceState({}, "", path);
    vi.mocked(getAnnotationRun).mockResolvedValue(run);
    vi.mocked(getSubmission).mockResolvedValue(submission);
    const admin = accountForRole("admin");
    render(
      <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
        <PlatformApp initialPath={path} />
      </IdentityProvider>,
    );

    expect((await screen.findAllByText("ANR-PINNED")).length).toBeGreaterThan(0);
    await waitFor(() => expect(getAnnotationRun).toHaveBeenCalledWith("ANR-PINNED"));
    expect(listAnnotationRuns).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("最终评分")).not.toBeInTheDocument();
    expect(screen.queryByText("质量系数")).not.toBeInTheDocument();
    expect(screen.queryByText("敏感内容隔离，不进入普通资产和交付候选")).not.toBeInTheDocument();
    expect(reviewSubmissionQuality).not.toHaveBeenCalled();
  });

  it("uses the published point-rule coefficient for review estimates", async () => {
    vi.mocked(getPointRule).mockResolvedValue({
      id: "PRV-REVIEW-CUSTOM",
      revision: 2,
      version: "POINTS-REVIEW-CUSTOM",
      defaultPointsPerMinute: 12,
      coefficientBands: [
        { minScore: 0, maxScore: 100, ratio: 0.5, label: "统一半系数" },
      ],
      description: "复核测试自定义规则",
      active: true,
      createdByAccountId: "U-ADMIN-01",
      createdByName: "管理员",
      createdAt: 2,
    });
    const user = userEvent.setup();
    renderRole("/admin/review", "admin");

    await user.click((await screen.findAllByRole("button", { name: "复核" }))[0]);

    expect(await screen.findByText("0.50")).toBeVisible();
    expect(screen.getByText("1.00 元")).toBeVisible();
  });

  it("never estimates positive points below the locked quality threshold", async () => {
    const original = backendSubmission();
    const belowThreshold = backendSubmission({
      quality: {
        ...original.quality!,
        finalScore: 65,
        rawTotalScore: 65,
        passThreshold: 70,
        passed: false,
        settlementRatio: 0,
      },
    });
    const user = userEvent.setup();
    renderAdminWithSubmissions([belowThreshold]);

    await user.click((await screen.findAllByRole("button", { name: "复核" }))[0]);

    expect(await screen.findByText("0.00")).toBeVisible();
    expect(screen.getByText("0.00 元")).toBeVisible();
  });

  it("does not show a fallback estimate when the point rule is unavailable", async () => {
    vi.mocked(getPointRule).mockRejectedValue(new Error("规则接口不可用"));
    const user = userEvent.setup();
    renderRole("/admin/review", "admin");

    await user.click((await screen.findAllByRole("button", { name: "复核" }))[0]);

    expect((await screen.findAllByText("规则不可用")).length).toBeGreaterThanOrEqual(2);
  });

  it("requires a reason before saving a quality adjustment", async () => {
    const user = userEvent.setup();
    renderRole("/admin/review", "admin");

    await user.click((await screen.findAllByRole("button", { name: "复核" }))[0]);
    await user.clear(screen.getByLabelText("最终评分"));
    await user.type(screen.getByLabelText("最终评分"), "88");
    await user.click(screen.getByRole("button", { name: "保存调整" }));

    expect(screen.getByText("请填写调整原因")).toBeVisible();
  });

  it("keeps team quality results read-only for a leader", async () => {
    const user = userEvent.setup();
    renderRole("/team/review", "leader");

    await user.click((await screen.findAllByRole("button", { name: "查看" }))[0]);

    expect(searchSubmissions).toHaveBeenCalledWith({
      status: "unsettled",
      page: 1,
      pageSize: 20,
      includeThumbnails: true,
    });
    expect(screen.getByText("团队质检结果已连接后端")).toBeVisible();
    expect(screen.getByRole("region", { name: "最终质检结果" })).toBeVisible();
    expect(screen.queryByLabelText("最终评分")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存调整" })).not.toBeInTheDocument();
  });

  it("saves backend quality review and refreshes the visible submission", async () => {
    const user = userEvent.setup();
    const submission: BackendSubmission = {
      id: "SUB-REAL-REVIEW",
      fileName: "real-review.mp4",
      ownerId: "U-COL-01",
      ownerName: "测试人员1",
      teamId: "TEAM-01",
      teamName: "星火一队",
      sizeBytes: "1048576",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      isTestData: false,
      createdAt: Date.parse("2026-08-11T01:00:00.000Z"),
      media: {
        durationSeconds: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        codec: "h264",
        bitrate: "1000000",
        sizeBytes: "1048576",
      },
      segments: [],
      quality: {
        status: "scored",
        attempts: 1,
        promptRevision: 1,
        promptContentSha256: "a".repeat(64),
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        modelRuns: [],
        finalScore: 88,
        aiFinalScore: 88,
        rawTotalScore: 88,
        settlementRatio: 1,
        invalidDurationMs: 1_000,
        billableDurationMs: 9_000,
        summary: "AI 判定质量合格",
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        reviewRevision: 0,
        manualIssues: [],
        invalidSegments: [
          {
            reasonCode: "BLACK_SCREEN",
            startMs: 1_000,
            endMs: 2_000,
            source: "detector",
          },
        ],
      },
      audit: [],
    };
    vi.mocked(reviewSubmissionQuality).mockResolvedValue({
      ...submission,
      quality: {
        ...submission.quality!,
        finalScore: 92,
        reviewRevision: 1,
        manualIssues: [{ label: "BLACK_SCREEN", start: 1, end: 2 }],
        manualReview: {
          reviewedByAccountId: "U-ADMIN-01",
          reviewedByName: "管理员",
          reviewedAt: Date.parse("2026-08-11T02:00:00.000Z"),
          reason: "人工确认可用",
          issues: [{ label: "BLACK_SCREEN", start: 1, end: 2 }],
          finalScore: 92,
        },
      },
      audit: [
        {
          id: "AUD-REVIEW",
          actor: "管理员",
          action: "人工复核质量结果",
          reason: "人工确认可用",
          createdAt: Date.parse("2026-08-11T02:00:00.000Z"),
          previousScore: 88,
          nextScore: 92,
        },
      ],
    });
    renderAdminWithSubmissions([submission]);

    await user.click(await screen.findByRole("button", { name: "复核" }));
    await user.clear(screen.getByLabelText("最终评分"));
    await user.type(screen.getByLabelText("最终评分"), "92");
    await user.type(screen.getByLabelText("调整原因"), "人工确认可用");
    await user.click(screen.getByRole("button", { name: "保存调整" }));

    await waitFor(() =>
      expect(reviewSubmissionQuality).toHaveBeenCalledWith(
        "SUB-REAL-REVIEW",
        {
          finalScore: 92,
          reason: "人工确认可用",
          issues: [{ label: "BLACK_SCREEN", start: 1, end: 2 }],
          expectedReviewRevision: 0,
          quarantine: false,
        },
      ),
    );
  });

  it("keeps a legacy shadow annotation read-only and out of quality-review writes", async () => {
    const user = userEvent.setup();
    const submission = backendSubmission({ id: "SUB-ANNOTATION-REVIEW" });
    submission.quality!.candidateAnnotation = {
      status: "candidate",
      schemaVersion: "ego_video_annotation_v1",
      policyVersion: "ego_annotation_evidence_policy_v1",
      promptVersion: "ego_video_annotation_prompt_v1",
      promptContentSha256: "a".repeat(64),
      model: "qwen3.7-plus",
      requestId: "request-1",
      durationMs: 100,
      frameCount: 4,
      sampling: { maxFrameGapMs: 250, sourceTimestampsMs: [0, 250, 500, 750] },
      labelMappings: [],
      raw: {
        video_summary: "放置杯子",
        scene: { coarse_label: "indoor", fine_label: "kitchen", confidence: 0.9 },
      },
      effective: {
        video_summary: "放置杯子",
        scene: { coarse_label: "indoor", fine_label: "kitchen", confidence: 0.9 },
        tasks: [],
      },
      validation: { errors: [], warnings: [] },
      reviewReasons: [],
    };
    vi.mocked(reviewSubmissionQuality).mockResolvedValue(submission);
    renderAdminWithSubmissions([submission]);

    await user.click(await screen.findByRole("button", { name: "复核" }));
    expect(await screen.findByText("结构化内容标注（旧影子结果，只读）")).toBeVisible();
    expect(screen.queryByLabelText("候选内容标注结论")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("调整原因"), "逐帧检查后确认标注正确");
    await user.click(screen.getByRole("button", { name: "保存调整" }));

    await waitFor(() => expect(reviewSubmissionQuality).toHaveBeenCalled());
    const input = vi.mocked(reviewSubmissionQuality).mock.calls[0]?.[1];
    expect(input).toMatchObject({ reason: "逐帧检查后确认标注正确" });
    expect(input).not.toHaveProperty("annotationDecision");
    expect(input).not.toHaveProperty("annotationCorrection");
  });

  it("reviews an independent annotation run through structured fields", async () => {
    const user = userEvent.setup();
    const submission = backendSubmission({ id: "SUB-INDEPENDENT-ANNOTATION" });
    const run: BackendAnnotationRun = {
      id: "ANR-1",
      submissionId: submission.id,
      trigger: "initial",
      pipelineVersion: "ego_video_annotation_pipeline_v1",
      schemaVersion: "ego_video_annotation_v2",
      evidencePolicyVersion: "ego_annotation_evidence_policy_v2",
      promptVersion: "prompt-v2",
      promptContentSha256: "a".repeat(64),
      model: "qwen-vl-max",
      labelSetVersionId: "LSV-1",
      labelSetRevision: 1,
      executionStatus: "succeeded",
      reviewStatus: "pending",
      publicationStatus: "candidate_only",
      attemptCount: 1,
      fullModelAttempts: 1,
      schemaRepairCalls: 0,
      targetedRepairCalls: 0,
      infrastructureRetryCount: 0,
      providerCallCount: 1,
      reviewRevision: 0,
      autoEligibility: "manual_required",
      autoGateVersion: "annotation_auto_gate_v1",
      autoGateIssues: [],
      wouldAutoAccept: false,
      autoAcceptEnabledSnapshot: false,
      autoGateEvaluatedAt: Date.now() - 500,
      auditStatus: "not_selected",
      auditSelectedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextRetryAt: null,
      candidate: {
        status: "candidate",
        schemaVersion: "ego_video_annotation_v2",
        policyVersion: "ego_annotation_evidence_policy_v2",
        promptVersion: "prompt-v2",
        promptContentSha256: "a".repeat(64),
        model: "qwen-vl-max",
        requestId: "req-1",
        durationMs: 100,
        frameCount: 4,
        sampling: { maxFrameGapMs: 250, sourceTimestampsMs: [0, 250, 500, 750] },
        labelMappings: [],
        raw: {
          schema_version: "ego_video_annotation_v2",
          video_id: submission.id,
          video_summary: "模型摘要",
          scene: { coarse_label: "室内", fine_label: "厨房", confidence: 0.9 },
          tasks: [],
        },
        effective: {
          video_summary: "模型摘要",
          scene: { coarse_label: "室内", fine_label: "厨房", confidence: 0.9 },
          tasks: [],
        },
        validation: { errors: [], warnings: [] },
        reviewReasons: [],
      },
      humanResult: null,
      review: null,
      corrections: [],
      modelCalls: [],
      queuedAt: Date.now() - 1_000,
      startedAt: Date.now() - 900,
      completedAt: Date.now() - 500,
      createdAt: Date.now() - 1_000,
      updatedAt: Date.now() - 500,
    };
    vi.mocked(listAnnotationRuns).mockResolvedValue([run]);
    vi.mocked(reviewAnnotationRun).mockResolvedValue({
      ...run,
      reviewStatus: "accepted_corrected",
      publicationStatus: "human_verified",
      reviewRevision: 1,
    });
    renderAdminWithSubmissions([submission]);

    await user.click(await screen.findByRole("button", { name: "复核" }));
    const summary = await screen.findByLabelText("标注视频摘要");
    await user.clear(summary);
    await user.type(summary, "人工修正摘要");
    await user.type(screen.getByText("标注审核依据").closest("label")!.querySelector("textarea")!, "逐字段核验并修正摘要");
    await user.click(screen.getByRole("button", { name: "保存标注审核" }));

    await waitFor(() =>
      expect(reviewAnnotationRun).toHaveBeenCalledWith(
        "ANR-1",
        expect.objectContaining({
          disposition: "accepted_corrected",
          correctedResult: expect.objectContaining({ video_summary: "人工修正摘要" }),
          corrections: [
            expect.objectContaining({ fieldPath: "video_summary" }),
          ],
        }),
      ),
    );
    expect(screen.queryByLabelText("候选内容标注结论")).not.toBeInTheDocument();
    expect(reviewSubmissionQuality).not.toHaveBeenCalled();
  });

  it("shows a historical legacy correction as read-only history", async () => {
    const user = userEvent.setup();
    const submission = backendSubmission({ id: "SUB-ANNOTATION-REOPEN" });
    submission.quality!.candidateAnnotation = {
      status: "review_required",
      schemaVersion: "ego_video_annotation_v2",
      policyVersion: "ego_annotation_evidence_policy_v2",
      promptVersion: "ego_video_annotation_prompt_v2",
      promptContentSha256: "a".repeat(64),
      model: "qwen3.7-plus",
      requestId: "request-3",
      durationMs: 100,
      frameCount: 4,
      sampling: { maxFrameGapMs: 250, sourceTimestampsMs: [0, 250, 500, 750] },
      labelMappings: [],
      raw: {
        schema_version: "ego_video_annotation_v2",
        video_id: submission.id,
        video_summary: "模型原始结果",
        scene: { coarse_label: "室内", fine_label: "厨房", confidence: 0.9 },
      },
      effective: {
        video_summary: "模型原始结果",
        scene: { coarse_label: "室内", fine_label: "厨房", confidence: 0.9 },
        tasks: [],
      },
      validation: { errors: [], warnings: [] },
      reviewReasons: ["需要人工修正"],
    };
    submission.quality!.annotationReview = {
      decision: "accepted",
      reason: "人工已修正",
      reviewedByAccountId: "U-ADMIN",
      reviewedByName: "管理员",
      reviewedAt: Date.now(),
      candidateSchemaVersion: "ego_video_annotation_v2",
      candidatePolicyVersion: "ego_annotation_evidence_policy_v2",
      candidatePromptVersion: "ego_video_annotation_prompt_v2",
      candidatePromptContentSha256: "a".repeat(64),
      correctedAnnotation: {
        source: "human_correction",
        schemaVersion: "ego_video_annotation_v2",
        policyVersion: "ego_annotation_evidence_policy_v2",
        raw: {
          schema_version: "ego_video_annotation_v2",
          video_id: submission.id,
          video_summary: "人工修正结果",
        },
        effective: { video_id: submission.id, video_summary: "人工修正结果" },
        labelMappings: [],
        validation: { errors: [], warnings: [] },
      },
    };
    renderAdminWithSubmissions([submission]);

    await user.click(await screen.findByRole("button", { name: "复核" }));

    expect(await screen.findByText("结构化内容标注（旧影子结果，只读）")).toBeVisible();
    expect(screen.getByText(/上次标注复核：已修正并接受 · 管理员/u)).toBeVisible();
    expect(screen.queryByLabelText("候选内容标注结论")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("修正后的结构化标注 JSON")).not.toBeInTheDocument();
  });

  it("clears a near-duplicate candidate from the review drawer", async () => {
    const user = userEvent.setup();
    const submission: BackendSubmission = {
      id: "SUB-DUP-REVIEW",
      fileName: "dup-review.mp4",
      ownerId: "U-COL-01",
      ownerName: "测试人员1",
      teamId: "TEAM-01",
      teamName: "星火一队",
      sizeBytes: "1048576",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      settlementStatus: "unsettled",
      isTestData: false,
      duplicateCandidates: [
        {
          id: "DUP-REVIEW-01",
          candidateSubmissionId: "SUB-OLD",
          candidateFileName: "old-review.mp4",
          similarity: 0.96,
          status: "candidate",
          createdAt: Date.parse("2026-08-11T01:00:00.000Z"),
        },
      ],
      createdAt: Date.parse("2026-08-11T01:00:00.000Z"),
      media: {
        durationSeconds: 10,
        width: 1920,
        height: 1080,
        frameRate: 30,
        codec: "h264",
        bitrate: "1000000",
        sizeBytes: "1048576",
      },
      segments: [],
      quality: {
        status: "scored",
        attempts: 1,
        promptRevision: 1,
        promptContentSha256: "a".repeat(64),
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        modelRuns: [],
        finalScore: 88,
        rawTotalScore: 88,
        settlementRatio: 1,
        invalidDurationMs: 0,
        billableDurationMs: 10_000,
        summary: "AI 判定质量合格",
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        reviewRevision: 0,
        invalidSegments: [],
      },
      audit: [],
    };
    vi.mocked(clearDuplicateCandidate).mockResolvedValue({
      ...submission,
      duplicateCandidates: [],
    });
    renderAdminWithSubmissions([submission]);

    await user.click(await screen.findByRole("button", { name: "复核" }));
    expect(screen.getByText("近似重复候选")).toBeVisible();
    await user.type(screen.getByLabelText("调整原因"), "不是同一任务");
    await user.click(screen.getByRole("button", { name: "解除重复标记" }));

    await waitFor(() =>
      expect(clearDuplicateCandidate).toHaveBeenCalledWith(
        "SUB-DUP-REVIEW",
        "DUP-REVIEW-01",
        { reason: "不是同一任务" },
      ),
    );
  });

  it("routes the retired withdrawal page back to the admin overview", () => {
    renderRole("/admin/withdrawals", "admin");

    expect(screen.getByRole("heading", { name: "运营总览" })).toBeVisible();
    expect(screen.queryByText("提现审核")).not.toBeInTheDocument();
  });
});
