import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccountPublic, TeamPublic } from "../../auth/contracts";
import { AccountApiError } from "../../auth/client/accountApi";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { AccountProfilePage } from "./AccountProfilePage";
import type * as WalletApi from "../../wallet/client/walletApi";

const { changeOwnPassword } = vi.hoisted(() => ({
  changeOwnPassword: vi.fn(),
}));

vi.mock("../../auth/client/accountApi", async () => {
  const actual = await vi.importActual<
    typeof import("../../auth/client/accountApi")
  >("../../auth/client/accountApi");
  return { ...actual, changeOwnPassword };
});

vi.mock("../../wallet/client/walletApi", async () => {
  const actual = await vi.importActual<typeof WalletApi>("../../wallet/client/walletApi");
  return { ...actual, getSavedPayoutRecipients: vi.fn().mockResolvedValue([]) };
});

const team: TeamPublic = {
  id: "TEAM-01",
  name: "真实团队",
  status: "active",
  unitPricePerMinute: 12,
  createdAt: 1_722_708_000_000,
  updatedAt: 1_722_708_000_000,
};

function account(role: AccountPublic["role"]): AccountPublic {
  return {
    id: `U-${role}`,
    displayName: `${role}-真实姓名`,
    username: `${role}.real`,
    role,
    status: "active",
    teamId: role === "admin" ? undefined : team.id,
    updatedAt: 1_722_708_000_000,
  };
}

function renderProfile(role: AccountPublic["role"] = "collector") {
  const currentAccount = account(role);
  return render(
    <InteractionProvider>
      <IdentityProvider
        currentAccount={currentAccount}
        accounts={[currentAccount]}
        teams={[team]}
      >
        <AccountProfilePage />
      </IdentityProvider>
    </InteractionProvider>,
  );
}

async function fillPasswordForm(
  user: ReturnType<typeof userEvent.setup>,
  values = {
    current: "current-password",
    next: "new-password",
    confirmation: "new-password",
  },
) {
  await user.type(screen.getByLabelText("当前密码"), values.current);
  await user.type(screen.getByLabelText("新密码"), values.next);
  await user.type(screen.getByLabelText("确认新密码"), values.confirmation);
}

afterEach(() => {
  changeOwnPassword.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("account profile", () => {
  it.each(["admin", "leader", "collector"] as const)(
    "shows the backend identity snapshot for a %s",
    (role) => {
      const currentAccount = account(role);
      renderProfile(role);

      expect(screen.getAllByText(currentAccount.displayName)).not.toHaveLength(0);
      expect(screen.getAllByText(currentAccount.username)).not.toHaveLength(0);
      expect(
        screen.getAllByText(
          role === "admin"
            ? "平台管理员"
            : role === "leader"
              ? "团长"
              : "数采人员",
        ),
      ).not.toHaveLength(0);
      expect(screen.getAllByText("正常")).not.toHaveLength(0);
      expect(screen.getByLabelText("当前密码")).toHaveAttribute(
        "type",
        "password",
      );
      expect(screen.getByLabelText("新密码")).toHaveAttribute("type", "password");
      expect(screen.getByLabelText("确认新密码")).toHaveAttribute(
        "type",
        "password",
      );
      expect(
        screen.getAllByText(role === "admin" ? "未分配团队" : team.name),
      ).not.toHaveLength(0);
    },
  );

  it("blocks mismatched confirmation without requesting a password change", async () => {
    const user = userEvent.setup();
    renderProfile();

    await fillPasswordForm(user, { current: "current-password", next: "new-password", confirmation: "other-password" });
    await user.click(screen.getByRole("button", { name: "修改密码" }));

    expect(screen.getByRole("alert")).toHaveTextContent("两次输入的密码不一致");
    expect(changeOwnPassword).not.toHaveBeenCalled();
  });

  it("blocks a password outside the supported length without requesting a password change", async () => {
    const user = userEvent.setup();
    renderProfile();

    await fillPasswordForm(user, { current: "current-password", next: "short", confirmation: "short" });
    await user.click(screen.getByRole("button", { name: "修改密码" }));

    expect(screen.getByRole("alert")).toHaveTextContent("密码长度需为 8 到 64 位");
    expect(changeOwnPassword).not.toHaveBeenCalled();
  });

  it("submits the current and new password exactly once", async () => {
    const user = userEvent.setup();
    changeOwnPassword.mockResolvedValue(undefined);
    const assign = vi.fn();
    vi.stubGlobal("window", { ...window, location: { assign } });
    renderProfile();

    await fillPasswordForm(user);
    await user.click(screen.getByRole("button", { name: "修改密码" }));

    expect(changeOwnPassword).toHaveBeenCalledTimes(1);
    expect(changeOwnPassword).toHaveBeenCalledWith("current-password", "new-password");
    expect(
      await screen.findByText("密码已修改，请使用新密码重新登录"),
    ).toBeVisible();
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("clears the new secret fields and shows a safe server error when the password change fails", async () => {
    const user = userEvent.setup();
    changeOwnPassword.mockRejectedValue(
      new AccountApiError(400, "当前密码不正确", "INVALID_CURRENT_PASSWORD"),
    );
    renderProfile();

    await fillPasswordForm(user);
    await user.click(screen.getByRole("button", { name: "修改密码" }));

    expect(screen.getByRole("alert")).toHaveTextContent("当前密码不正确");
    // 失败时保留当前密码，只清空新密码与确认密码，方便用户直接重试
    expect(screen.getByLabelText("当前密码")).toHaveValue("current-password");
    for (const label of ["新密码", "确认新密码"]) {
      expect(screen.getByLabelText(label)).toHaveValue("");
    }
    expect(screen.queryByText("new-password")).not.toBeInTheDocument();
  });
});
