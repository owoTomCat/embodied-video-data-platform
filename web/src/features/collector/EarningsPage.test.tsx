import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityProvider } from "../../auth/client/IdentityContext";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { EarningsPage } from "./EarningsPage";

const walletApi = vi.hoisted(() => ({
  getMyWallet: vi.fn(),
  withdrawWallet: vi.fn(),
}));

vi.mock("../../wallet/client/walletApi", () => ({
  getMyWallet: walletApi.getMyWallet,
  withdrawWallet: walletApi.withdrawWallet,
}));

const detail = {
  balance: {
    ownerId: "U-COLLECTOR",
    ownerName: "测试数采",
    totalBalance: 25.5,
    settlingBalance: 10,
    availableBalance: 12.5,
    withdrawnBalance: 3,
    cumulativeWithdrawn: 8,
  },
  transactions: [
    {
      id: "WT-1",
      type: "lock" as const,
      amount: 10,
      balanceAfter: 25.5,
      cycleId: "PC-1",
      submissionId: null,
      remark: "周期 2026-08-13 锁定",
      createdAt: Date.parse("2026-08-13T04:00:00Z"),
    },
    {
      id: "WT-2",
      type: "withdraw" as const,
      amount: -3,
      balanceAfter: 22.5,
      cycleId: null,
      submissionId: null,
      remark: "钱包提现",
      createdAt: Date.parse("2026-08-14T04:00:00Z"),
    },
  ],
};

function renderPage() {
  const collector = accountForRole("collector");
  return render(
    <InteractionProvider>
      <IdentityProvider
        currentAccount={collector}
        accounts={demoAccounts}
        teams={[]}
      >
        <EarningsPage />
      </IdentityProvider>
    </InteractionProvider>,
  );
}

describe("collector wallet page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletApi.getMyWallet.mockResolvedValue(detail);
    walletApi.withdrawWallet.mockResolvedValue({
      ...detail.balance,
      availableBalance: 9.5,
      withdrawnBalance: 6,
      cumulativeWithdrawn: 11,
    });
  });

  it("shows the four wallet balances in yuan", async () => {
    renderPage();
    expect((await screen.findAllByText("25.5 元")).length).toBeGreaterThan(0);
    expect(screen.getByText("12.5 元")).toBeInTheDocument();
    expect(screen.getByText("10 元")).toBeInTheDocument();
    expect(screen.getByText("3 元")).toBeInTheDocument();
    expect(screen.getByText("累计提现 8 元")).toBeInTheDocument();
  });

  it("lists wallet transactions with typed badges", async () => {
    renderPage();
    expect(await screen.findByText("锁定入结算中")).toBeInTheDocument();
    expect(screen.getAllByText("提现").length).toBeGreaterThan(0);
    expect(screen.getByText("+10 元")).toBeInTheDocument();
    expect(screen.getByText("-3 元")).toBeInTheDocument();
  });

  it("withdraws from available balance with confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByText("12.5 元");

    await user.type(screen.getByLabelText("提现金额"), "3");
    await user.click(screen.getByRole("button", { name: "确认提现" }));

    expect(walletApi.withdrawWallet).toHaveBeenCalledWith({
      amount: 3,
      remark: undefined,
    });
    expect(await screen.findByText("提现成功，已记录累计提现")).toBeVisible();
    vi.restoreAllMocks();
  });

  it("rejects an amount above the available balance", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("12.5 元");

    await user.type(screen.getByLabelText("提现金额"), "999");
    await user.click(screen.getByRole("button", { name: "确认提现" }));

    expect(walletApi.withdrawWallet).not.toHaveBeenCalled();
    expect(screen.getByText("提现金额不能超过可提现余额")).toBeVisible();
  });
});
