import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountPublic } from "../../auth/contracts";
import * as accountApi from "../../auth/client/accountApi";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { UsersTeamsPage } from "./UsersTeamsPage";

vi.mock("../../auth/client/accountApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../auth/client/accountApi")
  >("../../auth/client/accountApi");
  return {
    ...actual,
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    createTeam: vi.fn(),
    updateTeam: vi.fn(),
    assignTeamLeader: vi.fn(),
    resetAccountPassword: vi.fn(),
    setAccountStatus: vi.fn(),
    deleteAccount: vi.fn(),
  };
});

const adminAccount: AccountPublic = {
  id: "U-ADMIN-01",
  displayName: "管理员",
  username: "admin",
  role: "admin",
  status: "active",
  updatedAt: 1_722_708_000_000,
};

const collectorAccount: AccountPublic = {
  id: "U-COL-01",
  displayName: "测试人员1",
  username: "ceshirenyuan1",
  role: "collector",
  teamId: "TEAM-01",
  status: "active",
  updatedAt: 1_722_708_000_000,
};

afterEach(() => {
  vi.mocked(accountApi.createAccount).mockReset();
  vi.mocked(accountApi.updateAccount).mockReset();
  vi.mocked(accountApi.createTeam).mockReset();
  vi.mocked(accountApi.updateTeam).mockReset();
  vi.mocked(accountApi.assignTeamLeader).mockReset();
  vi.mocked(accountApi.resetAccountPassword).mockReset();
  vi.mocked(accountApi.setAccountStatus).mockReset();
  vi.mocked(accountApi.deleteAccount).mockReset();
});

function renderAdminAccounts(
  accountList: AccountPublic[] = [adminAccount, collectorAccount],
) {
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
        currentAccount={adminAccount}
        accounts={accountList}
        teams={teams}
      >
        <UsersTeamsPage />
      </IdentityProvider>
    </InteractionProvider>,
  );
}

