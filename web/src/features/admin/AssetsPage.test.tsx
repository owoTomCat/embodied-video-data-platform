import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityProvider } from "../../auth/client/IdentityContext";
import {
  listDeliveryArchiveTasks,
  listDeliveryPackages,
  previewDeliveryPackage,
} from "../../delivery/client/deliveryPackageApi";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import type {
  BackendQualityStatus,
  BackendSubmission,
} from "../../submissions/contracts";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { AssetsPage } from "./AssetsPage";

vi.mock("../../delivery/client/deliveryPackageApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../delivery/client/deliveryPackageApi")>();
  return {
    ...actual,
    listDeliveryPackages: vi.fn(),
    previewDeliveryPackage: vi.fn(),
    listDeliveryArchiveTasks: vi.fn(),
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

const listDeliveryPackagesMock = vi.mocked(listDeliveryPackages);
const previewDeliveryPackageMock = vi.mocked(previewDeliveryPackage);
const listDeliveryArchiveTasksMock = vi.mocked(listDeliveryArchiveTasks);
const loadAllSubmissionsMock = vi.mocked(loadAllSubmissions);

function backendSubmission(input: {
  id: string;
  fileName: string;
  settlementStatus: "settled" | "unsettled";
  qualityStatus: BackendQualityStatus;
  finalScore: number | null;
}): BackendSubmission {
  return {
    id: input.id,
    fileName: input.fileName,
    ownerId: "U-COL-01",
    ownerName: "测试人员1",
    teamId: "TEAM-01",
    teamName: "星火一队",
    sizeBytes: "2048",
    uploadStatus: "uploaded",
    processingStatus: "completed",
    settlementStatus: input.settlementStatus,
    isTestData: false,
    createdAt: Date.now(),
    media: {
      durationSeconds: 120,
      width: 1920,
      height: 1080,
      frameRate: 30,
      codec: "h264",
      bitrate: "1000",
      sizeBytes: "2048",
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
      billableDurationMs: 120_000,
      summary: "测试结果",
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
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <InteractionProvider>
        <AssetsPage />
      </InteractionProvider>
    </IdentityProvider>,
  );
}

describe("AssetsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDeliveryPackagesMock.mockResolvedValue([
      {
        id: "PKG-ASSET-01",
        name: "真实交付包",
        status: "ready",
        assetCount: 3,
        totalSizeBytes: "2048",
        createdByAccountId: "U-ADMIN-01",
        createdByName: "管理员",
        createdAt: Date.now(),
        items: [],
      },
    ]);
    previewDeliveryPackageMock.mockResolvedValue({
      assetCount: 2,
      totalSizeBytes: "3072",
    });
    listDeliveryArchiveTasksMock.mockResolvedValue([]);
    loadAllSubmissionsMock.mockResolvedValue([
        backendSubmission({
          id: "SUB-ASSET-OK",
          fileName: "deliverable.mp4",
          settlementStatus: "settled",
          qualityStatus: "scored",
          finalScore: 90,
        }),
        backendSubmission({
          id: "SUB-ASSET-NO",
          fileName: "unsettled.mp4",
          settlementStatus: "unsettled",
          qualityStatus: "scored",
          finalScore: 90,
        }),
      ]);
  });

  it("uses backend packages, preview and deliverable assets", async () => {
    renderPage();

    expect(await screen.findByText("交付包数据已同步")).toBeVisible();
    expect(screen.getByText("真实交付包")).toBeVisible();
    expect(screen.getByText("deliverable.mp4")).toBeVisible();
    expect(screen.queryByText("unsettled.mp4")).not.toBeInTheDocument();
    expect(screen.getByText("5 KB")).toBeVisible();
    expect(loadAllSubmissionsMock).toHaveBeenCalledWith({
      status: "all",
    });
  });
});
