import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityProvider } from "../../auth/client/IdentityContext";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import type {
  BackendQualityStatus,
  BackendSubmission,
} from "../../submissions/contracts";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { TeamAnalyticsPage } from "./TeamAnalyticsPage";

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
  qualityStatus?: BackendQualityStatus;
  finalScore?: number | null;
  scene?: string;
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
    processingStatus: "completed",
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
            settlementRatio:
              input.finalScore === null || input.finalScore === undefined
                ? null
                : 1,
            invalidDurationMs: 0,
            billableDurationMs: input.durationSeconds * 1_000,
            summary: "测试结果",
            recommendations: [],
            deductions: [],
            reviewRequired: input.qualityStatus === "review_pending",
            reviewReasons:
              input.qualityStatus === "review_pending" ? ["需要人工关注"] : [],
            reviewRevision: 0,
            invalidSegments: [],
            detectedTask: input.scene
              ? {
                  scene_id: input.scene,
                  task_summary: "测试任务",
                  variant_id: "测试物体",
                }
              : undefined,
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
      <TeamAnalyticsPage />
    </IdentityProvider>,
  );
}

describe("TeamAnalyticsPage", () => {
  beforeEach(() => {
    const now = Date.now();
    vi.clearAllMocks();
    loadAllSubmissionsMock.mockResolvedValue([
        backendSubmission({
          id: "SUB-ANA-001",
          fileName: "kitchen.mp4",
          createdAt: now,
          durationSeconds: 120,
          qualityStatus: "scored",
          finalScore: 90,
          scene: "厨房整理",
        }),
        backendSubmission({
          id: "SUB-ANA-002",
          fileName: "tool.mp4",
          createdAt: now - 24 * 60 * 60 * 1_000,
          durationSeconds: 60,
          qualityStatus: "review_pending",
          finalScore: 70,
          scene: "工具使用",
        }),
        backendSubmission({
          id: "SUB-ANA-003",
          fileName: "reject.mp4",
          createdAt: now - 2 * 24 * 60 * 60 * 1_000,
          durationSeconds: 30,
          qualityStatus: "hard_reject",
          finalScore: 40,
          scene: "无效内容",
        }),
        backendSubmission({
          id: "SUB-ANA-004",
          fileName: "pending.mp4",
          createdAt: now - 3 * 24 * 60 * 60 * 1_000,
          durationSeconds: 45,
        }),
      ]);
  });

  it("summarizes backend analytics for the leader team", async () => {
    renderPage();

    expect(await screen.findByText("已连接后端数据")).toBeVisible();
    expect(screen.getAllByText("50.0%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("2 条终态结果")).toBeVisible();
    expect(screen.getByText("1 条未通过")).toBeVisible();
    expect(screen.getByText("共上传 4 条")).toBeVisible();
    expect(screen.getByText("厨房整理")).toBeVisible();
    expect(screen.queryByText("工具使用")).not.toBeInTheDocument();
    expect(loadAllSubmissionsMock).toHaveBeenCalledWith({
      status: "all",
    });
  });
});