describe("administrator account management", () => {
  it("shows teams as expandable groups before their account rows", async () => {
    const user = userEvent.setup();
    renderAdminAccounts();

    const toggle = screen.getByRole("button", {
      name: "星火一队，收起账号",
    });
    const teamCard = toggle.closest("article")!;
    expect(within(teamCard).getByText("待指定")).toBeVisible();
    expect(within(teamCard).getByText("测试人员1")).toBeVisible();

    await user.click(toggle);
    expect(within(teamCard).queryByText("测试人员1")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "星火一队，展开账号" }),
    );
    expect(within(teamCard).getByText("测试人员1")).toBeVisible();
  });

  it("creates another administrator and updates the account list", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.createAccount).mockResolvedValue({
      ...adminAccount,
      id: "U-ADMIN-02",
      displayName: "管理员2",
      username: "admin2",
      updatedAt: 1_722_708_100_000,
    });
    renderAdminAccounts();

    await user.click(screen.getByRole("button", { name: "新增账号" }));
    await user.type(screen.getByLabelText("显示名称"), "管理员2");
    await user.type(screen.getByLabelText("用户名"), "admin2");
    await user.type(screen.getByLabelText("初始密码"), "admin234");
    await user.selectOptions(screen.getByLabelText("角色"), "admin");
    await user.dblClick(
      screen.getByRole("button", { name: "创建账号" }),
    );

    expect(accountApi.createAccount).toHaveBeenCalledTimes(1);
    expect(accountApi.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "admin2",
        role: "admin",
        teamId: undefined,
      }),
    );
    expect(screen.getByText("管理员2")).toBeVisible();
    expect(screen.getByText("账号已创建")).toBeVisible();
  });

  it("edits a display name and username through the persistent API", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.updateAccount).mockResolvedValue({
      ...collectorAccount,
      displayName: "测试人员一",
      username: "collector.one",
      updatedAt: 1_722_708_100_000,
    });
    renderAdminAccounts();
    const row = screen.getByText("测试人员1").closest("tr")!;

    await user.click(within(row).getByRole("button", { name: "编辑" }));
    await user.clear(screen.getByLabelText("显示名称"));
    await user.type(screen.getByLabelText("显示名称"), "测试人员一");
    await user.clear(screen.getByLabelText("用户名"));
    await user.type(screen.getByLabelText("用户名"), "collector.one");
    await user.click(screen.getByRole("button", { name: "保存账号" }));

    expect(screen.getByText("测试人员一")).toBeVisible();
    expect(screen.getByText("collector.one")).toBeVisible();
    expect(screen.getByText("账号信息已更新")).toBeVisible();
  });

  it("validates password confirmation before resetting an account", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.resetAccountPassword).mockResolvedValue({
      reauthenticate: false,
    });
    renderAdminAccounts();
    const row = screen.getByText("测试人员1").closest("tr")!;

    await user.click(
      within(row).getByRole("button", { name: "重置密码" }),
    );
    await user.type(screen.getByLabelText("新密码"), "newpassword");
    await user.type(
      screen.getByLabelText("确认新密码"),
      "different-password",
    );
    await user.click(screen.getByRole("button", { name: "确认重置" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "两次输入的密码不一致",
    );
    expect(accountApi.resetAccountPassword).not.toHaveBeenCalled();
  });

  it("disables another account after confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.setAccountStatus).mockResolvedValue({
      ...collectorAccount,
      status: "disabled",
      updatedAt: 1_722_708_100_000,
    });
    renderAdminAccounts();
    const row = screen.getByText("测试人员1").closest("tr")!;

    await user.click(within(row).getByRole("button", { name: "停用" }));
    await user.click(screen.getByRole("button", { name: "确认停用" }));

    expect(within(row).getByText("已停用")).toBeVisible();
    expect(screen.getByText("账号已停用")).toBeVisible();
  });

  it("permanently deletes a disabled account after username confirmation", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.deleteAccount).mockResolvedValue();
    renderAdminAccounts([{ ...adminAccount }, { ...collectorAccount, status: "disabled" }]);
    const row = screen.getByText("测试人员1").closest("tr")!;

    await user.click(within(row).getByRole("button", { name: "删除" }));
    await user.type(screen.getByLabelText("确认用户名"), "ceshirenyuan1");
    await user.click(screen.getByRole("button", { name: "永久删除账号" }));

    expect(accountApi.deleteAccount).toHaveBeenCalledWith("U-COL-01");
    expect(screen.queryByText("测试人员1")).not.toBeInTheDocument();
    expect(screen.getByText("账号已永久删除")).toBeVisible();
  });

  it("filters accounts by search, role, and status", async () => {
    const user = userEvent.setup();
    renderAdminAccounts();

    await user.type(screen.getByLabelText("搜索账号"), "ceshi");
    expect(screen.getByText("测试人员1")).toBeVisible();
    expect(screen.queryByText("管理员", { selector: "strong" })).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("搜索账号"));
    await user.selectOptions(screen.getByLabelText("角色筛选"), "admin");
    expect(screen.getByText("管理员", { selector: "strong" })).toBeVisible();
    expect(screen.queryByText("测试人员1")).not.toBeInTheDocument();
  });

  it("creates and edits a persistent team", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.createTeam).mockResolvedValue({
      id: "TEAM-02",
      name: "远山二队",
      status: "active",
      unitPricePerMinute: 15,
      createdAt: 1_722_708_100_000,
      updatedAt: 1_722_708_100_000,
    });
    vi.mocked(accountApi.updateTeam).mockResolvedValue({
      id: "TEAM-01",
      name: "星火先锋队",
      status: "active",
      unitPricePerMinute: 13,
      createdAt: 1_722_708_000_000,
      updatedAt: 1_722_708_200_000,
    });
    renderAdminAccounts();

    await user.click(screen.getByRole("button", { name: "新增团队" }));
    await user.type(screen.getByLabelText("团队名称"), "远山二队");
    await user.clear(screen.getByLabelText("每小时单价（元）"));
    await user.type(screen.getByLabelText("每小时单价（元）"), "15");
    await user.click(screen.getByRole("button", { name: "创建团队" }));

    expect(accountApi.createTeam).toHaveBeenCalledWith({
      name: "远山二队",
      unitPricePerMinute: 15,
    });
    expect(screen.getAllByText("远山二队").length).toBeGreaterThan(0);

    const teamCard = screen.getByText(/TEAM-01/).closest("article")!;
    await user.click(within(teamCard).getByRole("button", { name: "编辑团队" }));
    await user.clear(screen.getByLabelText("团队名称"));
    await user.type(screen.getByLabelText("团队名称"), "星火先锋队");
    await user.clear(screen.getByLabelText("每小时单价（元）"));
    await user.type(screen.getByLabelText("每小时单价（元）"), "13");
    await user.click(screen.getByRole("button", { name: "保存团队" }));

    expect(accountApi.updateTeam).toHaveBeenCalledWith("TEAM-01", {
      name: "星火先锋队",
      unitPricePerMinute: 13,
      status: "active",
    });
    expect(screen.getAllByText("星火先锋队").length).toBeGreaterThan(0);
  });

  it("assigns a team leader and refreshes both affected account roles", async () => {
    const user = userEvent.setup();
    vi.mocked(accountApi.assignTeamLeader).mockResolvedValue([
      { ...collectorAccount, role: "leader" },
    ]);
    renderAdminAccounts();
    const teamCard = screen.getByText(/TEAM-01/).closest("article")!;

    await user.click(within(teamCard).getByRole("button", { name: /指定团长/ }));
    await user.selectOptions(screen.getByLabelText("团长账号"), "U-COL-01");
    await user.click(screen.getByRole("button", { name: "确认指定" }));

    expect(accountApi.assignTeamLeader).toHaveBeenCalledWith(
      "TEAM-01",
      "U-COL-01",
    );
    expect(screen.getByText("团长已更新，相关账号需重新登录")).toBeVisible();
  });
});
