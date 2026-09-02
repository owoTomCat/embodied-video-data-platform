import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const guideApi = vi.hoisted(() => ({
  listAllGuideTasks: vi.fn(),
  reviewGuideTask: vi.fn(),
  guideTaskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

vi.mock("../../scene-guide/client/sceneGuideApi", () => ({
  listAllGuideTasks: guideApi.listAllGuideTasks,
  reviewGuideTask: guideApi.reviewGuideTask,
  guideTaskErrorMessage: guideApi.guideTaskErrorMessage,
}));

const inReviewTask = {
  id: "GT-1",
  sceneTypeTaskId: "TASK-SCENE-1",
  ownerAccountId: "U-COL-01",
  photoRefs: [],
  envObjects: [{ name: "灶台", category: "appliance" }],
  taskCard: {
    target_objects: [{ name: "灶台", action: "烧水" }],
    steps: ["进入厨房", "打开燃气", "烧水", "关火"],
    end_condition: "完成烧水并关火",
    success_criteria: ["全程第一人称"],
    fail_criteria: ["画面遮挡"],
  },
  visionModel: "qwen-vl-max",
  cardPromptVersion: "scene_guide_v1",
  status: "in_review",
  editedAt: Date.now(),
  submissionId: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function renderPage() {
  window.history.replaceState({}, "", "/admin/guide-tasks");
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath="/admin/guide-tasks" />
    </IdentityProvider>,
  );
}

describe("GuideTaskReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guideApi.listAllGuideTasks.mockResolvedValue([inReviewTask]);
  });

  it("renders an in-review guide task with the card", async () => {
    renderPage();
    expect(await screen.findByText("指导任务卡审核")).toBeInTheDocument();
    expect(screen.getAllByText("灶台").length).toBeGreaterThan(0);
    expect(screen.getAllByText("待审核").length).toBeGreaterThan(0);
    expect(screen.getByText("结束条件：完成烧水并关火")).toBeInTheDocument();
  });

  it("approves the guide task", async () => {
    guideApi.reviewGuideTask.mockResolvedValue({ ...inReviewTask, status: "approved" });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("指导任务卡审核");
    await user.click(screen.getAllByRole("button", { name: /通过/ })[1]!);
    expect((await screen.findAllByText("已通过")).length).toBeGreaterThan(0);
    expect(guideApi.reviewGuideTask).toHaveBeenCalledWith(
      "GT-1",
      expect.objectContaining({ decision: "approved" }),
    );
  });

  it("rejects the guide task", async () => {
    guideApi.reviewGuideTask.mockResolvedValue({ ...inReviewTask, status: "rejected" });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("指导任务卡审核");
    await user.click(screen.getAllByRole("button", { name: /驳回/ })[1]!);
    expect((await screen.findAllByText("已驳回")).length).toBeGreaterThan(0);
  });
});
