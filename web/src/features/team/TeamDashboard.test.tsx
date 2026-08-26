import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityProvider } from "../../auth/client/IdentityContext";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import type { BackendQualityStatus, BackendSubmission } from "../../submissions/contracts";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { TeamDashboard } from "./TeamDashboard";

vi.mock("../../submissions/client/submissionApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../submissions/client/submissionApi")>();
  return {
    ...actual,
    loadAllSubmissions: vi.fn(),
  };
});

const loadAllSubmissionsMock = vi.mocked(loadAllSubmissions);

const team = {
  id: "TEAM-01",
  name: "星火一队",
  status: "active" as const,
  unitPricePerMinute: 12,
  createdAt: 1_722_708_000_000,
  updatedAt: 1_722_708_000_000,
};

function backendSubmission(input: {
  id: string;
  fileName: string;
  createdAt: number;
  durationSeconds: number;
  processingStatus?: BackendSubmission["processingStatus"];
  qualityStatus?: BackendQualityStatus;
  finalScore?: number | null;
  manualReviewed?: boolean;
}): BackendSubmission {
  return {
    id: input.id,
    fileName: input.fileName,
    ownerId: "U-COL-01",
    ownerName: "测试人员1",
    teamId: "TEAM-01",
    teamName: "星火一队",
    sizeBytes: "1048576",
    uploadStatus: "uploaded",
    processingStatus: input.processingStatus ?? "completed",
    settlementStatus: "unsettled",
    isTestData: false,
    createdAt: input.createdAt,
    media: {
      durationSeconds: input.durationSeconds,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      bitrate: "1000",
      sizeBytes: "1048576",
    },
    segments: [],
    quality:
      input.qualityStatus === undefined
        ? undefined
        : {
            status: input.qualityStatus,
            attempts: 1,
            promptRevision: 1,
            promptContentSha256: "a".repeat(64),
            initialModel: "qwen3.7-plus",
            reviewModel: "qwen3.7-flash",
            modelRuns: [],
            finalScore: input.finalScore ?? null,
            rawTotalScore: input.finalScore ?? null,
            settlementRatio: input.finalScore === null ? null : 1,
            invalidDurationMs: 0,
            billableDurationMs: input.durationSeconds * 1_000,
            summary: "测试结果",
            recommendations: [],
            deductions: [],
            reviewRequired: input.qualityStatus === "review_pending",
            reviewReasons:
              input.qualityStatus === "review_pending" ? ["需要人工关注"] : [],
            reviewRevision: 0,
            manualReview: input.manualReviewed
              ? {
                  reviewedByAccountId: "U-LEAD-01",
                  reviewedByName: "测试组长",
                  reviewedAt: input.createdAt + 1_000,
                  reason: "已完成复核",
                  issues: [],
                  finalScore: input.finalScore ?? null,
                }
              : undefined,
            invalidSegments: [],
          },
  };
}

function renderPage() {
  const leader = accountForRole("leader");
  return render(
    <IdentityProvider
      currentAccount={leader}
      accounts={demoAccounts}
      teams={[team]}
    >
      <InteractionProvider>
        <TeamDashboard />
      </InteractionProvider>
    </IdentityProvider>,
  );
}

describe("TeamDashboard", () => {
  beforeEach(() => {
    const now = Date.now();
    vi.clearAllMocks();
    loadAllSubmissionsMock.mockResolvedValue([
        backendSubmission({
          id: "SUB-DASH-001",
          fileName: "today.mp4",
          createdAt: now,
          durationSeconds: 120,
          qualityStatus: "scored",
          finalScore: 90,
        }),
        backendSubmission({
          id: "SUB-DASH-002",
          fileName: "review.mp4",
          createdAt: now - 24 * 60 * 60 * 1_000,
          durationSeconds: 60,
          qualityStatus: "review_pending",
          finalScore: 70,
        }),
        backendSubmission({
          id: "SUB-DASH-003",
          fileName: "failed.mp4",
          createdAt: now - 2 * 24 * 60 * 60 * 1_000,
          durationSeconds: 0,
          processingStatus: "system_failed",
        }),
        backendSubmission({
          id: "SUB-DASH-004",
          fileName: "reviewed.mp4",
          createdAt: now - 40 * 24 * 60 * 60 * 1_000,
          durationSeconds: 60,
          qualityStatus: "review_pending",
          finalScore: 75,
          manualReviewed: true,
        }),
      ]);
  });

  it("summarizes backend team submissions", async () => {
    renderPage();

    expect(await screen.findByText("已连接后端数据")).toBeVisible();
    expect(screen.getByText("近 30 日 · 今日 1 条")).toBeVisible();
    expect(screen.getByText("3 分钟")).toBeVisible();
    expect(screen.getByText("近 30 日 · 有效 3 分钟")).toBeVisible();
    expect(screen.getByText("90.0")).toBeVisible();
    expect(screen.getByText("1 条数据待关注")).toBeVisible();
    expect(screen.getByText("1 个系统任务失败")).toBeVisible();
    expect(loadAllSubmissionsMock).toHaveBeenCalledWith({
      status: "all",
    });
  });
});
