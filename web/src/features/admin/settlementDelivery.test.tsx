import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import {
  createDeliveryArchiveTask,
  createDeliveryPackage,
  deliveryArchiveUrl,
  deliveryZipArchiveUrl,
  getDeliveryArchiveDownloadLink,
  getDeliveryArchiveTask,
  getDeliveryDownloadLinks,
  listDeliveryArchiveTasks,
  listDeliveryPackages,
  previewDeliveryPackage,
} from "../../delivery/client/deliveryPackageApi";
import {
  adjustPointCycleItem,
  createPointCycle,
  createPointRule,
  getPointRule,
  listPointCycles,
  previewPointCycle,
} from "../../points/client/pointCycleApi";
import {
  getWalletFlowStats,
  getWalletTeamStats,
  listMemberTransactions,
  listWallets,
} from "../../wallet/client/walletApi";
import {
  listSceneCategoryPricing,
  updateSceneCategoryPrice,
} from "../../scene-pricing/client/scenePricingApi";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

vi.mock("../../wallet/client/walletApi", () => ({
  listWallets: vi.fn(),
  listMemberTransactions: vi.fn(),
  getWalletFlowStats: vi.fn(),
  getWalletTeamStats: vi.fn(),
}));

vi.mock("../../scene-pricing/client/scenePricingApi", () => ({
  listSceneCategoryPricing: vi.fn(),
  updateSceneCategoryPrice: vi.fn(),
}));

vi.mock("../../points/client/pointCycleApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../points/client/pointCycleApi")>();
  return {
    ...actual,
    listPointCycles: vi.fn(),
    previewPointCycle: vi.fn(),
    createPointCycle: vi.fn(),
    getPointRule: vi.fn(),
    createPointRule: vi.fn(),
    adjustPointCycleItem: vi.fn(),
  };
});

vi.mock("../../delivery/client/deliveryPackageApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../delivery/client/deliveryPackageApi")>();
  return {
    ...actual,
    listDeliveryPackages: vi.fn(),
    previewDeliveryPackage: vi.fn(),
    createDeliveryPackage: vi.fn(),
    getDeliveryDownloadLinks: vi.fn(),
    listDeliveryArchiveTasks: vi.fn(),
    createDeliveryArchiveTask: vi.fn(),
    getDeliveryArchiveTask: vi.fn(),
    getDeliveryArchiveDownloadLink: vi.fn(),
  };
});

const listPointCyclesMock = vi.mocked(listPointCycles);
const previewPointCycleMock = vi.mocked(previewPointCycle);
const createPointCycleMock = vi.mocked(createPointCycle);
const getPointRuleMock = vi.mocked(getPointRule);
const createPointRuleMock = vi.mocked(createPointRule);
const adjustPointCycleItemMock = vi.mocked(adjustPointCycleItem);
const listWalletsMock = vi.mocked(listWallets);
const listMemberTransactionsMock = vi.mocked(listMemberTransactions);
const getWalletFlowStatsMock = vi.mocked(getWalletFlowStats);
const getWalletTeamStatsMock = vi.mocked(getWalletTeamStats);
const listSceneCategoryPricingMock = vi.mocked(listSceneCategoryPricing);
const updateSceneCategoryPriceMock = vi.mocked(updateSceneCategoryPrice);
const listDeliveryPackagesMock = vi.mocked(listDeliveryPackages);
const previewDeliveryPackageMock = vi.mocked(previewDeliveryPackage);
const createDeliveryPackageMock = vi.mocked(createDeliveryPackage);
const getDeliveryDownloadLinksMock = vi.mocked(getDeliveryDownloadLinks);
const listDeliveryArchiveTasksMock = vi.mocked(listDeliveryArchiveTasks);
const createDeliveryArchiveTaskMock = vi.mocked(createDeliveryArchiveTask);
const getDeliveryArchiveTaskMock = vi.mocked(getDeliveryArchiveTask);
const getDeliveryArchiveDownloadLinkMock = vi.mocked(
  getDeliveryArchiveDownloadLink,
);

function renderAdmin(path: string) {
  window.history.replaceState({}, "", path);
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath={path} />
    </IdentityProvider>,
  );
}

