import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityProvider } from "../../auth/client/IdentityContext";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { EarningsPage } from "./EarningsPage";

const walletApi = vi.hoisted(() => ({
  getMyWallet: vi.fn(),
  getSavedPayoutRecipients: vi.fn(),
  withdrawWallet: vi.fn(),
  listWithdrawals: vi.fn(),
}));

vi.mock("../../wallet/client/walletApi", () => ({
  getMyWallet: walletApi.getMyWallet,
  getSavedPayoutRecipients: walletApi.getSavedPayoutRecipients,
  withdrawWallet: walletApi.withdrawWallet,
  listWithdrawals: walletApi.listWithdrawals,
}));

const detail = {
  balance: {
    ownerId: "U-COLLECTOR",
    ownerName: "测试数采",
    totalBalance: 25.5,
    settlingBalance: 10,
    nextSettlementAt: Date.parse("2026-08-13T18:00:00Z"),
    availableBalance: 12.5,
    reservedBalance: 0,
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
      submissionId: "SUB-1",
      fileName: "kitchen.mp4",
      settleDueAt: Date.parse("2026-08-13T18:00:00Z"),
      remark: "kitchen 收益",
      createdAt: Date.parse("2026-08-13T04:00:00Z"),
    },
    {
      id: "WT-2",
      type: "settle" as const,
      amount: 12.5,
      balanceAfter: 25.5,
      cycleId: "PC-1",
      submissionId: null,
      fileName: null,
      settleDueAt: null,
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
      fileName: null,
      settleDueAt: null,
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
        <EarningsPage navigate={vi.fn()} />
      </IdentityProvider>
    </InteractionProvider>,
  );
}

describe("collector wallet page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    walletApi.getMyWallet.mockResolvedValue(detail);
    walletApi.getSavedPayoutRecipients.mockResolvedValue([]);
    walletApi.listWithdrawals.mockResolvedValue({ requests: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 1 } });
    walletApi.withdrawWallet.mockResolvedValue({ id: "WR-test", status: "pending" });
  });

  it("shows the three clickable summary cards（结算中/可提现/累计赚取）", async () => {
    renderPage();
    expect(await screen.findByText("10 元")).toBeInTheDocument();
    expect(screen.getByText("可提现")).toBeInTheDocument();
    expect(screen.getByText("累计赚取")).toBeInTheDocument();
    expect(screen.getByText("12.5 元")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /累计赚取/ })).toHaveTextContent("25.5 元");
  });

  it("associates each credited video with its Shanghai availability deadline", async () => {
    renderPage();
    const row = (await screen.findByText("kitchen.mp4")).closest("tr")!;
    expect(within(row).getByText("+10 元")).toBeVisible();
    expect(within(row).getByText("2026/08/14 02:00")).toBeVisible();
    expect(screen.getByText(/最早预计可提现/)).toHaveTextContent("2026/08/14 02:00");
  });

  it("does not invent a deadline or filename for historical credits", async () => {
    walletApi.getMyWallet.mockResolvedValue({ ...detail, balance: { ...detail.balance, nextSettlementAt: null }, transactions: [{ ...detail.transactions[0], fileName: null, submissionId: null, settleDueAt: null }] });
    renderPage();
    const row = (await screen.findByText("历史记录未关联视频")).closest("tr")!;
    expect(within(row).getByText("未记录")).toBeVisible();
    expect(screen.getByText(/最早预计可提现/)).toHaveTextContent("暂无待结算时间");
  });

  it("switches detail views when clicking summary cards", async () => {
    const user = userEvent.setup();
    renderPage();
    // 默认「结算中」明细：只显示 lock 流水
    expect(await screen.findByText("质检通过入账")).toBeInTheDocument();
    expect(screen.getByText("+10 元")).toBeInTheDocument();
    expect(screen.queryByText("结算转可提现")).not.toBeInTheDocument();

    // 累计赚取只显示收入，不将内部结算和提现重复计为收益。
    await user.click(screen.getByRole("button", { name: /累计赚取/ }));
    expect(screen.getByText("+10 元")).toBeInTheDocument();
    expect(screen.queryByText("+12.5 元")).not.toBeInTheDocument();
    expect(screen.queryByText("-3 元")).not.toBeInTheDocument();

    // 点「可提现」→ 只显示 settle，且出现提现表单
    await user.click(screen.getByRole("button", { name: /^可提现/ }));
    expect(await screen.findByText("提现")).toBeInTheDocument();
    expect(screen.getByText("结算转可提现")).toBeInTheDocument();
    expect(screen.queryByText("-3 元")).not.toBeInTheDocument();
  });

  it("reserves a submitted withdrawal without fabricating a paid ledger entry", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await screen.findByText("12.5 元");
    walletApi.getMyWallet.mockResolvedValue({ ...detail, balance: { ...detail.balance, availableBalance: 9.5, reservedBalance: 3 } });
    await user.click(screen.getByRole("button", { name: /^可提现/ }));
    await user.type(screen.getByLabelText("收款人姓名"), "测试收款人");
    await user.type(screen.getByLabelText("收款账号"), "test@example.test");
    await user.type(screen.getByLabelText("提现金额"), "3");
    await user.click(screen.getByRole("button", { name: "确认提现" }));
    expect(await screen.findByText("9.5 元")).toBeVisible();
    expect(screen.getByRole("button", { name: /累计赚取/ })).toHaveTextContent("25.5 元");
    await user.click(screen.getByRole("button", { name: /累计赚取/ }));
    expect(screen.queryByText("-3 元")).not.toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("rejects an amount above the available balance", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("12.5 元");
    await user.click(screen.getByRole("button", { name: /^可提现/ }));
    await user.type(screen.getByLabelText("收款人姓名"), "测试收款人");
    await user.type(screen.getByLabelText("收款账号"), "test@example.test");
    await user.type(await screen.findByLabelText("提现金额"), "999");
    await user.click(screen.getByRole("button", { name: "确认提现" }));

    expect(walletApi.withdrawWallet).not.toHaveBeenCalled();
    expect(screen.getByText("提现金额不能超过可提现余额")).toBeVisible();
  });
});
