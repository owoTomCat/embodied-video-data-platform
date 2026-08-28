import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const taskApi = vi.hoisted(() => ({
  listManage: vi.fn(),
  create: vi.fn(),
  delete: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
  publish: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  close: vi.fn(),
  normalize: vi.fn(),
  listTaskTypeCatalog: vi.fn(),
}));

vi.mock("../../tasks/client/taskApi", () => ({
  listManageTasks: taskApi.listManage,
  createTask: taskApi.create,
  deleteTask: taskApi.delete,
  updateTask: taskApi.update,
  confirmTaskRequirements: taskApi.confirm,
  publishTask: taskApi.publish,
  pauseTask: taskApi.pause,
  resumeTask: taskApi.resume,
  closeTask: taskApi.close,
  normalizeTaskRequirements: taskApi.normalize,
  listTaskTypeCatalog: taskApi.listTaskTypeCatalog,
  taskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

const aiQualityApi = vi.hoisted(() => ({
  getLabelSet: vi.fn(),
}));

vi.mock("../../ai-quality/client/aiQualityApi", () => ({
  getLabelSet: aiQualityApi.getLabelSet,
}));

const scenePricingApi = vi.hoisted(() => ({
  listSceneCategoryPricing: vi.fn(),
  updateSceneCategoryPrice: vi.fn(),
}));

vi.mock("../../scene-pricing/client/scenePricingApi", () => ({
  listSceneCategoryPricing: scenePricingApi.listSceneCategoryPricing,
  updateSceneCategoryPrice: scenePricingApi.updateSceneCategoryPrice,
}));

const sceneSystemApi = vi.hoisted(() => ({
  listSceneLibrary: vi.fn(),
}));

vi.mock("../../scene-system/client/sceneSystemApi", () => ({
  listSceneLibrary: sceneSystemApi.listSceneLibrary,
}));

const draftTask = {
  id: "TASK-draft1",
  title: "厨房数据采集",
  description: "",
  sceneName: "家庭厨房",
  sceneLabelId: null,
  taskType: "preset",
  rawRequirements: "第一人称，出现双手",
  normalizedRequirements: null,
  normalizationStatus: "pending",
  pricePointsPerMinute: 15.5,
  status: "draft",
  revision: 1,
  createdByName: "管理员",
  publishedAt: null,
  pausedAt: null,
  closedAt: null,
  createdAt: 1_780_000_000_000,
  updatedAt: 1_780_000_000_000,
};

const publishedTask = {
  ...draftTask,
  id: "TASK-pub1",
  title: "客厅数据采集",
  sceneName: "家庭客厅",
  sceneLabelId: "SCENE-002",
  rawRequirements: "第一人称，出现双手",
  normalizedRequirements: {
    scene_description: "客厅场景",
    requirements: [{ type: "hard", content: "必须出现双手操作" }],
    quality_notes: [],
  },
  normalizationStatus: "ready",
  status: "published",
  publishedAt: 1_780_000_100_000,
};

function renderAdmin() {
  window.history.replaceState({}, "", "/admin/tasks");
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath="/admin/tasks" />
    </IdentityProvider>,
  );
}

describe("TasksPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskApi.listManage.mockResolvedValue({
      tasks: [draftTask, publishedTask],
      pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
    });
    aiQualityApi.getLabelSet.mockResolvedValue({
      id: "LSV-1",
      revision: 1,
      version: "LABELS-REV-1",
      labels: [
        { id: "SCENE-001", name: "家庭厨房", type: "scene", associationCount: 0, enabled: true },
        { id: "SCENE-002", name: "家庭客厅", type: "scene", associationCount: 0, enabled: true },
      ],
      active: true,
      createdByAccountId: "u1",
      createdByName: "管理员",
      createdAt: 0,
    });
    scenePricingApi.listSceneCategoryPricing.mockResolvedValue([
      { categoryKey: "family", name: "家庭", pricePerHour: 20, description: "", updatedAt: 0 },
      { categoryKey: "office", name: "办公室", pricePerHour: 25, description: "", updatedAt: 0 },
      { categoryKey: "factory", name: "工厂", pricePerHour: 30, description: "", updatedAt: 0 },
      { categoryKey: "generic", name: "通用", pricePerHour: 20, description: "", updatedAt: 0 },
    ]);
    sceneSystemApi.listSceneLibrary.mockResolvedValue([
      {
        id: "SL-001",
        name: "采集员A家",
        categoryKey: "family",
        categoryName: "家庭",
        subScenes: [{ id: "SC-001", level2Name: "厨房", level1Code: "F01" }],
        subSceneIds: ["SC-001"],
        description: "",
        enabled: true,
        createdByName: "管理员",
        updatedAt: 0,
      },
    ]);
    taskApi.listTaskTypeCatalog.mockResolvedValue({
      presetScenes: [
        {
          key: "family-kitchen",
          name: "家庭-厨房",
          tagline: "做饭备餐等厨房操作",
          defaultTitle: "家庭厨房备餐做饭数据采集",
          description: "采集家庭厨房中的真实操作。",
          requirements: ["必须使用第一人称视角拍摄。", "双手全程可见。"],
          qualityNotes: ["场景边界：家庭厨房。"],
        },
        {
          key: "family-living",
          name: "家庭-客厅",
          tagline: "整理清洁等客厅操作",
          defaultTitle: "家庭客厅整理清洁数据采集",
          description: "采集家庭客厅中的真实操作。",
          requirements: ["必须使用第一人称视角拍摄。"],
          qualityNotes: ["场景边界：家庭客厅。"],
        },
      ],
      generic: {
        sceneName: "通用",
        defaultTitle: "通用任务：不限场景的具身操作采集",
        description: "通用任务说明。",
        requirements: ["必须使用第一人称视角拍摄。"],
      },
    });
  });

  it("renders the task list with status and price", async () => {
    renderAdmin();
    expect(await screen.findByText("厨房数据采集")).toBeInTheDocument();
    expect(screen.getByText("客厅数据采集")).toBeInTheDocument();
    expect(screen.getAllByText("草稿").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已发布").length).toBeGreaterThan(0);
    expect(screen.getAllByText("15.5 元/小时").length).toBeGreaterThan(0);
    expect(screen.getByText("共 2 个任务")).toBeInTheDocument();
  });

  it("opens the create form and creates a task", async () => {
    const user = userEvent.setup();
    taskApi.create.mockResolvedValue({ ...draftTask, title: "新任务" });
    renderAdmin();
    await screen.findByText("厨房数据采集");

    await user.click(screen.getByRole("button", { name: "创建任务" }));
    // 创建模式默认选中「通用任务」并自动带出模板内容与场景大类默认价（通用 20 元/小时）
    expect(screen.getByLabelText(/任务标题/)).toHaveValue(
      "通用任务：不限场景的具身操作采集",
    );
    expect(screen.getByLabelText(/每小时单价/)).toHaveValue(20);
    // 切到自定义后自行填写场景与要求
    await user.click(screen.getByRole("button", { name: /自定义任务/ }));
    const titleInput = screen.getByLabelText(/任务标题/);
    await user.clear(titleInput);
    await user.type(titleInput, "新任务");
    await user.type(screen.getByLabelText(/场景名称/), "户外街道");
    const requirementsInput = screen.getByLabelText(/任务要求/);
    await user.clear(requirementsInput);
    await user.type(requirementsInput, "第一人称拍摄");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(taskApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "新任务",
          sceneName: "户外街道",
          taskType: "custom",
          rawRequirements: "第一人称拍摄",
          pricePointsPerMinute: null,
        }),
      );
    });
  });

  it("opens the edit form with the selected task values", async () => {
    const user = userEvent.setup();
    taskApi.update.mockResolvedValue({ ...draftTask, title: "厨房采集更新版" });
    renderAdmin();
    await screen.findByText("厨房数据采集");

    await user.click(screen.getAllByRole("button", { name: "编辑" })[0]!);
    expect(screen.getByRole("heading", { name: "编辑采集任务" })).toBeInTheDocument();
    const titleInput = screen.getByLabelText(/任务标题/);
    expect(titleInput).toHaveValue("厨房数据采集");
    expect(screen.getByText(/场景库场景 · 家庭厨房/)).toBeInTheDocument();

    await user.clear(titleInput);
    await user.type(titleInput, "厨房采集更新版");
    await user.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(taskApi.update).toHaveBeenCalledWith(
        "TASK-draft1",
        expect.objectContaining({ title: "厨房采集更新版" }),
      );
    });
  });

  it("deletes a draft task after explicit confirmation", async () => {
    const user = userEvent.setup();
    taskApi.delete.mockResolvedValue(undefined);
    renderAdmin();
    await screen.findByText("厨房数据采集");

    await user.click(
      screen.getByRole("button", { name: "删除任务 厨房数据采集" }),
    );
    expect(screen.getByRole("heading", { name: "删除草稿任务" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(taskApi.delete).toHaveBeenCalledWith("TASK-draft1");
    });
    expect(screen.queryByText("厨房数据采集")).not.toBeInTheDocument();
  });

  it("clears an unfinished create form after closing it", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText("厨房数据采集");

    await user.click(screen.getByRole("button", { name: "创建任务" }));
    const titleInput = screen.getByLabelText(/任务标题/);
    await user.clear(titleInput);
    await user.type(titleInput, "未保存任务");
    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    // 重新打开后恢复为通用任务模板默认标题
    expect(screen.getByLabelText(/任务标题/)).toHaveValue(
      "通用任务：不限场景的具身操作采集",
    );
  });

  it("opens the normalize modal and confirms AI requirements", async () => {
    const user = userEvent.setup();
    taskApi.normalize.mockResolvedValue({
      scene_description: "厨房场景描述",
      requirements: [
        { type: "hard", content: "必须出现双手操作" },
        { type: "soft", content: "光线充足" },
      ],
      quality_notes: [],
    });
    taskApi.confirm.mockResolvedValue({
      ...draftTask,
      normalizationStatus: "ready",
      normalizedRequirements: {
        scene_description: "厨房场景描述",
        requirements: [{ type: "hard", content: "必须出现双手操作" }],
        quality_notes: [],
      },
    });
    renderAdmin();
    await screen.findByText("厨房数据采集");

    await user.click(screen.getByRole("button", { name: "规范化" }));
    expect(await screen.findByText("AI 要求规范化 · 厨房数据采集")).toBeInTheDocument();

    await waitFor(() => {
      expect(taskApi.normalize).toHaveBeenCalledWith("TASK-draft1");
    });
    expect(await screen.findByDisplayValue("必须出现双手操作")).toBeInTheDocument();

    const firstRequirement = screen.getByLabelText("第 1 条要求内容");
    await user.clear(firstRequirement);
    await user.type(firstRequirement, "必须完整拍摄操作流程");
    expect(firstRequirement).toHaveValue("必须完整拍摄操作流程");

    await user.click(screen.getByRole("button", { name: "确认并保存" }));
    await waitFor(() => {
      expect(taskApi.confirm).toHaveBeenCalledWith("TASK-draft1", {
        scene_description: "厨房场景描述",
        requirements: [
          { type: "hard", content: "必须完整拍摄操作流程" },
          { type: "soft", content: "光线充足" },
        ],
        quality_notes: [],
      });
    });
  });

  it("publishes a task after confirming requirements", async () => {
    const user = userEvent.setup();
    taskApi.publish.mockResolvedValue({ ...draftTask, status: "published" });
    renderAdmin();
    await screen.findByText("厨房数据采集");

    await user.click(screen.getByRole("button", { name: "发布" }));
    expect(screen.getByRole("heading", { name: "发布采集任务" })).toBeInTheDocument();
    expect(taskApi.publish).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认发布" }));
    await waitFor(() => {
      expect(taskApi.publish).toHaveBeenCalledWith("TASK-draft1");
    });
  });
});
