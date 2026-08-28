import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import {
  createSceneClassification,
  createSceneLevel1,
  createSceneLibrary,
  deleteSceneLevel1,
  deleteSceneLibrary,
  listLevel1Scenes,
  listSceneClassification,
  listSceneLibrary,
  updateSceneLibrary,
} from "../../scene-system/client/sceneSystemApi";

const sceneApi = vi.hoisted(() => ({
  listLevel1Scenes: vi.fn(),
  listSceneClassification: vi.fn(),
  listSceneLibrary: vi.fn(),
  createSceneLevel1: vi.fn(),
  updateSceneLevel1: vi.fn(),
  deleteSceneLevel1: vi.fn(),
  createSceneClassification: vi.fn(),
  updateSceneClassification: vi.fn(),
  deleteSceneClassification: vi.fn(),
  createSceneLibrary: vi.fn(),
  updateSceneLibrary: vi.fn(),
  deleteSceneLibrary: vi.fn(),
}));

vi.mock("../../scene-system/client/sceneSystemApi", () => ({
  listLevel1Scenes: sceneApi.listLevel1Scenes,
  createSceneLevel1: sceneApi.createSceneLevel1,
  updateSceneLevel1: sceneApi.updateSceneLevel1,
  deleteSceneLevel1: sceneApi.deleteSceneLevel1,
  listSceneClassification: sceneApi.listSceneClassification,
  listSceneLibrary: sceneApi.listSceneLibrary,
  createSceneClassification: sceneApi.createSceneClassification,
  updateSceneClassification: sceneApi.updateSceneClassification,
  deleteSceneClassification: sceneApi.deleteSceneClassification,
  createSceneLibrary: sceneApi.createSceneLibrary,
  updateSceneLibrary: sceneApi.updateSceneLibrary,
  deleteSceneLibrary: sceneApi.deleteSceneLibrary,
}));

const level1 = [
  { id: "L1-F01", code: "F01", name: "家庭", categoryKey: "family", description: "家庭场景", sortOrder: 10, enabled: true, level2Count: 2, libraryCount: 1, updatedAt: 0 },
  { id: "L1-O01", code: "O01", name: "办公室", categoryKey: "office", description: "办公室场景", sortOrder: 20, enabled: true, level2Count: 1, libraryCount: 0, updatedAt: 0 },
  { id: "L1-W01", code: "W01", name: "工厂", categoryKey: "factory", description: "工厂场景", sortOrder: 30, enabled: true, level2Count: 0, libraryCount: 0, updatedAt: 0 },
  { id: "L1-G01", code: "G01", name: "通用", categoryKey: "generic", description: "通用任务", sortOrder: 40, enabled: true, level2Count: 0, libraryCount: 0, updatedAt: 0 },
];

