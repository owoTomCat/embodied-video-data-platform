import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import {
  createScene,
  deleteScene,
  listSceneLibrary,
  listScenes,
} from "../../scene-system/client/sceneSystemApi";

const sceneApi = vi.hoisted(() => ({
  listScenes: vi.fn(),
  listSceneLibrary: vi.fn(),
  getSceneInventory: vi.fn(),
  createScene: vi.fn(),
  updateScene: vi.fn(),
  deleteScene: vi.fn(),
}));

const pricingApi = vi.hoisted(() => ({
  listSceneCategoryPricing: vi.fn(),
}));

vi.mock("../../scene-system/client/sceneSystemApi", () => ({
  listScenes: sceneApi.listScenes,
  listSceneLibrary: sceneApi.listSceneLibrary,
  getSceneInventory: sceneApi.getSceneInventory,
  createScene: sceneApi.createScene,
  updateScene: sceneApi.updateScene,
  deleteScene: sceneApi.deleteScene,
}));

vi.mock("../../scene-pricing/client/scenePricingApi", () => ({
  listSceneCategoryPricing: pricingApi.listSceneCategoryPricing,
}));

const categories = [
  { categoryKey: "family", name: "家庭", pricePerHour: 20, description: "", updatedAt: 0 },
  { categoryKey: "office", name: "办公室", pricePerHour: 22, description: "", updatedAt: 0 },
];

const scenes = [
  { id: "SC-001", name: "厨房", categoryKey: "family", description: "备餐炒菜", enabled: true, updatedAt: 0 },
  { id: "SC-006", name: "工位", categoryKey: "office", description: "桌面整理", enabled: true, updatedAt: 0 },
];

function renderAdmin(path = "/admin/scenes") {
  window.history.replaceState({}, "", path);
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath={path} />
    </IdentityProvider>,
  );
}

describe("SceneSystemPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sceneApi.listScenes.mockReset().mockResolvedValue(scenes);
    sceneApi.listSceneLibrary.mockReset().mockResolvedValue([
      {
        id: "SL-001",
        name: "采集员A家",
        categoryKey: "family",
        categoryName: "家庭",
        subScenes: [{ id: "SC-001", name: "厨房", categoryKey: "family" }],
        subSceneIds: ["SC-001"],
        description: "",
        enabled: true,
        createdByName: "管理员",
        updatedAt: 0,
      },
    ]);
    sceneApi.getSceneInventory.mockReset().mockResolvedValue([]);
    pricingApi.listSceneCategoryPricing.mockReset().mockResolvedValue(categories);
  });

  it("renders scenes and the scene library", async () => {
    renderAdmin();
    expect(
      await screen.findByRole("heading", { level: 1, name: "场景体系" }),
    ).toBeInTheDocument();
    expect(screen.getByText("工位")).toBeInTheDocument();
    expect(screen.getByText("采集员A家")).toBeInTheDocument();
  });

  it("creates a scene under a category", async () => {
    const user = userEvent.setup();
    sceneApi.createScene.mockReset().mockResolvedValue({
      id: "SC-099",
      name: "库房",
      categoryKey: "office",
      description: "出入库管理",
      enabled: true,
      updatedAt: 0,
    });
    renderAdmin();
    await screen.findByText("采集员A家");

    await user.click(screen.getByRole("button", { name: "新增场景" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/场景名称/), "库房");
    await user.selectOptions(within(dialog).getByLabelText(/计费大类/), "office");
    await user.click(within(dialog).getByRole("button", { name: "新增" }));

    expect(createScene).toHaveBeenCalledWith({
      name: "库房",
      categoryKey: "office",
      description: "",
    });
    expect(await screen.findByText("库房")).toBeVisible();
  });

  it("deletes a scene after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    sceneApi.deleteScene.mockReset().mockResolvedValue({ deleted: true });
    renderAdmin();
    await screen.findByText("采集员A家");

    await user.click(
      within(screen.getByText("工位").closest("tr")!).getByRole("button", {
        name: "删除",
      }),
    );
    expect(confirmSpy).toHaveBeenCalledWith("确认删除场景「工位」？");

    await waitFor(() => {
      expect(deleteScene).toHaveBeenCalledWith("SC-006");
    });
    confirmSpy.mockRestore();
  });
});
