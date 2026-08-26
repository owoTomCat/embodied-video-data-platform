import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

const labelApi = vi.hoisted(() => ({
  getLabelSet: vi.fn(),
  createLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
}));

vi.mock("../../ai-quality/client/aiQualityApi", () => ({
  getLabelSet: labelApi.getLabelSet,
  createQualityLabel: labelApi.createLabel,
  updateQualityLabel: labelApi.updateLabel,
  deleteQualityLabel: labelApi.deleteLabel,
}));

const currentLabelSet = {
  id: "LSV-1",
  revision: 3,
  version: "LABELS-REV-3",
  labels: [
    { id: "SCENE-001", name: "家庭厨房", type: "scene" as const, associationCount: 186, enabled: true },
    { id: "SCENE-002", name: "家庭客厅", type: "scene" as const, associationCount: 90, enabled: false },
    { id: "ACTION-001", name: "抓取", type: "action" as const, associationCount: 94, enabled: true },
    { id: "OBJECT-001", name: "手持工具", type: "object" as const, associationCount: 40, enabled: true },
    { id: "ISSUE-001", name: "镜头遮挡", type: "issue" as const, associationCount: 0, enabled: true },
  ],
  active: true,
  createdByAccountId: "U-ADMIN-01",
  createdByName: "系统初始化",
  createdAt: 0,
};

function nextRevision(labels = currentLabelSet.labels) {
  return {
    ...currentLabelSet,
    revision: currentLabelSet.revision + 1,
    labels,
  };
}

function renderAdmin(path = "/admin/labels") {
  window.history.replaceState({}, "", path);
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath={path} />
    </IdentityProvider>,
  );
}

describe("LabelSetPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    labelApi.getLabelSet.mockReset().mockResolvedValue(currentLabelSet);
    labelApi.createLabel
      .mockReset()
      .mockImplementation(async (input) =>
        nextRevision([
          ...currentLabelSet.labels,
          { ...input, id: "SCENE-019", associationCount: 0 },
        ]),
      );
    labelApi.updateLabel
      .mockReset()
      .mockImplementation(async (input) => {
        const { nextId, ...changes } = input;
        return nextRevision(
          currentLabelSet.labels.map((label) =>
            label.id === input.id
              ? { ...label, ...changes, id: nextId ?? label.id }
              : label,
          ),
        );
      });
    labelApi.deleteLabel
      .mockReset()
      .mockImplementation(async (id) =>
        nextRevision(currentLabelSet.labels.filter((label) => label.id !== id)),
      );
  });

  it("groups labels into separate type sections", async () => {
    renderAdmin();
    expect(
      await screen.findByRole("heading", { level: 1, name: "标签体系" }),
    ).toBeInTheDocument();

    const sceneSection = screen
      .getByRole("heading", { name: /^场景/ })
      .closest("section")!;
    expect(within(sceneSection).getByText("家庭厨房")).toBeInTheDocument();
    expect(within(sceneSection).getByText("家庭客厅")).toBeInTheDocument();
    expect(within(sceneSection).queryByText("抓取")).not.toBeInTheDocument();

    const actionSection = screen
      .getByRole("heading", { name: /^动作/ })
      .closest("section")!;
    expect(within(actionSection).getByText("抓取")).toBeInTheDocument();
    expect(within(actionSection).queryByText("家庭厨房")).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: /^对象/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^质量问题/ })).toBeInTheDocument();
    expect(screen.getByText(/版本 V3/)).toBeInTheDocument();
  });

  it("creates a label with the type preselected from the section", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText("家庭厨房");

    await user.click(
      screen.getByRole("button", { name: "新增质量问题标签" }),
    );
    expect(screen.getByLabelText("标签类型")).toHaveValue("issue");
    await user.type(screen.getByLabelText("标签名称"), "画面偏色");
    await user.click(screen.getByRole("button", { name: "保存标签" }));

    expect(labelApi.createLabel).toHaveBeenCalledWith({
      name: "画面偏色",
      type: "issue",
      enabled: true,
    });
    expect(await screen.findByText("标签已新增")).toBeVisible();
  });

  it("edits a label number, name and enabled state", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText("家庭厨房");

    const row = screen.getByText("家庭厨房").closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "编辑" }));
    await user.clear(screen.getByLabelText("标签编号"));
    await user.type(screen.getByLabelText("标签编号"), "SCENE-101");
    await user.clear(screen.getByLabelText("标签名称"));
    await user.type(screen.getByLabelText("标签名称"), "家庭烹饪");
    await user.click(screen.getByLabelText("启用标签"));
    await user.click(screen.getByRole("button", { name: "保存标签" }));

    expect(labelApi.updateLabel).toHaveBeenCalledWith({
      id: "SCENE-001",
      nextId: "SCENE-101",
      name: "家庭烹饪",
      enabled: false,
    });
    expect(await screen.findByText("标签已更新")).toBeVisible();
    const updatedRow = screen.getByText("家庭烹饪").closest("tr")!;
    expect(within(updatedRow).getByText("停用")).toBeVisible();
  });

  it("toggles a label directly from the table", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText("家庭厨房");

    await user.click(
      await screen.findByRole("button", { name: "停用标签 家庭厨房" }),
    );

    expect(labelApi.updateLabel).toHaveBeenCalledWith({
      id: "SCENE-001",
      nextId: "SCENE-001",
      name: "家庭厨房",
      enabled: false,
    });
    expect(await screen.findByText("标签已停用")).toBeVisible();
  });

  it("deletes a label after explicit confirmation", async () => {
    const user = userEvent.setup();
    renderAdmin();
    await screen.findByText("家庭厨房");

    await user.click(
      await screen.findByRole("button", { name: "删除标签 家庭客厅" }),
    );
    expect(screen.getByRole("heading", { name: "删除标签" })).toBeInTheDocument();
    expect(labelApi.deleteLabel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(labelApi.deleteLabel).toHaveBeenCalledWith("SCENE-002");
    });
    expect(await screen.findByText("标签已删除")).toBeVisible();
    expect(screen.queryByText("家庭客厅")).not.toBeInTheDocument();
  });

  it("shows real association counts per label", async () => {
    renderAdmin();
    await screen.findByText("家庭厨房");
    const row = screen.getByText("家庭厨房").closest("tr")!;
    expect(within(row).getByText("186 条")).toBeInTheDocument();
  });
});
