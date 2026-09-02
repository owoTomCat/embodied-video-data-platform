import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const taskApi = vi.hoisted(() => ({
  listTasksForCollector: vi.fn(),
}));

const guideApi = vi.hoisted(() => ({
  presignPhoto: vi.fn(),
  generateGuideTask: vi.fn(),
  submitEditedCard: vi.fn(),
  listMyGuideTasks: vi.fn(),
  guideTaskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

vi.mock("../../tasks/client/taskApi", () => ({
  listTasksForCollector: taskApi.listTasksForCollector,
}));

vi.mock("../../scene-guide/client/sceneGuideApi", () => ({
  presignPhoto: guideApi.presignPhoto,
  generateGuideTask: guideApi.generateGuideTask,
  submitEditedCard: guideApi.submitEditedCard,
  listMyGuideTasks: guideApi.listMyGuideTasks,
  guideTaskErrorMessage: guideApi.guideTaskErrorMessage,
}));

const sceneTask = {
  id: "TASK-SCENE-1",
  title: "家庭厨房场景采集",
  description: "补量家庭厨房",
  sceneName: "家庭厨房",
  sceneLabelId: null,
  sceneLibraryId: null,
  taskType: "scene_type",
  targetDurationSeconds: 3600,
  normalizedRequirements: {
    scene_description: "家庭厨房环境。",
    requirements: [{ type: "hard", content: "必须第一人称" }],
    quality_notes: [],
  },
  pricePointsPerMinute: null,
  status: "published",
  revision: 1,
  publishedAt: Date.now(),
};

function renderPage() {
  window.history.replaceState({}, "", "/collector/photo-guide");
  const collector = accountForRole("collector");
  return render(
    <IdentityProvider
      currentAccount={collector}
      accounts={demoAccounts}
      teams={[]}
    >
      <PlatformApp initialPath="/collector/photo-guide" />
    </IdentityProvider>,
  );
}

describe("PhotoGuidePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskApi.listTasksForCollector.mockResolvedValue([sceneTask]);
    guideApi.listMyGuideTasks.mockResolvedValue([]);
  });

  it("shows scene tasks to pick and moves to the photo step", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("家庭厨房场景采集")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /下一步/ }));
    expect((await screen.findAllByText("拍摄环境照片")).length).toBeGreaterThan(0);
  });

  it("generates a task card after adding a photo", async () => {
    // 模拟 MinIO 预签名 PUT 成功
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("家庭厨房场景采集");
    await user.click(screen.getByRole("button", { name: /下一步/ }));

    guideApi.presignPhoto.mockResolvedValue({
      objectKey: "scene-guide/X/PHOTO/1/kitchen.jpg",
      url: "http://minio.local/stub?key=1",
      expiresAt: Date.now() + 60_000,
    });
    guideApi.generateGuideTask.mockResolvedValue({
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
      status: "ai_generated",
      editedAt: null,
      submissionId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const input = document.querySelector(
      '.guide-photo-add input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["fake-photo"], "kitchen.jpg", { type: "image/jpeg" });
    await user.upload(input, file);

    // 确认照片已加入为 tile
    expect(await screen.findByAltText("环境照片 1")).toBeInTheDocument();

    const generateButton = await screen.findByRole("button", {
      name: /AI 识别并生成任务卡/,
    });
    await user.click(generateButton);

    expect(guideApi.generateGuideTask).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("任务卡预览")).toBeInTheDocument();
    expect(screen.getAllByText("灶台").length).toBeGreaterThan(0);
    expect(screen.getByText("直接按卡采集")).toBeInTheDocument();
  });
});
