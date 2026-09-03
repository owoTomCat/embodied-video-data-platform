import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const sceneGuideApi = vi.hoisted(() => ({
  listSceneLevel1: vi.fn(),
  listLibrariesByCategory: vi.fn(),
  listSceneClassification: vi.fn(),
  createCollectorLibrary: vi.fn(),
  deleteCollectorLibrary: vi.fn(),
  getGuidePhotoUrl: vi.fn(),
  getCollectorLibrary: vi.fn(),
  guideTaskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

vi.mock("../../scene-guide/client/sceneGuideApi", () => ({
  listSceneLevel1: sceneGuideApi.listSceneLevel1,
  listLibrariesByCategory: sceneGuideApi.listLibrariesByCategory,
  listSceneClassification: sceneGuideApi.listSceneClassification,
  createCollectorLibrary: sceneGuideApi.createCollectorLibrary,
  deleteCollectorLibrary: sceneGuideApi.deleteCollectorLibrary,
  getGuidePhotoUrl: sceneGuideApi.getGuidePhotoUrl,
  getCollectorLibrary: sceneGuideApi.getCollectorLibrary,
  guideTaskErrorMessage: sceneGuideApi.guideTaskErrorMessage,
}));

const level1 = [
  { code: "F01", name: "家庭", categoryKey: "family" },
  { code: "O01", name: "办公室", categoryKey: "office" },
];

const kitchenLibrary = {
  id: "SL-1",
  name: "我家厨房",
  categoryKey: "family",
  categoryName: "家庭",
  subSceneIds: ["SC-001"],
  subScenes: [{ id: "SC-001", level2Name: "厨房", level1Code: "F01" }],
  photoRefs: [],
  coverObjectKey: null,
  description: "",
  enabled: true,
  ownerAccountId: "U-COL-01",
  taskCount: 3,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function renderHall() {
  window.history.replaceState({}, "", "/collector/tasks");
  const collector = accountForRole("collector");
  return render(
    <IdentityProvider currentAccount={collector} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath="/collector/tasks" />
    </IdentityProvider>,
  );
}

describe("TaskHallPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sceneGuideApi.listSceneLevel1.mockResolvedValue(level1);
    sceneGuideApi.listLibrariesByCategory.mockResolvedValue([kitchenLibrary]);
    sceneGuideApi.listSceneClassification.mockResolvedValue([
      { id: "SC-001", level1Code: "F01", level1Name: "家庭", level2Name: "厨房", description: "", enabled: true, updatedAt: 0 },
    ]);
    sceneGuideApi.getGuidePhotoUrl.mockResolvedValue({ url: "http://minio.local/cover", expiresAt: 0 });
    sceneGuideApi.getCollectorLibrary.mockResolvedValue({ ...kitchenLibrary, tasks: [] });
  });

  it("renders scene levels and the active category's libraries", async () => {
    renderHall();
    expect((await screen.findAllByText("家庭")).length).toBeGreaterThan(0);
    expect(screen.getByText("办公室")).toBeInTheDocument();
    expect(await screen.findByText("我家厨房")).toBeInTheDocument();
    expect(screen.getByText("3 张任务卡")).toBeInTheDocument();
  });

  it("switches to another category and reloads its libraries", async () => {
    const user = userEvent.setup();
    renderHall();
    await screen.findByText("我家厨房");
    // 切换到大类后返回空库
    sceneGuideApi.listLibrariesByCategory.mockResolvedValue([]);
    await user.click(screen.getByRole("button", { name: /办公室/ }));
    expect(await screen.findByText("该分类下还没有场景库")).toBeInTheDocument();
  });

  it("opens the create modal and creates a library", async () => {
    sceneGuideApi.createCollectorLibrary.mockResolvedValue({
      ...kitchenLibrary,
      id: "SL-NEW",
      name: "我家卧室",
    });
    const user = userEvent.setup();
    renderHall();
    await screen.findByText("我家厨房");
    await user.click(screen.getByRole("button", { name: /拍照新建场景库/ }));
    await user.type(await screen.findByLabelText("场景库名称"), "我家卧室");
    await user.click(screen.getByLabelText("厨房"));
    await user.click(screen.getByRole("button", { name: /创建场景库/ }));
    expect(sceneGuideApi.createCollectorLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ name: "我家卧室", categoryKey: "family" }),
    );
  });

  it("navigates to a library's detail page", async () => {
    const user = userEvent.setup();
    renderHall();
    await screen.findByText("我家厨房");
    await user.click(screen.getByRole("button", { name: /进入场景库/ }));
    expect(window.location.pathname).toBe("/collector/scenes/SL-1");
  });
});
