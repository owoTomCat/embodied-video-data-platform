import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const promptApi = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  getRule: vi.fn(),
  createRule: vi.fn(),
  getScarcityConfig: vi.fn(),
  publishScarcityConfig: vi.fn(),
}));

vi.mock("../../ai-quality/client/aiQualityApi", () => ({
  getAiQualityPrompt: promptApi.get,
  updateAiQualityPrompt: promptApi.update,
  getQualityRule: promptApi.getRule,
  createQualityRule: promptApi.createRule,
  getScarcityConfig: promptApi.getScarcityConfig,
  publishScarcityConfig: promptApi.publishScarcityConfig,
}));

const currentPrompt = {
  id: "VQP-1",
  revision: 1,
  systemPrompt: "你是具身视频质量评估器。",
  contentSha256: "a".repeat(64),
  promptVersion: "qwen_video_qc_prompt_v1",
  ruleVersion: "video_qc_v1",
  outputSchema: "video_qc_result_v1",
  initialModel: "qwen3.7-plus",
  reviewModel: "qwen3.7-flash",
  createdByName: "系统初始化",
  createdAt: Date.parse("2026-08-12T04:00:00.000Z"),
};

const currentRule = {
  id: "QRV-1",
  revision: 1,
  version: "RULE-2026-08",
  passThreshold: 60,
  description: "八月具身视频质量准入规则",
  active: true,
  createdByAccountId: "U-ADMIN-01",
  createdByName: "系统初始化",
  createdAt: Date.parse("2026-08-12T04:00:00.000Z"),
};

function renderAdmin(path: string) {
  window.history.replaceState({}, "", path);
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath={path} />
    </IdentityProvider>,
  );
}

describe("administrator rule and prompt configuration", () => {
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
    promptApi.getRule.mockReset().mockResolvedValue(currentRule);
    promptApi.createRule
      .mockReset()
      .mockImplementation(async (input) => ({
        ...currentRule,
        ...input,
        revision: 2,
        createdByName: "平台管理员",
      }));
    promptApi.getScarcityConfig.mockReset().mockResolvedValue({
      id: "SC-1",
      revision: 1,
      version: "SCARCITY-2026-08",
      enabled: true,
      tiers: [
        { id: "t1", minCount: 0, maxCount: 5, coefficient: 1, label: "稀缺" },
        { id: "t2", minCount: 6, maxCount: null, coefficient: 0.9, label: "较多" },
      ],
      weights: { scene: 0.2, standardTask: 0.5, variant: 0.3 },
      description: "稀缺奖励配置",
      createdByAccountId: "U-ADMIN",
      createdByName: "平台管理员",
      createdAt: 1,
    });
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

    expect(promptApi.createRule).toHaveBeenCalledWith({
      version: "RULE-2026-09",
      passThreshold: 65,
      description: "九月质量规则",
    });
    expect(await screen.findByText("RULE-2026-09")).toBeVisible();
    expect(screen.getByText("65 分")).toBeVisible();
    expect(screen.getByText("规则版本已发布")).toBeVisible();
  });

  it("loads the active backend quality rule", async () => {
    renderAdmin("/admin/rules");

    expect(await screen.findByText("RULE-2026-08")).toBeVisible();
    expect(screen.getByText("V1 · 已生效")).toBeVisible();
    expect(promptApi.getRule).toHaveBeenCalled();
  });

  it("publishes a versioned AI system prompt for future jobs", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/rules");

    expect((await screen.findAllByText("qwen3.7-plus")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("qwen3.7-flash").length).toBeGreaterThan(0);
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
