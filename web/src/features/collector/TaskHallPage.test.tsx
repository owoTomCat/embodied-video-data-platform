import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const taskApi = vi.hoisted(() => ({
  listTasksForCollector: vi.fn(),
}));

const sceneApi = vi.hoisted(() => ({
  getSceneProgress: vi.fn(),
}));

vi.mock("../../tasks/client/taskApi", () => ({
  listTasksForCollector: taskApi.listTasksForCollector,
  taskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

vi.mock("../../scene-system/client/sceneSystemApi", () => ({
  getSceneProgress: sceneApi.getSceneProgress,
}));

const publishedTask = {
  id: "TASK-1",
  title: "厨房数据采集",
  description: "拍摄厨房场景操作视频",
  sceneName: "家庭厨房",
  sceneLabelId: "SCENE-001",
  normalizedRequirements: {
    scene_description: "家庭厨房场景，第一人称双手操作。",
    requirements: [
      { type: "hard", content: "必须全程第一人称视角拍摄" },
      { type: "soft", content: "光线充足画面清晰" },
    ],
    quality_notes: [],
  },
  pricePointsPerMinute: 15.5,
  status: "published",
  revision: 1,
  publishedAt: Date.now(),
};

const pausedTask = {
  ...publishedTask,
  id: "TASK-2",
  title: "户外街道数据采集",
  sceneName: "户外街道",
  status: "paused",
};

function renderHall() {
  window.history.replaceState({}, "", "/collector/tasks");
  const collector = accountForRole("collector");
  return render(
    <IdentityProvider
      currentAccount={collector}
      accounts={demoAccounts}
      teams={[]}
    >
      <PlatformApp initialPath="/collector/tasks" />
    </IdentityProvider>,
  );
}

describe("TaskHallPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskApi.listTasksForCollector.mockResolvedValue([publishedTask, pausedTask]);
    sceneApi.getSceneProgress.mockResolvedValue([]);
  });

  it("renders published and paused tasks with requirements", async () => {
    renderHall();
    expect(await screen.findByText("厨房数据采集")).toBeInTheDocument();
    expect(screen.getByText("户外街道数据采集")).toBeInTheDocument();
    expect(screen.getByText("场景：家庭厨房")).toBeInTheDocument();
    expect(screen.getAllByText("15.5 元/小时").length).toBeGreaterThan(0);
    expect(screen.getAllByText("必须全程第一人称视角拍摄").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已暂停").length).toBeGreaterThan(0);
  });

  it("navigates to the upload page with the selected task for a published task", async () => {
    const user = userEvent.setup();
    renderHall();
    await screen.findByText("厨房数据采集");

    const goButtons = screen.getAllByRole("button", { name: "去采集" });
    expect(goButtons).toHaveLength(1);
    await user.click(goButtons[0]!);

    expect(window.location.pathname).toBe("/collector/upload");
  });

  it("disables collection for paused tasks", async () => {
    renderHall();
    await screen.findByText("厨房数据采集");

    const pausedButton = screen.getByRole("button", { name: /已暂停/ });
    expect(pausedButton).toBeDisabled();
  });

  it("shows an empty state when no tasks are available", async () => {
    taskApi.listTasksForCollector.mockResolvedValue([]);
    renderHall();
    expect(
      await screen.findByText("暂无进行中的任务"),
    ).toBeInTheDocument();
  });

  it("shows scene progress for scene_type tasks and a gap panel", async () => {
    const sceneTask = {
      ...publishedTask,
      id: "TASK-SCENE",
      title: "家庭厨房场景采集",
      sceneName: "家庭厨房",
      taskType: "scene_type",
      targetDurationSeconds: 3600,
    };
    taskApi.listTasksForCollector.mockResolvedValue([sceneTask]);
    sceneApi.getSceneProgress.mockResolvedValue([
      {
        sceneName: "家庭厨房",
        type: "scene_type",
        currentSeconds: 1200,
        targetSeconds: 3600,
        shortfallSeconds: 2400,
        taskCount: 1,
      },
    ]);

    renderHall();
    expect(await screen.findByText("家庭厨房场景采集")).toBeInTheDocument();
    // 缺口优先面板
    expect(await screen.findByText("场景采集进度")).toBeInTheDocument();
    expect(screen.getByText("需补量")).toBeInTheDocument();
    // 任务卡内的场景进度块
    expect(screen.getByText("本场景采集进度")).toBeInTheDocument();
    expect(screen.getAllByText("1 小时").length).toBeGreaterThan(0); // 目标 3600s
    expect(screen.getAllByText("20 分钟").length).toBeGreaterThan(0); // 已采 1200s
    expect(screen.getAllByText("40 分钟").length).toBeGreaterThan(0); // 缺口 2400s
  });
});
