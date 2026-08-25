import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { AccountPublic, TeamPublic } from "../contracts";
import {
  DemoStoreProvider,
  useDemoStore,
} from "../../data/DemoStoreContext";
import {
  IdentityProvider,
  useIdentity,
} from "./IdentityContext";

const account: AccountPublic = {
  id: "U-ADMIN-01",
  displayName: "真实管理员",
  username: "admin",
  role: "admin",
  status: "active",
  updatedAt: 1_722_708_000_000,
};

const team: TeamPublic = {
  id: "TEAM-REAL-01",
  name: "真实团队",
  status: "active",
  unitPricePerMinute: 18.5,
  createdAt: 1_722_708_000_000,
  updatedAt: 1_722_708_000_000,
};

const demoAccount: AccountPublic = {
  ...account,
  displayName: "演示管理员",
};

const demoTeam: TeamPublic = {
  ...team,
  name: "演示团队",
};

function IdentityProbe() {
  const { currentAccount, accounts, teams, upsertAccount, upsertTeam } =
    useIdentity();
  return (
    <div>
      <span>当前 {currentAccount.displayName}</span>
      <span>账号 {accounts.map((item) => item.displayName).join(",")}</span>
      <span>团队 {teams.map((item) => item.name).join(",")}</span>
      <button
        onClick={() =>
          upsertAccount({ ...account, displayName: "更新后的管理员" })
        }
      >
        更新账号
      </button>
      <button
        onClick={() => upsertTeam({ ...team, name: "更新后的团队" })}
      >
        更新团队
      </button>
    </div>
  );
}

function DemoStoreProbe() {
  const { currentAccount, teams } = useDemoStore();
  return (
    <div>
      <span>Demo 账号 {currentAccount.displayName}</span>
      <span>Demo 团队 {teams[0]?.name}</span>
    </div>
  );
}

describe("IdentityProvider", () => {
  it("publishes backend identity snapshots and replaces upserts in its own state", async () => {
    const user = userEvent.setup();
    render(
      <IdentityProvider
        currentAccount={account}
        accounts={[account]}
        teams={[team]}
      >
        <IdentityProbe />
      </IdentityProvider>,
    );

    expect(screen.getByText("当前 真实管理员")).toBeVisible();
    expect(screen.getByText("团队 真实团队")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "更新账号" }));
    await user.click(screen.getByRole("button", { name: "更新团队" }));

    expect(screen.getByText("账号 更新后的管理员")).toBeVisible();
    expect(screen.getByText("团队 更新后的团队")).toBeVisible();
  });

  it("keeps conflicting DemoStore snapshots unchanged after identity upserts", async () => {
    const user = userEvent.setup();
    render(
      <IdentityProvider
        currentAccount={account}
        accounts={[account]}
        teams={[team]}
      >
        <DemoStoreProvider
          currentAccount={demoAccount}
          accounts={[demoAccount]}
          teams={[demoTeam]}
        >
          <IdentityProbe />
          <DemoStoreProbe />
        </DemoStoreProvider>
      </IdentityProvider>,
    );

    expect(screen.getByText("Demo 账号 演示管理员")).toBeVisible();
    expect(screen.getByText("Demo 团队 演示团队")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "更新账号" }));
    await user.click(screen.getByRole("button", { name: "更新团队" }));

    expect(screen.getByText("账号 更新后的管理员")).toBeVisible();
    expect(screen.getByText("团队 更新后的团队")).toBeVisible();
    expect(screen.getByText("Demo 账号 演示管理员")).toBeVisible();
    expect(screen.getByText("Demo 团队 演示团队")).toBeVisible();
  });
});
