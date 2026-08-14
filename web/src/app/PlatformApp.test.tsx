import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AccountPublic } from "../auth/contracts";
import { IdentityProvider } from "../auth/client/IdentityContext";
import { DemoStoreProvider } from "../data/DemoStoreContext";
import type { Role } from "../domain/types";
import { PlatformApp } from "./PlatformApp";

function account(role: Role): AccountPublic {
  if (role === "admin") {
    return {
      id: "U-ADMIN-01",
      displayName: "管理员",
      username: "admin",
      role,
      status: "active",
      updatedAt: 1_722_708_000_000,
    };
  }
  if (role === "leader") {
    return {
      id: "U-LEAD-01",
      displayName: "团长1",
      username: "tuanzhang1",
      role,
      teamId: "TEAM-01",
      status: "active",
      updatedAt: 1_722_708_000_000,
    };
  }
  return {
    id: "U-COL-01",
    displayName: "测试人员1",
    username: "ceshirenyuan1",
    role,
    teamId: "TEAM-01",
    status: "active",
    updatedAt: 1_722_708_000_000,
  };
}

function renderPlatform(path: string, role?: Role, demoRole = role) {
  window.history.replaceState({}, "", path);
  const current = role ? account(role) : undefined;
  const demoCurrent = demoRole ? account(demoRole) : undefined;
  const teams = current?.teamId
    ? [
        {
          id: current.teamId,
          name: "真实团队",
          status: "active" as const,
          unitPricePerMinute: 12,
          createdAt: 1_722_708_000_000,
          updatedAt: 1_722_708_000_000,
        },
      ]
    : [];
  const app = (
    <DemoStoreProvider
      currentAccount={demoCurrent}
      accounts={demoCurrent ? [demoCurrent] : undefined}
      teams={teams}
    >
      <PlatformApp initialPath={path} />
    </DemoStoreProvider>
  );
  return render(
    current ? (
      <IdentityProvider currentAccount={current} accounts={[current]} teams={teams}>
        {app}
      </IdentityProvider>
    ) : app,
  );
}

describe("platform routing", () => {
  it("renders the public site at the root route", () => {
    renderPlatform("/");
    expect(
      screen.getByRole("heading", {
        name: "让每一段视频，成为可用的具身数据",
      }),
    ).toBeVisible();
  });

  it("renders username and password login without demo identities", () => {
    renderPlatform("/login");
    expect(screen.getByLabelText("用户名")).toBeVisible();
    expect(screen.getByLabelText("密码")).toBeVisible();
    expect(screen.queryByText("选择演示身份")).not.toBeInTheDocument();
  });

  it("routes an authenticated collector to the collector dashboard", () => {
    renderPlatform("/collector", "collector");
    expect(
      screen.getByRole("heading", { name: "早上好，测试人员1" }),
    ).toBeVisible();
  });

  it("shows one collector data navigation without a duplicate quality page", () => {
    renderPlatform("/collector/submissions", "collector");

    expect(screen.getByRole("link", { name: "我的数据" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "质检结果" })).not.toBeInTheDocument();
  });

  it("redirects a collector away from the admin area in the client fallback", () => {
    renderPlatform("/admin", "collector", "admin");
    expect(screen.getByRole("heading", { name: "我的工作台" })).toBeVisible();
    expect(screen.queryByText("提现审核")).not.toBeInTheDocument();
  });

  it("shows team review navigation to a leader", () => {
    renderPlatform("/team", "leader");
    expect(
      screen.getByRole("link", { name: /^结算前复核/ }),
    ).toBeVisible();
  });

  it("shows full operations navigation to an administrator", () => {
    renderPlatform("/admin", "admin");
    expect(screen.getByRole("link", { name: /^AI 任务/ })).toBeVisible();
    expect(screen.getByRole("link", { name: /^提现审核/ })).toBeVisible();
  });

  it.each(["admin", "leader", "collector"] as const)(
    "renders the shared account profile for an authenticated %s",
    (role) => {
      renderPlatform("/account/profile", role);

      expect(screen.getByRole("heading", { name: "个人资料" })).toBeVisible();
      expect(screen.getByRole("link", { name: /^个人资料/ })).toHaveAttribute(
        "href",
        "/account/profile",
      );
    },
  );

  it("opens notifications and clears the unread state", async () => {
    const user = userEvent.setup();
    renderPlatform("/admin", "admin");

    await user.click(
      screen.getByRole("button", { name: "通知，3 条未读" }),
    );
    expect(screen.getByText("AI 任务 SUB-019 处理异常")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "全部标为已读" }));

    expect(screen.getByRole("button", { name: "通知，无未读" })).toBeVisible();
    expect(screen.getByText("通知已全部标为已读")).toBeVisible();
  });
});