const classification = [
  { id: "SC-001", level1Code: "F01", level1Name: "家庭", level2Name: "厨房", description: "备餐炒菜", enabled: true, updatedAt: 0 },
  { id: "SC-002", level1Code: "F01", level1Name: "家庭", level2Name: "客厅", description: "整理清洁", enabled: true, updatedAt: 0 },
  { id: "SC-006", level1Code: "O01", level1Name: "办公室", level2Name: "工位", description: "桌面整理", enabled: true, updatedAt: 0 },
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
    sceneApi.listLevel1Scenes.mockReset().mockResolvedValue(level1);
    sceneApi.listSceneClassification
      .mockReset()
      .mockResolvedValue(classification);
    sceneApi.listSceneLibrary.mockReset().mockResolvedValue([
      {
        id: "SL-001",
        name: "采集员A家",
        categoryKey: "family",
        categoryName: "家庭",
        subScenes: [{ id: "SC-001", level2Name: "厨房", level1Code: "F01" }],
        subSceneIds: ["SC-001"],
        description: "采集员A的家庭",
        enabled: true,
        createdByName: "管理员",
        updatedAt: 0,
      },
    ]);
  });

  it("renders the scene classification grouped by level-1 and the scene library", async () => {
    renderAdmin();
    expect(
      await screen.findByRole("heading", { level: 1, name: "场景体系" }),
    ).toBeInTheDocument();

    // 一级场景卡片 + 分类表分组
    expect(screen.getAllByText("F01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("家庭").length).toBeGreaterThan(0);
    expect(screen.getAllByText("厨房").length).toBeGreaterThan(0);
    expect(screen.getAllByText("客厅").length).toBeGreaterThan(0);
    expect(screen.getAllByText("O01").length).toBeGreaterThan(0);
    expect(screen.getAllByText("工位").length).toBeGreaterThan(0);

    // 场景库表格
    expect(screen.getByText("采集员A家")).toBeInTheDocument();
  });

  it("creates a library scene with category and sub-scenes", async () => {
    const user = userEvent.setup();
    sceneApi.createSceneLibrary.mockReset().mockResolvedValue({
      id: "SL-002",
      name: "采集员B家",
      categoryKey: "family",
      categoryName: "家庭",
      subScenes: [
        { id: "SC-001", level2Name: "厨房", level1Code: "F01" },
        { id: "SC-002", level2Name: "客厅", level1Code: "F01" },
      ],
      subSceneIds: ["SC-001", "SC-002"],
      description: "",
      enabled: true,
      createdByName: "管理员",
      updatedAt: 0,
    });
    renderAdmin();
    await screen.findByText("采集员A家");

    await user.click(screen.getByRole("button", { name: "新增场景" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/场景名称/), "采集员B家");
    await user.click(within(dialog).getByLabelText("厨房"));
    await user.click(within(dialog).getByLabelText("客厅"));
    await user.click(within(dialog).getByRole("button", { name: "新增" }));

    expect(createSceneLibrary).toHaveBeenCalledWith({
      name: "采集员B家",
      categoryKey: "family",
      subSceneIds: ["SC-001", "SC-002"],
      description: "",
    });
    expect(await screen.findByText("采集员B家")).toBeVisible();
  });

  it("creates a second-level scene under a level-1 code", async () => {
    const user = userEvent.setup();
    sceneApi.createSceneClassification.mockReset().mockResolvedValue({
      id: "SC-099",
      level1Code: "O01",
      level1Name: "办公室",
      level2Name: "库房",
      description: "出入库管理",
      enabled: true,
      updatedAt: 0,
    });
    renderAdmin();
    await screen.findByText("采集员A家");

    await user.click(
      screen.getAllByRole("button", { name: "新增二级场景" })[0]!,
    );
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/一级场景/), "O01");
    await user.type(within(dialog).getByLabelText(/二级场景名称/), "库房");
    await user.type(within(dialog).getByLabelText(/场景描述/), "出入库管理");
    await user.click(within(dialog).getByRole("button", { name: "新增" }));

    expect(createSceneClassification).toHaveBeenCalledWith({
      level1Code: "O01",
      level2Name: "库房",
      description: "出入库管理",
    });
    expect(await screen.findByText("库房")).toBeVisible();
  });

  it("deletes a library scene after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    sceneApi.deleteSceneLibrary.mockReset().mockResolvedValue({ deleted: true });
    renderAdmin();
    await screen.findByText("采集员A家");

    await user.click(
      within(screen.getByText("采集员A家").closest("tr")!).getByRole("button", {
        name: "删除",
      }),
    );
    expect(confirmSpy).toHaveBeenCalledWith(
      "确认删除场景「采集员A家」？",
    );

    await waitFor(() => {
      expect(deleteSceneLibrary).toHaveBeenCalledWith("SL-001");
    });
    expect(await screen.findByText("场景已删除")).toBeVisible();
    confirmSpy.mockRestore();
  });

  it("creates a level-1 scene which auto-creates a pricing category", async () => {
    const user = userEvent.setup();
    sceneApi.createSceneLevel1.mockReset().mockResolvedValue({
      id: "L1-H01",
      code: "H01",
      name: "医院",
      categoryKey: "h01",
      description: "医院场景",
      sortOrder: 50,
      enabled: true,
      level2Count: 0,
      libraryCount: 0,
      updatedAt: 0,
    });
    renderAdmin();
    await screen.findByText("采集员A家");

    await user.click(screen.getByRole("button", { name: "新增一级场景" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/一级编码/), "H01");
    await user.type(within(dialog).getByLabelText(/一级场景名称/), "医院");
    await user.type(within(dialog).getByLabelText(/描述/), "医院场景");
    await user.click(within(dialog).getByRole("button", { name: "新增" }));

    expect(createSceneLevel1).toHaveBeenCalledWith({
      code: "H01",
      name: "医院",
      description: "医院场景",
    });
    expect((await screen.findAllByText("医院")).length).toBeGreaterThan(0);
  });

  it("deletes a level-1 scene after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    sceneApi.deleteSceneLevel1.mockReset().mockResolvedValue({ deleted: true });
    renderAdmin();
    await screen.findByText("采集员A家");

    const officeCard = screen.getAllByText("办公室")[0]!.closest(
      ".scene-level1-card",
    ) as HTMLElement;
    await user.click(
      within(officeCard).getByRole("button", { name: "删除" }),
    );
    expect(confirmSpy).toHaveBeenCalledWith(
      "确认删除一级场景「O01 办公室」？其计费大类将一并删除。",
    );

    await waitFor(() => {
      expect(deleteSceneLevel1).toHaveBeenCalledWith("L1-O01");
    });
    confirmSpy.mockRestore();
  });

  it("filters the classification table by search text", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText("采集员A家");

    await user.type(screen.getByLabelText("搜索二级场景"), "厨房");
    expect(screen.getAllByText("厨房").length).toBeGreaterThan(0);
    // 不匹配的二级场景被过滤（客厅/工位不包含"厨房"字样）
    expect(screen.queryByText("客厅")).not.toBeInTheDocument();
    expect(screen.queryByText("工位")).not.toBeInTheDocument();
  });

  it("switches the scene library tab to filter by level-1 category", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText("采集员A家");

    // 初始"全部"：展示现有场景
    expect(screen.getByText("采集员A家")).toBeInTheDocument();
    // 切到"办公室"Tab：家庭场景被过滤
    await user.click(screen.getByRole("tab", { name: /办公室/ }));
    expect(screen.queryByText("采集员A家")).not.toBeInTheDocument();
    expect(screen.getByText(/当前条件下没有场景/)).toBeInTheDocument();
  });
});
