import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityProvider } from "../../auth/client/IdentityContext";
import type { BackendSubmission } from "../../submissions/contracts";
import { searchSubmissions } from "../../submissions/client/submissionApi";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { TeamSubmissionsPage } from "./TeamSubmissionsPage";

vi.mock("../../submissions/client/submissionApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../submissions/client/submissionApi")>();
  return {
    ...actual,
    searchSubmissions: vi.fn(),
  };
});

const searchSubmissionsMock = vi.mocked(searchSubmissions);

function backendSubmission(
  overrides: Partial<BackendSubmission> = {},
): BackendSubmission {
  return {
    id: "SUB-TEAM-01",
    fileName: "team-live-task.mp4",
    ownerId: "U-COL-01",
    ownerName: "团队数采",
    teamId: "TEAM-01",
    teamName: "星火一队",
    sizeBytes: "1048576",
    uploadStatus: "uploaded",
    processingStatus: "completed",
    settlementStatus: "unsettled",
    isTestData: false,
    createdAt: Date.parse("2026-08-13T08:00:00.000Z"),
    media: {
      durationSeconds: 60,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      bitrate: "1000",
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
      billableDurationMs: 60_000,
      summary: "通过",
      recommendations: [],
      deductions: [],
      reviewRequired: false,
      reviewReasons: [],
      reviewRevision: 0,
      invalidSegments: [],
    },
    ...overrides,
  };
}

function renderPage() {
  const leader = accountForRole("leader");
  return render(
    <IdentityProvider
      currentAccount={leader}
      accounts={demoAccounts}
      teams={[
        {
          id: "TEAM-01",
          name: "星火一队",
          status: "active",
          unitPricePerMinute: 12,
          createdAt: 1_722_708_000_000,
          updatedAt: 1_722_708_000_000,
        },
      ]}
    >
      <TeamSubmissionsPage />
    </IdentityProvider>,
  );
}

describe("TeamSubmissionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchSubmissionsMock.mockResolvedValue({
      submissions: [backendSubmission()],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 21,
        totalPages: 2,
      },
    });
  });

  it("loads scoped team submissions from the backend", async () => {
    renderPage();

    expect(await screen.findByText("team-live-task.mp4")).toBeVisible();
    expect(screen.getByText("后端筛选 1-1 / 21 条团队数据")).toBeVisible();
    expect(screen.getByRole("link", { name: "导出团队数据" })).toHaveAttribute(
      "href",
      "http://localhost:4000/api/v1/submissions/export.csv",
    );
    expect(searchSubmissionsMock).toHaveBeenCalledWith({
      q: "",
      status: "all",
      page: 1,
      pageSize: 20,
      includeThumbnails: true,
    });
  });

  it("sends filters and page changes to the backend", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("team-live-task.mp4");
    await user.type(screen.getByLabelText("搜索"), "厨房");
    await user.selectOptions(screen.getByLabelText("状态筛选"), "passed");
    await waitFor(() =>
      expect(searchSubmissionsMock).toHaveBeenLastCalledWith({
        q: "厨房",
        status: "passed",
        page: 1,
        pageSize: 20,
        includeThumbnails: true,
      }),
    );
    expect(screen.getByRole("link", { name: "导出团队数据" })).toHaveAttribute(
      "href",
      "http://localhost:4000/api/v1/submissions/export.csv?q=%E5%8E%A8%E6%88%BF&status=passed",
    );

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(searchSubmissionsMock).toHaveBeenLastCalledWith({
        q: "厨房",
        status: "passed",
        page: 2,
        pageSize: 20,
        includeThumbnails: true,
      }),
    );
  });
});
