import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { DemoStoreProvider } from "../../data/DemoStoreContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const promptApi = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../../ai-quality/client/aiQualityApi", () => ({
  getAiQualityPrompt: promptApi.get,
  updateAiQualityPrompt: promptApi.update,
}));

const currentPrompt = {
  id: "VQP-1",
  revision: 1,
  systemPrompt: "你是具身视频质量评估器。",
  contentSha256: "a".repeat(64),
  promptVersion: "qwen_video_qc_prompt_v1",
  ruleVersion: "video_qc_v1",
  outputSchema: "video_qc_result_v2",
  initialModel: "qwen3.7-plus",
  reviewModel: "qwen3.7-flash",
  createdByName: "系统初始化",
  createdAt: Date.parse("2026-08-12T04:00:00.000Z"),
};

function renderAdmin(path: string) {
  window.history.replaceState({}, "", path);
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <DemoStoreProvider currentAccount={admin} accounts={demoAccounts}>
        <PlatformApp initialPath={path} />
      </DemoStoreProvider>
    </IdentityProvider>,
  );
}

describe("administrator rule configuration", () => {
  beforeEach(() => {
    promptApi.get.mockReset().mockResolvedValue(currentPrompt);
    promptApi.update
      .mockReset()
      .mockImplementation(async (systemPrompt: string) => ({
        ...currentPrompt,
        revision: 2,
        systemPrompt,
        createdByName: "平台管理员",
      }));
  });

  it("publishes a new active rule version", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/rules");

    await user.click(
      await screen.findByRole("button", { name: "新建规则版本" }),
    );
    await user.type(screen.getByLabelText("版本名称"), "RULE-2026-09");
    await user.clear(screen.getByLabelText("通过阈值"));
    await user.type(screen.getByLabelText("通过阈值"), "65");
    await user.type(screen.getByLabelText("规则说明"), "九月质量规则");
    await user.click(screen.getByRole("button", { name: "发布规则" }));

    expect(screen.getByText("RULE-2026-09")).toBeVisible();
    expect(screen.getByText("65 分")).toBeVisible();
    expect(screen.getByText("规则版本已发布")).toBeVisible();
  });

  it("edits a label name and enabled state", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/rules");

    const row = (await screen.findByText("家庭厨房")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "编辑" }));
    await user.clear(screen.getByLabelText("标签名称"));
    await user.type(screen.getByLabelText("标签名称"), "家庭烹饪");
    await user.click(screen.getByLabelText("启用标签"));
    await user.click(screen.getByRole("button", { name: "保存标签" }));

    expect(within(row).getByText("家庭烹饪")).toBeVisible();
    expect(within(row).getByText("停用")).toBeVisible();
    expect(screen.getByText("标签已更新")).toBeVisible();
  });

  it("publishes a versioned AI system prompt for future jobs", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/rules");

    expect(await screen.findByText("qwen3.7-plus")).toBeVisible();
    expect(screen.getByText("qwen3.7-flash")).toBeVisible();
    const editor = screen.getByLabelText("AI 系统提示词");
    await user.type(editor, "\n重点检查手部完整性。");
    await user.click(screen.getByRole("button", { name: "发布新版本" }));

    expect(promptApi.update).toHaveBeenCalledWith(
      "你是具身视频质量评估器。\n重点检查手部完整性。",
    );
    expect(
      await screen.findByText("版本 2 已发布，仅影响之后新开始的任务"),
    ).toBeVisible();
  });
});
