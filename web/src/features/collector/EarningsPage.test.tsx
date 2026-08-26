import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityProvider } from "../../auth/client/IdentityContext";
import type { BackendPointCycle } from "../../points/contracts";
import {
  getPointRule,
  listPointCycles,
} from "../../points/client/pointCycleApi";
import {
  loadAllSubmissions,
  searchSubmissions,
} from "../../submissions/client/submissionApi";
import type { BackendSubmission } from "../../submissions/contracts";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { EarningsPage } from "./EarningsPage";

vi.mock("../../points/client/pointCycleApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../points/client/pointCycleApi")>();
  return {
    ...actual,
    getPointRule: vi.fn(),
    listPointCycles: vi.fn(),
  };
});

vi.mock("../../submissions/client/submissionApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../submissions/client/submissionApi")>();
  return {
    ...actual,
    loadAllSubmissions: vi.fn(),
    searchSubmissions: vi.fn(),
  };
});

const getPointRuleMock = vi.mocked(getPointRule);
const listPointCyclesMock = vi.mocked(listPointCycles);
const loadAllSubmissionsMock = vi.mocked(loadAllSubmissions);
const searchSubmissionsMock = vi.mocked(searchSubmissions);

function pointCycle(): BackendPointCycle {
  return {
    id: "PC-20260813",
    businessDate: "2026-08-13",
    status: "locked",
    submissionCount: 1,
    effectiveDurationMs: 60_000,
    effectiveMinutes: 1,
    totalPoints: 10,
    createdByAccountId: "U-ADMIN-01",
    createdByName: "管理员",
    createdAt: Date.parse("2026-08-13T08:00:00+08:00"),
    items: [
      {
        id: "PCI-001",
        submissionId: "SUB-LOCKED",
        ownerId: "U-COL-01",
        ownerName: "测试人员1",
        teamId: "TEAM-01",
        teamName: "星火一队",
        fileName: "locked.mp4",
        finalScore: 80,
        settlementRatio: 1,
        effectiveDurationMs: 60_000,
        effectiveMinutes: 1,
        invalidDurationMs: 0,
        pointsPerMinute: 10,
        points: 10,
        qualityRevision: 0,
      },
    ],
  };
}

function backendSubmission(): BackendSubmission {
  return {
    id: "SUB-PENDING",
    fileName: "pending.mp4",
    ownerId: "U-COL-01",
    ownerName: "测试人员1",
    teamId: "TEAM-01",
    teamName: "星火一队",
    sizeBytes: "1048576",
    uploadStatus: "uploaded",
    processingStatus: "completed",
    settlementStatus: "unsettled",
    isTestData: false,
    createdAt: Date.parse("2026-08-13T09:00:00+08:00"),
    media: {
      durationSeconds: 120,
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
      finalScore: 90,
      rawTotalScore: 90,
      settlementRatio: 1,
      invalidDurationMs: 0,
      billableDurationMs: 120_000,
      summary: "通过",
      recommendations: [],
      deductions: [],
      reviewRequired: false,
      reviewReasons: [],
      reviewRevision: 0,
      invalidSegments: [],
    },
  };
}

function renderPage() {
  const collector = accountForRole("collector");
  return render(
    <IdentityProvider
      currentAccount={collector}
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
      <EarningsPage />
    </IdentityProvider>,
  );
}

describe("EarningsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPointRuleMock.mockResolvedValue({
      id: "PRV-TEST",
      revision: 1,
      version: "POINTS-TEST",
      defaultPointsPerMinute: 12,
      coefficientBands: [
        { minScore: 80, maxScore: 100, ratio: 1, label: "优质" },
        { minScore: 70, maxScore: 79, ratio: 0.85, label: "合格" },
        { minScore: 60, maxScore: 69, ratio: 0.7, label: "基础" },
        { minScore: 0, maxScore: 59, ratio: 0, label: "不计分" },
      ],
      description: "测试积分规则",
      active: true,
      createdByAccountId: "U-ADMIN-01",
      createdByName: "管理员",
      createdAt: 1,
    });
    listPointCyclesMock.mockResolvedValue([pointCycle()]);
    loadAllSubmissionsMock.mockResolvedValue([backendSubmission()]);
    searchSubmissionsMock.mockImplementation(async (input) => {
      return {
        submissions: [],
        pagination: {
          page: 1,
          pageSize: 1,
          total: input.status === "reviewed" ? 2 : 3,
          totalPages: 1,
        },
      };
    });
  });

  it("summarizes locked and pending backend points", async () => {
    renderPage();

    expect(await screen.findByText("已连接后端积分")).toBeVisible();
    expect(screen.getByText("34.00 分")).toBeVisible();
    expect(screen.getAllByText("24.00 分").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("3 分钟")).toBeVisible();
    expect(screen.getByText("pending.mp4")).toBeVisible();
    expect(screen.getByText("locked.mp4")).toBeVisible();
    expect(loadAllSubmissionsMock).toHaveBeenCalledWith({
      status: "unsettled",
    });
  });

  it("includes more than 100 unsettled submissions in pending points", async () => {
    loadAllSubmissionsMock.mockResolvedValue(
      Array.from({ length: 101 }, (_, index) => ({
        ...backendSubmission(),
        id: `SUB-PENDING-${index}`,
        fileName: `pending-${index}.mp4`,
      })),
    );
    renderPage();

    expect(await screen.findByText("已连接后端积分")).toBeVisible();
    expect(screen.getByText("2434.00 分")).toBeVisible();
    expect(screen.getAllByText("2424.00 分").length).toBeGreaterThanOrEqual(1);
  });

  it("uses the published point-rule bands instead of the quality snapshot ratio", async () => {
    getPointRuleMock.mockResolvedValue({
      ...(await getPointRuleMock()),
      coefficientBands: [
        { minScore: 0, maxScore: 100, ratio: 0.5, label: "统一半系数" },
      ],
    });
    renderPage();

    expect(await screen.findByText("已连接后端积分")).toBeVisible();
    expect(screen.getAllByText("12.00 分").length).toBeGreaterThanOrEqual(2);
  });

  it("does not count a concurrently locked submission as pending again", async () => {
    loadAllSubmissionsMock.mockResolvedValue([
      {
        ...backendSubmission(),
        id: "SUB-LOCKED",
        fileName: "locked.mp4",
        settlementStatus: "settled",
      },
    ]);

    renderPage();

    expect(await screen.findByText("已连接后端积分")).toBeVisible();
    expect(screen.getByText("0.00 分")).toBeVisible();
    expect(screen.queryByText("34.00 分")).not.toBeInTheDocument();
    expect(screen.getAllByText("locked.mp4")).toHaveLength(1);
  });
});