describe("settlement actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWalletsMock.mockResolvedValue([]);
    listMemberTransactionsMock.mockResolvedValue([]);
    getWalletFlowStatsMock.mockResolvedValue([]);
    getWalletTeamStatsMock.mockResolvedValue([]);
    listSceneCategoryPricingMock.mockResolvedValue([
      { categoryKey: "family", name: "家庭", pricePerHour: 20, description: "", updatedAt: 0 },
      { categoryKey: "office", name: "办公室", pricePerHour: 25, description: "", updatedAt: 0 },
      { categoryKey: "factory", name: "工厂", pricePerHour: 30, description: "", updatedAt: 0 },
      { categoryKey: "generic", name: "通用", pricePerHour: 20, description: "", updatedAt: 0 },
    ]);
    listPointCyclesMock.mockResolvedValue([
      {
        id: "PC-20260812",
        businessDate: "2026-08-12",
        status: "locked",
        submissionCount: 2,
        effectiveDurationMs: 120_000,
        effectiveMinutes: 2,
        totalPoints: 24,
        createdByAccountId: "U-ADMIN-01",
        createdByName: "管理员",
        createdAt: 1_786_118_400_000,
        settleDueAt: null,
        settledAt: null,
        items: [],
      },
    ]);
    previewPointCycleMock.mockResolvedValue({
      submissionCount: 4,
      effectiveDurationMs: 676_200,
      effectiveMinutes: 11.27,
      totalPoints: 116.12,
      teamSummaries: [],
    });
    createPointCycleMock.mockResolvedValue({
      id: "PC-20260813",
      businessDate: "2026-08-13",
      status: "locked",
      submissionCount: 4,
      effectiveDurationMs: 676_200,
      effectiveMinutes: 11.27,
      totalPoints: 116.12,
      createdByAccountId: "U-ADMIN-01",
      createdByName: "管理员",
      createdAt: 1_786_204_800_000,
      items: [],
      settleDueAt: null,
      settledAt: null,
    });
    getPointRuleMock.mockResolvedValue({
      id: "PRV-1",
      revision: 1,
      version: "POINTS-2026-08",
      defaultPointsPerMinute: 12,
      coefficientBands: [
        { minScore: 80, maxScore: 100, ratio: 1, label: "优质" },
        { minScore: 70, maxScore: 79, ratio: 0.85, label: "合格" },
        { minScore: 60, maxScore: 69, ratio: 0.7, label: "基础" },
        { minScore: 0, maxScore: 59, ratio: 0, label: "不计分" },
      ],
      description: "默认单价规则",
      active: true,
      createdByAccountId: "U-ADMIN-01",
      createdByName: "系统初始化",
      createdAt: 1_786_118_400_000,
    });
    createPointRuleMock.mockImplementation(async (input) => ({
      id: "PRV-2",
      revision: 2,
      active: true,
      createdByAccountId: "U-ADMIN-01",
      createdByName: "管理员",
      createdAt: 1_786_204_800_000,
      ...input,
    }));
    listDeliveryPackagesMock.mockResolvedValue([
      {
        id: "PKG-20260812",
        name: "八月已交付包",
        status: "ready",
        assetCount: 2,
        totalSizeBytes: "6144",
        createdByAccountId: "U-ADMIN-01",
        createdByName: "管理员",
        createdAt: 1_786_118_400_000,
        items: [],

      },
    ]);
    previewDeliveryPackageMock.mockResolvedValue({
      assetCount: 2,
      totalSizeBytes: "6144",
    });
    createDeliveryPackageMock.mockResolvedValue({
      id: "PKG-20260813",
      name: "八月家庭任务包",
      status: "ready",
      assetCount: 2,
      totalSizeBytes: "6144",
      createdByAccountId: "U-ADMIN-01",
      createdByName: "管理员",
      createdAt: 1_786_204_800_000,
      items: [],
    });
    getDeliveryDownloadLinksMock.mockResolvedValue({
      package: {
        id: "PKG-20260812",
        name: "八月已交付包",
        status: "ready",
        assetCount: 2,
        totalSizeBytes: "6144",
        createdByAccountId: "U-ADMIN-01",
        createdByName: "管理员",
        createdAt: 1_786_118_400_000,
        items: [],
      },
      expiresInSeconds: 1800,
      links: [
        {
          packageItemId: "DPI-01",
          submissionId: "SUB-DLV-01",
          fileName: "kitchen-task.mp4",
          objectKey: "uploads/delivery/kitchen-task.mp4",
          sizeBytes: "2048",
          url: "http://minio.local/uploads/delivery/kitchen-task.mp4?download=1",
          expiresAt: 1_786_209_000_000,
        },
      ],
    });
    listDeliveryArchiveTasksMock.mockResolvedValue([]);
    createDeliveryArchiveTaskMock.mockResolvedValue({
      id: "DAT-20260813-ZIP",
      packageId: "PKG-20260812",
      format: "zip",
      status: "queued",
      assetCount: 2,
      processedAssetCount: 0,
      totalSizeBytes: "6144",
      processedSizeBytes: "0",
      progressPercent: 0,
      fileName: "PKG-20260812-assets.zip",
      requestedByAccountId: "U-ADMIN-01",
      requestedByName: "管理员",
      createdAt: 1_786_204_800_000,
      updatedAt: 1_786_204_800_000,
    });
    getDeliveryArchiveTaskMock.mockResolvedValue({
      id: "DAT-20260813-ZIP",
      packageId: "PKG-20260812",
      format: "zip",
      status: "completed",
      assetCount: 2,
      processedAssetCount: 2,
      totalSizeBytes: "6144",
      processedSizeBytes: "6144",
      progressPercent: 100,
      archiveObjectKey: "delivery-archives/PKG-20260812/DAT-20260813-ZIP.zip",
      archiveSizeBytes: "8192",
      fileName: "PKG-20260812-assets.zip",
      requestedByAccountId: "U-ADMIN-01",
      requestedByName: "管理员",
      startedAt: 1_786_204_800_000,
      finishedAt: 1_786_204_802_000,
      createdAt: 1_786_204_800_000,
      updatedAt: 1_786_204_802_000,
    });
    getDeliveryArchiveDownloadLinkMock.mockResolvedValue({
      task: {
        id: "DAT-20260813-ZIP",
        packageId: "PKG-20260812",
        format: "zip",
        status: "completed",
        assetCount: 2,
        processedAssetCount: 2,
        totalSizeBytes: "6144",
        processedSizeBytes: "6144",
        progressPercent: 100,
        archiveObjectKey:
          "delivery-archives/PKG-20260812/DAT-20260813-ZIP.zip",
        archiveSizeBytes: "8192",
        fileName: "PKG-20260812-assets.zip",
        requestedByAccountId: "U-ADMIN-01",
        requestedByName: "管理员",
        startedAt: 1_786_204_800_000,
        finishedAt: 1_786_204_802_000,
        createdAt: 1_786_204_800_000,
        updatedAt: 1_786_204_802_000,
      },
      url: "http://minio.local/delivery-archives/PKG-20260812/DAT-20260813-ZIP.zip?download=1",
      expiresAt: 1_786_209_000_000,
      expiresInSeconds: 1800,
    });
  });

  it("previews and locks the eligible settlement records", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/settlements");

    expect(
      await screen.findByText("结算周期数据已同步"),
    ).toBeVisible();
    await user.click(
      await screen.findByRole("button", { name: "手动锁定" }),
    );
    const dialog = screen.getByRole("dialog", { name: "确认锁定并生成结算周期" });
    expect(within(dialog).getByText("4 条")).toBeVisible();
    expect(within(dialog).getByText("11.27 分钟")).toBeVisible();
    expect(within(dialog).getByText("116.12 元")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "确认生成" }));

    expect(screen.getByText("结算周期已生成并锁定")).toBeVisible();
    expect(createPointCycleMock).toHaveBeenCalledTimes(1);
    const firstBatch = screen.getAllByRole("row")[1];
    expect(within(firstBatch).getByText("4 条")).toBeVisible();
    expect(within(firstBatch).getByText("116.12 元")).toBeVisible();
    expect(within(firstBatch).getByText("锁定中")).toBeVisible();
    expect(
      within(firstBatch).getByRole("link", { name: /导出/ }),
    ).toHaveAttribute("href", expect.stringContaining("export.csv"));
  });

  it("disables confirmation when no settlement data remains", async () => {
    const user = userEvent.setup();
    previewPointCycleMock.mockResolvedValue({
      submissionCount: 0,
      effectiveDurationMs: 0,
      effectiveMinutes: 0,
      totalPoints: 0,
      teamSummaries: [],
    });
    renderAdmin("/admin/settlements");

    await user.click(screen.getByRole("button", { name: "手动锁定" }));

    expect(screen.getByText("当前没有可锁定数据")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认生成" })).toBeDisabled();
  });

  it("publishes a persisted point rule version", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/settlements");

    expect(await screen.findByText("POINTS-2026-08 · V1")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "发布单价规则" }));
    await user.type(screen.getByLabelText("版本名称"), "POINTS-2026-09");
    await user.clear(screen.getByLabelText("默认每小时单价"));
    await user.type(screen.getByLabelText("默认每小时单价"), "15");
    await user.clear(screen.getByLabelText("规则说明"));
    await user.type(screen.getByLabelText("规则说明"), "九月单价规则");
    await user.click(screen.getByRole("button", { name: "发布规则" }));

    expect(createPointRuleMock).toHaveBeenCalledWith({
      version: "POINTS-2026-09",
      defaultPointsPerMinute: 15,
      coefficientBands: [
        { minScore: 80, maxScore: 100, ratio: 1, label: "优质" },
        { minScore: 70, maxScore: 79, ratio: 0.85, label: "合格" },
        { minScore: 60, maxScore: 69, ratio: 0.7, label: "基础" },
        { minScore: 0, maxScore: 59, ratio: 0, label: "不计分" },
      ],
      description: "九月单价规则",
    });
    expect(await screen.findByText("单价规则已发布")).toBeVisible();
    expect(screen.getByText("15 元/小时")).toBeVisible();
    expect(screen.getByText("POINTS-2026-09 · V2")).toBeVisible();
  });

  it("edits scene category pricing within the 20-40 range", async () => {
    const user = userEvent.setup();
    updateSceneCategoryPriceMock.mockResolvedValue({
      categoryKey: "office",
      name: "办公室",
      pricePerHour: 28,
      description: "",
      updatedAt: 0,
    });
    renderAdmin("/admin/settlements");

    expect(await screen.findByText("场景定价")).toBeVisible();
    // 默认值展示（元/小时）：家庭 20 与通用 20 各一行
    expect(screen.getAllByText("20.00 元/小时").length).toBeGreaterThan(0);
    expect(screen.getByText("30.00 元/小时")).toBeVisible();

    // 修改办公室单价 25 → 28
    const officeRow = screen
      .getByText("办公室")
      .closest("tr") as HTMLTableRowElement;
    await user.click(
      within(officeRow).getByRole("button", { name: "修改" }),
    );
    await user.clear(
      within(officeRow).getByLabelText("办公室每小时单价"),
    );
    await user.type(
      within(officeRow).getByLabelText("办公室每小时单价"),
      "28",
    );
    await user.click(
      within(officeRow).getByRole("button", { name: "保存" }),
    );

    expect(updateSceneCategoryPriceMock).toHaveBeenCalledWith("office", {
      pricePerHour: 28,
    });
    expect(await screen.findByText("28.00 元/小时")).toBeVisible();
  });

  it("rejects out-of-range scene prices locally", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/settlements");

    expect(await screen.findByText("场景定价")).toBeVisible();
    const familyRow = screen
      .getByText("家庭")
      .closest("tr") as HTMLTableRowElement;
    await user.click(
      within(familyRow).getByRole("button", { name: "修改" }),
    );
    await user.clear(
      within(familyRow).getByLabelText("家庭每小时单价"),
    );
    await user.type(
      within(familyRow).getByLabelText("家庭每小时单价"),
      "45",
    );
    await user.click(
      within(familyRow).getByRole("button", { name: "保存" }),
    );

    expect(
      await screen.findByText("场景单价范围：20 ~ 40 元/小时（家庭最低，上限 40）"),
    ).toBeVisible();
    expect(updateSceneCategoryPriceMock).not.toHaveBeenCalled();
  });
});

