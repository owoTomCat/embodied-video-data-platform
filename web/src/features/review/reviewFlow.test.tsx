import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import type { Role } from "../../domain/types";
import { getPointRule } from "../../points/client/pointCycleApi";
import type { BackendSubmission } from "../../submissions/contracts";
import {
  clearDuplicateCandidate,
  getSubmission,
  getSubmissionPreview,
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
    getSubmissionPreview: vi.fn(),
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
  vi.mocked(getSubmissionPreview).mockReset();
  vi.mocked(reviewSubmissionQuality).mockReset();
  vi.mocked(searchSubmissions).mockReset();
  vi.mocked(getSubmission).mockResolvedValue(backendSubmission());
  vi.mocked(getSubmissionPreview).mockResolvedValue({
    url: "http://minio.local/preview.mp4",
    expiresAt: Date.now() + 60_000,
    contentType: "video/mp4",
    fileName: "team-review.mp4",
  });
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
