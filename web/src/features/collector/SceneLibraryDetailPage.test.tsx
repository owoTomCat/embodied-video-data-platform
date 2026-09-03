import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const guideApi = vi.hoisted(() => ({
  getCollectorLibrary: vi.fn(),
  getGuideTask: vi.fn(),
  guideTaskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

const taskApi = vi.hoisted(() => ({
  listTasksForCollector: vi.fn(),
}));

const submissionApi = vi.hoisted(() => ({
  listActiveUploads: vi.fn(),
}));

vi.mock("../../scene-guide/client/sceneGuideApi", () => ({
  getCollectorLibrary: guideApi.getCollectorLibrary,
  getGuideTask: guideApi.getGuideTask,
  guideTaskErrorMessage: guideApi.guideTaskErrorMessage,
}));

vi.mock("../../tasks/client/taskApi", () => ({
  listTasksForCollector: taskApi.listTasksForCollector,
}));

vi.mock("../../submissions/client/submissionApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../submissions/client/submissionApi")>();
  return {
    ...actual,
    listActiveUploads: submissionApi.listActiveUploads,
  };
});

const guideTask = {
  id: "GT-1",
  sceneTypeTaskId: null,
  sceneLibraryId: "SL-1",
  ownerAccountId: "U-COL-01",
  title: "把罐头放到锅里",
  taskIndex: 0,
  photoRefs: [],
  envObjects: [{ name: "罐头", category: "object" }],
  taskCard: {
    title: "把罐头放到锅里",
    target_objects: [{ name: "罐头", action: "倒料" }],
    steps: ["取物", "开罐", "倒料"],
    end_condition: "倒料归位",
    success_criteria: ["第一人称"],
    fail_criteria: ["遮挡"],
  },
  visionModel: "qwen-vl-max",
  cardPromptVersion: "scene_guide_v1",
  status: "approved",
  editedAt: null,
  submissionId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function renderPage() {
  window.history.replaceState({}, "", "/collector/scenes/SL-1");
  const collector = accountForRole("collector");
  return render(
    <IdentityProvider currentAccount={collector} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath="/collector/scenes/SL-1" />
    </IdentityProvider>,
  );
}

describe("SceneLibraryDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskApi.listTasksForCollector.mockResolvedValue([]);
    submissionApi.listActiveUploads.mockResolvedValue([]);
    guideApi.getCollectorLibrary.mockResolvedValue({
      id: "SL-1",
      name: "我家厨房",
      categoryKey: "family",
      categoryName: "家庭",
      subSceneIds: ["SC-001"],
      subScenes: [{ id: "SC-001", name: "厨房", categoryKey: "family" }],
      description: "",
      enabled: true,
      ownerAccountId: "U-COL-01",
      taskCount: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tasks: [guideTask],
    });
  });

  it("renders the library task cards and navigates to create page", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("我家厨房")).toBeInTheDocument();
    expect(screen.getAllByText("把罐头放到锅里").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /拍照创建任务/ }));
    expect(window.location.pathname).toBe("/collector/scenes/SL-1/create");
  });

  it("goes to upload with the guide task preselected", async () => {
    guideApi.getGuideTask.mockResolvedValue(guideTask);
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("把罐头放到锅里");
    await user.click(screen.getByRole("button", { name: /去采集/ }));
    expect(window.location.pathname).toBe("/collector/upload");
  });
});
