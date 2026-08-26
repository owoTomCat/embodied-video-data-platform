import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const publicSiteApi = vi.hoisted(() => ({
  get: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("../../public-site/client/publicSiteApi", () => ({
  getPublicSiteSnapshot: publicSiteApi.get,
  publishPublicSiteSnapshot: publicSiteApi.publish,
}));

const snapshot = {
  id: "PSS-1",
  revision: 3,
  snapshotDate: "2026-08-13",
  generatedByName: "后端任务",
  generatedAt: Date.parse("2026-08-13T00:00:00.000Z"),
  metrics: {
    deliverableVideoCount: 2,
    effectiveDurationSeconds: 165,
    sceneCount: 2,
    qualityPassRate: 66.67,
  },
  config: {
    primarySceneName: "后端家庭操作",
    primarySceneDescription: "厨房与桌面任务",
    ctaCopy: "后端公开联系文案",
  },
  sceneBreakdown: [
    {
      name: "家庭厨房",
      description: "整理厨房台面",
      videoCount: 1,
      share: 50,
    },
    {
      name: "桌面整理",
      description: "桌面整理",
      videoCount: 1,
      share: 50,
    },
  ],
  trend: [],
};

function renderAdmin() {
  window.history.replaceState({}, "", "/admin/public");
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath="/admin/public" />
    </IdentityProvider>,
  );
}

describe("public configuration page", () => {
  beforeEach(() => {
    publicSiteApi.get.mockReset().mockResolvedValue(snapshot);
    publicSiteApi.publish
      .mockReset()
      .mockImplementation(async (input) => ({
        ...snapshot,
        revision: 4,
        config: input,
      }));
  });

  it("loads backend anonymized public metrics", async () => {
    renderAdmin();

    expect(await screen.findByLabelText("可交付视频")).toHaveValue("2");
    expect(screen.getByLabelText("有效数据时长")).toHaveValue("3 分钟");
    expect(screen.getByLabelText("高频作业场景")).toHaveValue("2");
    expect(screen.getByDisplayValue("66.7%")).toBeVisible();
    expect(screen.getByDisplayValue("后端家庭操作")).toBeVisible();
    expect(screen.getByText("家庭厨房")).toBeVisible();
    expect(screen.getByText("后端脱敏快照 V3")).toBeVisible();
  });

  it("publishes a refreshed public snapshot", async () => {
    const user = userEvent.setup();
    renderAdmin();

    const cta = await screen.findByDisplayValue("后端公开联系文案");
    await user.clear(cta);
    await user.type(cta, "新的公开联系文案");
    await user.click(screen.getByRole("button", { name: "保存公开配置" }));

    expect(publicSiteApi.publish).toHaveBeenCalledWith({
      primarySceneName: "后端家庭操作",
      primarySceneDescription: "厨房与桌面任务",
      ctaCopy: "新的公开联系文案",
    });
    expect(await screen.findByText("公开配置已发布为 V4")).toBeVisible();
  });
});
