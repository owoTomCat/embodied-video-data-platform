import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const guideApi = vi.hoisted(() => ({
  listMyLibraries: vi.fn(),
  createCollectorLibrary: vi.fn(),
  getCollectorLibrary: vi.fn(),
  listSceneClassification: vi.fn(),
  guideTaskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

vi.mock("../../scene-guide/client/sceneGuideApi", () => ({
  listMyLibraries: guideApi.listMyLibraries,
  createCollectorLibrary: guideApi.createCollectorLibrary,
  getCollectorLibrary: guideApi.getCollectorLibrary,
  listSceneClassification: guideApi.listSceneClassification,
  guideTaskErrorMessage: guideApi.guideTaskErrorMessage,
}));

const library = {
  id: "SL-1",
  name: "我家厨房",
  categoryKey: "family",
  categoryName: "家庭",
  subSceneIds: ["SC-001"],
  subScenes: [{ id: "SC-001", level2Name: "厨房", level1Code: "F01" }],
  description: "",
  enabled: true,
  ownerAccountId: "U-COL-01",
  taskCount: 3,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function renderPage() {
  window.history.replaceState({}, "", "/collector/scenes");
  const collector = accountForRole("collector");
  return render(
    <IdentityProvider currentAccount={collector} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath="/collector/scenes" />
    </IdentityProvider>,
  );
}

describe("MyScenesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guideApi.listMyLibraries.mockResolvedValue([library]);
    guideApi.getCollectorLibrary.mockResolvedValue({ ...library, tasks: [] });
    guideApi.listSceneClassification.mockResolvedValue([
      { id: "SC-001", level1Code: "F01", level1Name: "家庭", level2Name: "厨房", description: "", enabled: true, updatedAt: 0 },
    ]);
  });

  it("renders my scene libraries with taskCount and navigates to detail", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("我家厨房")).toBeInTheDocument();
    expect(screen.getByText("3 张任务卡")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /进入场景库/ }));
    expect(window.location.pathname).toBe("/collector/scenes/SL-1");
  });

  it("creates a library from the modal", async () => {
    guideApi.createCollectorLibrary.mockResolvedValue(library);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("我家厨房");
    await user.click(screen.getByRole("button", { name: /新建场景库/ }));
    await user.type(await screen.findByLabelText("场景库名称"), "我家卧室");
    await user.selectOptions(screen.getByLabelText("场景类别（一级）"), "family");
    await user.click(screen.getByLabelText("家庭-厨房"));
    await user.click(screen.getByRole("button", { name: /创建场景库/ }));
    expect(guideApi.createCollectorLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ name: "我家卧室", categoryKey: "family" }),
    );
  });
});
