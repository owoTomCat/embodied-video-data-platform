import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityProvider } from "../../auth/client/IdentityContext";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import type {
  BackendQualityStatus,
  BackendSubmission,
} from "../../submissions/contracts";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { MembersPage } from "./MembersPage";

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
  ownerId: string;
  ownerName: string;
  createdAt: number;
  durationSeconds: number;
  qualityStatus: BackendQualityStatus;
  finalScore: number | null;
}): BackendSubmission {
  return {
    id: input.id,
    fileName: input.fileName,
    ownerId: input.ownerId,
    ownerName: input.ownerName,
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
    quality: {
      status: input.qualityStatus,
      attempts: 1,
      promptRevision: 1,
      promptContentSha256: "a".repeat(64),
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      modelRuns: [],
      finalScore: input.finalScore,
      rawTotalScore: input.finalScore,
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
        <MembersPage />
      </InteractionProvider>
    </IdentityProvider>,
  );
}

describe("MembersPage", () => {
  beforeEach(() => {
    const now = Date.now();
    vi.clearAllMocks();
    loadAllSubmissionsMock.mockResolvedValue([
        backendSubmission({
          id: "SUB-MEM-001",
          fileName: "member-pass.mp4",
          ownerId: "U-COL-01",
          ownerName: "测试人员1",
          createdAt: now,
          durationSeconds: 120,
          qualityStatus: "scored",
          finalScore: 90,
        }),
        backendSubmission({
          id: "SUB-MEM-002",
          fileName: "member-fail.mp4",
          ownerId: "U-COL-01",
          ownerName: "测试人员1",
          createdAt: now - 24 * 60 * 60 * 1_000,
          durationSeconds: 60,
          qualityStatus: "hard_reject",
          finalScore: 40,
        }),
      ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses backend submissions for member metrics", async () => {
    renderPage();

    expect(await screen.findByText("已连接后端指标")).toBeVisible();
    const memberRow = screen.getByText("测试人员1").closest("tr");
    expect(memberRow).not.toBeNull();
    const row = within(memberRow as HTMLTableRowElement);
    expect(row.getByText("2 条")).toBeVisible();
    expect(row.getByText("3 分钟")).toBeVisible();
    expect(row.getByText("65.0")).toBeVisible();
    expect(row.getByText("50.0%")).toBeVisible();
    expect(loadAllSubmissionsMock).toHaveBeenCalledWith({
      status: "all",
    });
  });

  it("exports backend-derived member metrics", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue("blob:member-metrics");
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderPage();

    await screen.findByText("已连接后端指标");
    await user.click(screen.getByRole("button", { name: "导出统计" }));

    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    await expect(blob.text()).resolves.toContain(
      '"测试人员1","ceshirenyuan1","数采人员","已启用","2","2","1","1","3","65.0","50.0"',
    );
  });
});
