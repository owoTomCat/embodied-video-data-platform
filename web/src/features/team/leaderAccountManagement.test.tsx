import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as accountApi from "../../auth/client/accountApi";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import type { AccountPublic } from "../../auth/contracts";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { MembersPage } from "./MembersPage";

vi.mock("../../auth/client/accountApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../auth/client/accountApi")
  >("../../auth/client/accountApi");
  return {
    ...actual,
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    resetAccountPassword: vi.fn(),
    setAccountStatus: vi.fn(),
  };
});

const leader: AccountPublic = {
  id: "U-LEAD-01",
  displayName: "团长1",
  username: "tuanzhang1",
  role: "leader",
  teamId: "TEAM-01",
  status: "active",
  updatedAt: 1_722_708_000_000,
};

const collector: AccountPublic = {
  id: "U-COL-01",
  displayName: "测试人员1",
  username: "ceshirenyuan1",
  role: "collector",
  teamId: "TEAM-01",
  status: "active",
  updatedAt: 1_722_708_000_000,
};

function renderMembers() {
  const teams = [
    {
      id: "TEAM-01",
      name: "星火一队",
      status: "active" as const,
      unitPricePerMinute: 12,
      createdAt: 1_722_708_000_000,
      updatedAt: 1_722_708_000_000,
    },
  ];
  return render(
    <InteractionProvider>
      <IdentityProvider
        currentAccount={leader}
        accounts={[leader, collector]}
        teams={teams}
      >
        <MembersPage />
      </IdentityProvider>
    </InteractionProvider>,
  );
}

afterEach(() => {
  vi.mocked(accountApi.createAccount).mockReset();
  vi.mocked(accountApi.updateAccount).mockReset();
  vi.mocked(accountApi.resetAccountPassword).mockReset();
  vi.mocked(accountApi.setAccountStatus).mockReset();
});

describe("leader account management", () => {
  it("creates a collector locked to the leader team", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.createAccount).mockResolvedValue({
      ...collector,
      id: "U-COL-NEW",
      displayName: "新增数采",
      username: "collector-new",
    });
    renderMembers();

    await user.click(
      screen.getByRole("button", { name: "新增数采账号" }),
    );
    await user.type(screen.getByLabelText("显示名称"), "新增数采");
    await user.type(screen.getByLabelText("用户名"), "collector-new");
    await user.type(screen.getByLabelText("初始密码"), "collector-password");
    await user.click(
      screen.getByRole("button", { name: "创建数采账号" }),
    );

    expect(accountApi.createAccount).toHaveBeenCalledWith({
      displayName: "新增数采",
      username: "collector-new",
      password: "collector-password",
      role: "collector",
      teamId: "TEAM-01",
    });
    expect(screen.getByText("新增数采")).toBeVisible();
  });

  it("renames a collector without changing username, role, or team", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.updateAccount).mockResolvedValue({
      ...collector,
      displayName: "更新后的数采",
    });
    renderMembers();
    const row = screen.getByText("测试人员1").closest("tr")!;

    await user.click(within(row).getByRole("button", { name: "编辑" }));
    await user.clear(screen.getByLabelText("显示名称"));
    await user.type(screen.getByLabelText("显示名称"), "更新后的数采");
    expect(screen.getByLabelText("用户名")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "保存名称" }));

    expect(accountApi.updateAccount).toHaveBeenCalledWith("U-COL-01", {
      displayName: "更新后的数采",
      username: "ceshirenyuan1",
      role: "collector",
      teamId: "TEAM-01",
    });
  });

  it("resets and disables an own-team collector", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.resetAccountPassword).mockResolvedValue({
      reauthenticate: false,
    });
    vi.mocked(accountApi.setAccountStatus).mockResolvedValue({
      ...collector,
      status: "disabled",
    });
    renderMembers();
    const row = screen.getByText("测试人员1").closest("tr")!;

    await user.click(
      within(row).getByRole("button", { name: "重置密码" }),
    );
    await user.type(screen.getByLabelText("新密码"), "collector-new-pass");
    await user.type(
      screen.getByLabelText("确认新密码"),
      "collector-new-pass",
    );
    await user.click(screen.getByRole("button", { name: "确认重置" }));
    expect(accountApi.resetAccountPassword).toHaveBeenCalledWith(
      "U-COL-01",
      "collector-new-pass",
    );

    await user.click(within(row).getByRole("button", { name: "停用" }));
    await user.click(screen.getByRole("button", { name: "确认停用" }));
    expect(accountApi.setAccountStatus).toHaveBeenCalledWith(
      "U-COL-01",
      "disabled",
    );
  });
});
