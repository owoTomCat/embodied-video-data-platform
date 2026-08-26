import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityProvider } from "../../auth/client/IdentityContext";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import type {
  BackendQualityStatus,
  BackendSubmission,
} from "../../submissions/contracts";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { getAiQualityPrompt } from "../../ai-quality/client/aiQualityApi";
import { AdminDashboard } from "./AdminDashboard";

vi.mock("../../ai-quality/client/aiQualityApi", () => ({
  getAiQualityPrompt: vi.fn(),
}));

vi.mock("../../submissions/client/submissionApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../submissions/client/submissionApi")>();
  return {
    ...actual,
    loadAllSubmissions: vi.fn(),
  };
});

const loadAllSubmissionsMock = vi.mocked(loadAllSubmissions);
const getAiQualityPromptMock = vi.mocked(getAiQualityPrompt);

function backendSubmission(input: {
  id: string;
  fileName: string;
  processingStatus?: BackendSubmission["processingStatus"];
  settlementStatus?: "settled" | "unsettled";
  qualityStatus?: BackendQualityStatus;
  finalScore?: number | null;
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
    settlementStatus: input.settlementStatus ?? "unsettled",
    isTestData: false,
    createdAt: Date.now(),
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
            billableDurationMs: 120_000,
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
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider
      currentAccount={admin}
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
      <AdminDashboard />
    </IdentityProvider>,
  );
}

describe("AdminDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiQualityPromptMock.mockResolvedValue({
      id: "PROMPT-7",
      revision: 7,
      systemPrompt: "测试提示词",
      contentSha256: "a".repeat(64),
      promptVersion: "prompt-v7",
      ruleVersion: "rule-v2",
      outputSchema: "quality-v1",
      initialModel: "model-primary-live",
      reviewModel: "model-review-live",
      createdByName: "管理员",
      createdAt: 1,
    });
    loadAllSubmissionsMock.mockResolvedValue([
        backendSubmission({
          id: "SUB-ADMIN-001",
          fileName: "settled-pass.mp4",
          settlementStatus: "settled",
          qualityStatus: "scored",
          finalScore: 90,
        }),
        backendSubmission({
          id: "SUB-ADMIN-002",
          fileName: "review-pass.mp4",
          qualityStatus: "review_pending",
          finalScore: 70,
        }),
        backendSubmission({
          id: "SUB-ADMIN-003",
          fileName: "reject.mp4",
          qualityStatus: "hard_reject",
          finalScore: 40,
        }),
        backendSubmission({
          id: "SUB-ADMIN-004",
          fileName: "running.mp4",
          processingStatus: "ai_processing",
          qualityStatus: "running",
          finalScore: null,
        }),
      ]);
  });

  it("summarizes backend submissions for the operation overview", async () => {
    renderPage();

    expect(await screen.findByText("已连接后端数据")).toBeVisible();
    expect(screen.getByText("4 条")).toBeVisible();
    expect(screen.getByText("50.0%")).toBeVisible();
    expect(screen.getByText("2 条已有正式结论")).toBeVisible();

    const aiRow = screen.getByText("AI 执行中").closest("div");
    expect(aiRow).not.toBeNull();
    expect(within(aiRow as HTMLDivElement).getByText("1")).toBeVisible();
    expect(loadAllSubmissionsMock).toHaveBeenCalledWith({
      status: "all",
    });
    expect(await screen.findByText("model-primary-live")).toBeVisible();
    expect(screen.getByText("model-review-live")).toBeVisible();
    expect(screen.getByText("Worker 配置")).toBeVisible();
    expect(screen.getByText("PostgreSQL")).toBeVisible();
  });

  it("includes records after the first 100 in dashboard metrics", async () => {
    loadAllSubmissionsMock.mockResolvedValue([
      ...Array.from({ length: 100 }, (_, index) =>
        backendSubmission({
          id: `SUB-PENDING-${index}`,
          fileName: `pending-${index}.mp4`,
          processingStatus: "ai_processing",
          qualityStatus: "running",
          finalScore: null,
        }),
      ),
      backendSubmission({
        id: "SUB-PAGE-2-PASS",
        fileName: "page-2-pass.mp4",
        settlementStatus: "settled",
        qualityStatus: "scored",
        finalScore: 95,
      }),
    ]);

    renderPage();

    expect(await screen.findByText("101 条")).toBeVisible();
    expect(screen.getByText("100.0%")).toBeVisible();
    expect(screen.getByText("1 条已有正式结论")).toBeVisible();
    const deliverableCard = screen.getByText("可交付资产").closest("div");
    expect(deliverableCard).not.toBeNull();
    expect(within(deliverableCard as HTMLDivElement).getByText("1")).toBeVisible();
  });
});
