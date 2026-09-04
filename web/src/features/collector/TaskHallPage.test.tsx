import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const taskApi = vi.hoisted(() => ({
  listTasksForCollector: vi.fn(),
  getCollectorTask: vi.fn(),
}));

const sceneGuideApi = vi.hoisted(() => ({
  listSceneCategories: vi.fn(),
  listLibrariesByTask: vi.fn(),
  listScenes: vi.fn(),
  createCollectorLibrary: vi.fn(),
  guideTaskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

vi.mock("../../tasks/client/taskApi", () => ({
  listTasksForCollector: taskApi.listTasksForCollector,
  getCollectorTask: taskApi.getCollectorTask,
}));

vi.mock("../../scene-guide/client/sceneGuideApi", () => ({
  listSceneCategories: sceneGuideApi.listSceneCategories,
  listLibrariesByTask: sceneGuideApi.listLibrariesByTask,
  listScenes: sceneGuideApi.listScenes,
  createCollectorLibrary: sceneGuideApi.createCollectorLibrary,
  guideTaskErrorMessage: sceneGuideApi.guideTaskErrorMessage,
}));

const categories = [
  { categoryKey: "family", name: "家庭" },
  { categoryKey: "office", name: "办公室" },
  { categoryKey: "generic", name: "通用" },
];

const tasks = [
  {
    id: "TASK-1",
    title: "家庭厨房补量",
    description: "补量任务",
    sceneName: "家庭-厨房",
    sceneLabelId: null,
    taskType: "scene_type",
    categoryKey: "family",
    targetDurationSeconds: 120 * 60,
    currentDurationSeconds: 60 * 60,
    normalizedRequirements: null,
    pricePerHour: 20,
    status: "published",
    revision: 2,
    publishedAt: 0,
  },
  {
    id: "TASK-2",
    title: "通用采集",
    description: "通用任务",
    sceneName: "通用",
    sceneLabelId: null,
    taskType: "generic",
    categoryKey: null,
    targetDurationSeconds: null,
    currentDurationSeconds: 0,
    normalizedRequirements: null,
    pricePerHour: 20,
    status: "published",
    revision: 1,
    publishedAt: 0,
  },
];

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
    taskApi.listTasksForCollector.mockResolvedValue(tasks);
    taskApi.getCollectorTask.mockRejectedValue(new Error("unavailable"));
    sceneGuideApi.listSceneCategories.mockResolvedValue(categories);
    sceneGuideApi.listLibrariesByTask.mockResolvedValue([]);
    sceneGuideApi.listScenes.mockResolvedValue([
      { id: "SC-001", name: "厨房", categoryKey: "family", description: "", enabled: true, updatedAt: 0 },
    ]);
  });

  it("renders task cards grouped by category", async () => {
    renderHall();
    expect(await screen.findByText("家庭厨房补量")).toBeInTheDocument();
    expect(screen.getByText("通用采集")).toBeInTheDocument();
    expect(screen.getByText("家庭")).toBeInTheDocument();
    expect(screen.getAllByText("通用").length).toBeGreaterThan(0);
  });

  it("shows the progress percentage for a target task", async () => {
    renderHall();
    // 60 分钟 / 120 分钟 = 50%
    expect(await screen.findByText("50%")).toBeInTheDocument();
  });

  it("navigates to scene selection on 去采集", async () => {
    const user = userEvent.setup();
    renderHall();
    await screen.findByText("家庭厨房补量");
    await user.click(
      screen.getAllByRole("button", { name: /去采集/ })[0]!,
    );
    expect(window.location.pathname).toBe("/collector/tasks/TASK-1/scenes");
  });

  it("opens the task detail modal on 查看详情", async () => {
    const user = userEvent.setup();
    renderHall();
    await screen.findByText("家庭厨房补量");
    await user.click(
      screen.getAllByRole("button", { name: /查看详情/ })[0]!,
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("家庭厨房补量").length).toBeGreaterThan(0);
  });
});
