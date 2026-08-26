import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityProvider } from "../../auth/client/IdentityContext";
import type { BackendPointCycle } from "../../points/contracts";
import {
  getPointRule,
  listPointCycles,
} from "../../points/client/pointCycleApi";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import type { BackendSubmission } from "../../submissions/contracts";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { TeamIncomePage } from "./TeamIncomePage";

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
  };
});

const getPointRuleMock = vi.mocked(getPointRule);
const listPointCyclesMock = vi.mocked(listPointCycles);
const loadAllSubmissionsMock = vi.mocked(loadAllSubmissions);

const team = {
  id: "TEAM-01",
  name: "星火一队",
  status: "active" as const,
  unitPricePerMinute: 12,
  createdAt: 1_722_708_000_000,
  updatedAt: 1_722_708_000_000,
};

function pointCycle(): BackendPointCycle {
  return {
    id: "PC-TEAM",
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
        id: "PCI-TEAM-01",
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

function lockedBackendSubmission(): BackendSubmission {
  const submission = backendSubmission();
  return {
    ...submission,
    id: "SUB-LOCKED",
    fileName: "locked.mp4",
    settlementStatus: "settled",
    media: {
      ...submission.media!,
      durationSeconds: 60,
    },
    quality: {
      ...submission.quality!,
      finalScore: 80,
      rawTotalScore: 80,
      billableDurationMs: 60_000,
    },
  };
}

function failedBackendSubmission(): BackendSubmission {
  const submission = backendSubmission();
  return {
    ...submission,
    id: "SUB-FAILED",
    fileName: "failed.mp4",
    quality: {
      ...submission.quality!,
      finalScore: 65,
      rawTotalScore: 65,
      settlementRatio: 0,
      passed: false,
      passThreshold: 70,
      summary: "未通过",
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
      <TeamIncomePage />
    </IdentityProvider>,
  );
}

describe("TeamIncomePage", () => {
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
    loadAllSubmissionsMock.mockImplementation(async (input) => {
      return input?.status === "unsettled"
        ? [backendSubmission()]
        : [backendSubmission(), lockedBackendSubmission()];
    });
  });

  it("summarizes backend team points by member", async () => {
    renderPage();

    expect(await screen.findByText("已连接后端积分")).toBeVisible();
    expect(screen.getAllByText("34.00 分").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("2 条已有终态质检")).toBeVisible();
    expect(screen.getAllByText("3 分钟").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("测试人员1")).toBeVisible();
    expect(screen.getAllByText("2 条").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("85.0")).toBeVisible();
    expect(loadAllSubmissionsMock).toHaveBeenCalledWith({
      status: "unsettled",
    });
    expect(loadAllSubmissionsMock).toHaveBeenCalledWith({ status: "all" });
  });

  it("uses all reviewed member results when calculating pass rate", async () => {
    listPointCyclesMock.mockResolvedValue([]);
    loadAllSubmissionsMock.mockImplementation(async (input) => {
      return input?.status === "unsettled"
        ? [backendSubmission()]
        : [backendSubmission(), failedBackendSubmission()];
    });

    renderPage();

    expect(await screen.findByText("已连接后端积分")).toBeVisible();
    expect(screen.getByText("50.0%")).toBeVisible();
    expect(screen.getByText("77.5")).toBeVisible();
    expect(screen.getByText("2 条已有终态质检")).toBeVisible();
  });

  it("does not count a concurrently locked submission as pending again", async () => {
    loadAllSubmissionsMock.mockImplementation(async (input) => {
      return input?.status === "unsettled"
        ? [lockedBackendSubmission()]
        : [lockedBackendSubmission()];
    });

    renderPage();

    expect(await screen.findByText("已连接后端积分")).toBeVisible();
    expect(screen.queryByText("34.00 分")).not.toBeInTheDocument();
    expect(screen.getAllByText("10.00 分").length).toBeGreaterThanOrEqual(2);
  });
});
