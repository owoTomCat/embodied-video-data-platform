import { render, screen, within } from "@testing-library/react";
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
      type: "settle" as const,
      amount: 12.5,
      balanceAfter: 25.5,
      cycleId: "PC-1",
      submissionId: null,
      remark: "周期结算",
      createdAt: Date.parse("2026-08-16T04:00:00Z"),
    },
    {
      id: "WT-3",
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

  it("shows the three clickable summary cards（结算中/可提现/累计赚取）", async () => {
    renderPage();
    expect(await screen.findByText("结算中")).toBeInTheDocument();
    expect(screen.getByText("可提现")).toBeInTheDocument();
    expect(screen.getByText("累计赚取")).toBeInTheDocument();
    // 结算中 10 元、可提现 12.5 元、累计赚取 = 可提现 + 已提现 = 15.5 元
    expect(screen.getByText("10 元")).toBeInTheDocument();
    expect(screen.getByText("12.5 元")).toBeInTheDocument();
    expect(screen.getByText("15.5 元")).toBeInTheDocument();
  });

  it("switches detail views when clicking summary cards", async () => {
    const user = userEvent.setup();
    renderPage();
    // 默认「结算中」明细：只显示 lock 流水
    expect(await screen.findByText("锁定入结算中")).toBeInTheDocument();
    expect(screen.getByText("+10 元")).toBeInTheDocument();
    expect(screen.queryByText("结算转可提现")).not.toBeInTheDocument();

    // 点「累计赚取」→ 显示 settle + withdraw
    await user.click(screen.getByRole("button", { name: /累计赚取/ }));
    expect(await screen.findByText("结算转可提现")).toBeInTheDocument();
    expect(screen.getByText("+12.5 元")).toBeInTheDocument();
    expect(screen.getByText("-3 元")).toBeInTheDocument();

    // 点「可提现」→ 只显示 settle，且出现提现表单
    await user.click(screen.getByRole("button", { name: /可提现/ }));
    expect(await screen.findByText("提现")).toBeInTheDocument();
    expect(screen.getByText("结算转可提现")).toBeInTheDocument();
    expect(screen.queryByText("-3 元")).not.toBeInTheDocument();
  });

  it("withdraws from available balance with confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByText("12.5 元");
    // 切到「可提现」视图后提现表单可用
    await user.click(screen.getByRole("button", { name: /可提现/ }));
    await user.type(await screen.findByLabelText("提现金额"), "3");
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
    await user.click(screen.getByRole("button", { name: /可提现/ }));
    await user.type(await screen.findByLabelText("提现金额"), "999");
    await user.click(screen.getByRole("button", { name: "确认提现" }));

    expect(walletApi.withdrawWallet).not.toHaveBeenCalled();
    expect(screen.getByText("提现金额不能超过可提现余额")).toBeVisible();
  });
});