describe("delivery package actions", () => {
  it("creates a session delivery package and updates the monthly metric", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/assets");

    expect(
      await screen.findByText("交付包数据已同步"),
    ).toBeVisible();
    await user.click(
      await screen.findByRole("button", { name: "创建交付包" }),
    );
    const dialog = screen.getByRole("dialog", { name: "创建交付包" });
    expect(within(dialog).getByText("2 条可交付资产")).toBeVisible();
    await user.type(screen.getByLabelText("交付包名称"), "八月家庭任务包");
    await user.click(screen.getByRole("button", { name: "确认创建" }));

    expect(screen.getByText("交付包已创建")).toBeVisible();
    expect(createDeliveryPackageMock).toHaveBeenCalledWith({
      name: "八月家庭任务包",
    });
    expect(screen.getByText("八月家庭任务包")).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: /下载清单/ })[0],
    ).toHaveAttribute("href", expect.stringContaining("manifest.csv"));
    // 未准备归档时只提供“准备”入口，归档完成后才出现“下载 ZIP/TAR”链接
    expect(
      screen.getAllByRole("button", { name: "准备 ZIP" })[0],
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "准备 TAR" })[0],
    ).toBeVisible();
    expect(deliveryArchiveUrl("PKG-20260813")).toContain("archive.tar");
    expect(deliveryZipArchiveUrl("PKG-20260813")).toContain("archive.zip");
  });

  it("loads signed asset download links for a package", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/assets");

    expect(
      await screen.findByText("交付包数据已同步"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "下载链接" }));

    expect(getDeliveryDownloadLinksMock).toHaveBeenCalledWith("PKG-20260812");
    expect(await screen.findByText("下载链接已生成")).toBeVisible();
    expect(screen.getByText("资产下载链接")).toBeVisible();
    expect(screen.getByText("kitchen-task.mp4")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "下载视频" }),
    ).toHaveAttribute("href", expect.stringContaining("download=1"));
  });

  it("prepares a tracked archive and loads its signed download link", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/assets");

    expect(
      await screen.findByText("交付包数据已同步"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "准备 ZIP" }));

    expect(createDeliveryArchiveTaskMock).toHaveBeenCalledWith(
      "PKG-20260812",
      "zip",
    );
    expect(await screen.findByText("ZIP 归档已准备好")).toBeVisible();
    expect(screen.getByText("ZIP · 已完成")).toBeVisible();
    // 归档完成后，“准备 ZIP”切换为“下载 ZIP”直链
    expect(
      screen.getByRole("link", { name: /下载 ZIP/ }),
    ).toHaveAttribute("href", expect.stringContaining("archive.zip"));
    await user.click(screen.getByRole("button", { name: "归档链接" }));

    expect(getDeliveryArchiveDownloadLinkMock).toHaveBeenCalledWith(
      "PKG-20260812",
      "DAT-20260813-ZIP",
    );
    expect(await screen.findByText("归档下载链接已生成")).toBeVisible();
    expect(screen.getByText("归档下载链接")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "下载归档" }),
    ).toHaveAttribute("href", expect.stringContaining("DAT-20260813-ZIP.zip"));
  });

  it("opens a locked cycle detail with amounts in yuan and no adjustment controls", async () => {
    const user = userEvent.setup();
    const cycleWithItems = {
      id: "PC-20260812",
      businessDate: "2026-08-12",
      status: "locked" as const,
      submissionCount: 1,
      effectiveDurationMs: 60_000,
      effectiveMinutes: 1,
      totalPoints: 12,
      createdByAccountId: "U-ADMIN-01",
      createdByName: "管理员",
      createdAt: 1_786_118_400_000,
      settleDueAt: Date.parse("2026-08-15T08:00:00+08:00"),
      settledAt: null,
      items: [
        {
          id: "PCI-1",
          submissionId: "SUB-1",
          ownerId: "U-COL-01",
          ownerName: "数采人员1",
          teamId: "TEAM-01",
          teamName: "团队1",
          fileName: "kitchen-task.mp4",
          taskId: "TASK-01",
          taskName: "家庭厨房清洁",
          taskSceneName: "厨房",
          thumbnail: {
            url: "http://minio.local/previews/SUB-1/thumbnail.jpg",
            expiresAt: 1_786_209_000_000,
            contentType: "image/jpeg" as const,
          },
          finalScore: 85,
          settlementRatio: 1,
          effectiveDurationMs: 60_000,
          effectiveMinutes: 1,
          invalidDurationMs: 0,
          pointsPerMinute: 12,
          points: 12,
          qualityRevision: 1,
          adjusted: false,
        },
      ],
    };
    listPointCyclesMock.mockResolvedValue([cycleWithItems]);
    renderAdmin("/admin/settlements");

    await user.click(await screen.findByRole("button", { name: "查看条目" }));
    expect(screen.getByText("kitchen-task.mp4")).toBeVisible();
    expect(screen.getByText("家庭厨房清洁")).toBeVisible();
    expect(screen.getAllByText("12.00 元").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("img", { name: "kitchen-task.mp4 缩略图" }),
    ).toHaveAttribute(
      "src",
      "http://minio.local/previews/SUB-1/thumbnail.jpg",
    );
    // 锁定后的周期不允许再编辑：不再提供「调整」入口
    expect(screen.queryByRole("button", { name: "调整" })).not.toBeInTheDocument();
    expect(adjustPointCycleItemMock).not.toHaveBeenCalled();
  });
});
