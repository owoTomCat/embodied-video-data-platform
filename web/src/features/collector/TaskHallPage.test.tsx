import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const sceneGuideApi = vi.hoisted(() => ({
  listSceneCategories: vi.fn(),
  listLibrariesByCategory: vi.fn(),
  listScenes: vi.fn(),
  createCollectorLibrary: vi.fn(),
  deleteCollectorLibrary: vi.fn(),
  getGuidePhotoUrl: vi.fn(),
  getCollectorLibrary: vi.fn(),
  guideTaskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

vi.mock("../../scene-guide/client/sceneGuideApi", () => ({
  listSceneCategories: sceneGuideApi.listSceneCategories,
  listLibrariesByCategory: sceneGuideApi.listLibrariesByCategory,
  listScenes: sceneGuideApi.listScenes,
  createCollectorLibrary: sceneGuideApi.createCollectorLibrary,
  deleteCollectorLibrary: sceneGuideApi.deleteCollectorLibrary,
  getGuidePhotoUrl: sceneGuideApi.getGuidePhotoUrl,
  getCollectorLibrary: sceneGuideApi.getCollectorLibrary,
  guideTaskErrorMessage: sceneGuideApi.guideTaskErrorMessage,
}));

const categories = [
  { categoryKey: "family", name: "家庭" },
  { categoryKey: "office", name: "办公室" },
];

const kitchenLibrary = {
  id: "SL-1",
  name: "我家厨房",
  categoryKey: "family",
  categoryName: "家庭",
  sceneId: "SC-001",
  scene: { id: "SC-001", name: "厨房", categoryKey: "family" },
  collectionTaskId: null,
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
    sceneGuideApi.listSceneCategories.mockResolvedValue(categories);
    sceneGuideApi.listLibrariesByCategory.mockResolvedValue([kitchenLibrary]);
    sceneGuideApi.listScenes.mockResolvedValue([
      { id: "SC-001", name: "厨房", categoryKey: "family", description: "", enabled: true, updatedAt: 0 },
    ]);
    sceneGuideApi.getGuidePhotoUrl.mockResolvedValue({ url: "http://minio.local/cover", expiresAt: 0 });
    sceneGuideApi.getCollectorLibrary.mockResolvedValue({ ...kitchenLibrary, tasks: [] });
  });

  it("renders scene categories and the active category's libraries", async () => {
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
    await user.selectOptions(await screen.findByLabelText("场景（单选）"), "SC-001");
    await user.click(screen.getByRole("button", { name: /创建场景库/ }));
    expect(sceneGuideApi.createCollectorLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ name: "我家卧室", sceneId: "SC-001" }),
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
