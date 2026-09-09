import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WithdrawalsPage } from "./WithdrawalsPage";
import type { PayoutRequest } from "../../wallet/contracts";

let row: PayoutRequest;
let confirmationCalls: number;
let finishConfirmation: (response: Response) => void;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
beforeEach(() => {
  confirmationCalls = 0;
  row = { id: "WR-finance", ownerId: "U-collector", ownerName: "Collector", teamName: "采集团队", amount: 8.25, status: "processing", method: "bank", accountMasked: "***1234", nameMasked: "张***", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", recipient: { method: "bank", name: "张三", account: "001622200001234567890", bankName: "中国银行" }, confirmedById: null, confirmedByName: null, confirmedAt: null };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/payouts/WR-finance/confirm") && init?.method === "POST") {
      confirmationCalls += 1;
      return new Promise<Response>(resolve => { finishConfirmation = resolve; });
    }
    if (url.pathname.endsWith("/payouts")) {
      const status = url.searchParams.get("status");
      const q = url.searchParams.get("q");
      const matches = (!q || q === "采集团队") && (status === "all" || (status === "paid" ? row.status === "paid" : row.status !== "paid"));
      return json({ requests: matches ? [row] : [], pagination: { page: 1, pageSize: 20, total: matches ? 1 : 0, totalPages: 1 } });
    }
    throw new Error(`Unexpected wallet request ${url.pathname}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("shows full recipient details immediately and records a single checkbox action with the server's actual confirmer", async () => {
  const user = userEvent.setup(); render(<WithdrawalsPage />);
  expect(await screen.findByText("001622200001234567890")).toBeVisible();
  expect(screen.getByText("张三")).toBeVisible();
  expect(screen.getByText("中国银行")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "全部" }));
  const checkbox = await screen.findByRole("checkbox", { name: "已打款 WR-finance" });
  await user.click(checkbox);
  expect(checkbox).toBeDisabled();
  expect(checkbox).not.toBeChecked();
  await user.click(checkbox);
  expect(confirmationCalls).toBe(1);
  row = { ...row, status: "paid", confirmedById: "admin-first", confirmedByName: "首次勾选管理员", confirmedAt: "2026-01-02T04:00:00.000Z" };
  await act(async () => { finishConfirmation(json({ request: row })); });
  const paid = await screen.findByRole("checkbox", { name: "已打款 WR-finance" });
  expect(paid).toBeChecked();
  expect(paid).toBeDisabled();
  const paidRow = screen.getByText("001622200001234567890").closest("tr")!;
  expect(within(paidRow).getByText("首次勾选管理员")).toBeVisible();
  expect(within(paidRow).getByText("admin-first")).toBeVisible();
  await user.click(paid);
  expect(confirmationCalls).toBe(1);
});

it("keeps an unsuccessful confirmation unpaid and allows retry without losing recipient details", async () => {
  const user = userEvent.setup(); render(<WithdrawalsPage />);
  await user.click(await screen.findByRole("checkbox", { name: "已打款 WR-finance" }));
  await act(async () => { finishConfirmation(json({ error: "记录暂时失败" }, 503)); });
  expect(await screen.findByRole("alert")).toHaveTextContent("记录暂时失败");
  const checkbox = screen.getByRole("checkbox", { name: "已打款 WR-finance" });
  expect(checkbox).not.toBeChecked();
  expect(checkbox).toBeEnabled();
  expect(screen.getByText("001622200001234567890")).toBeVisible();
  await user.click(checkbox);
  expect(confirmationCalls).toBe(2);
  row = { ...row, status: "paid", confirmedById: "admin-first", confirmedByName: "管理员", confirmedAt: "2026-01-02T04:00:00.000Z" };
  await act(async () => { finishConfirmation(json({ request: row })); });
  expect(await screen.findByText("暂无匹配申请")).toBeVisible();
});

it("keeps previously paid applications checked and impossible to cancel", async () => {
  row = { ...row, status: "paid", confirmedById: "admin-first", confirmedByName: "管理员", confirmedAt: "2026-01-02T04:00:00.000Z" };
  const user = userEvent.setup(); render(<WithdrawalsPage />);
  await screen.findByText("暂无匹配申请");
  await user.click(screen.getByRole("button", { name: "已打款" }));
  const checkbox = await screen.findByRole("checkbox", { name: "已打款 WR-finance" });
  expect(checkbox).toBeChecked();
  expect(checkbox).toBeDisabled();
  await user.click(checkbox);
  expect(confirmationCalls).toBe(0);
});

it("searches server-side so results can be found beyond the currently displayed rows", async () => {
  const user = userEvent.setup(); render(<WithdrawalsPage />);
  await screen.findByText("张三");
  const search = screen.getByLabelText("搜索申请 / 用户 / 姓名 / 团队");
  await user.type(search, "无匹配");
  await user.click(screen.getByRole("button", { name: "搜索" }));
  await screen.findByText("暂无匹配申请");
  await user.click(screen.getByRole("button", { name: "清除搜索" }));
  expect(await screen.findByText("张三")).toBeVisible();
  await user.type(search, "采集团队");
  await user.click(screen.getByRole("button", { name: "搜索" }));
  expect(await screen.findByText("张三")).toBeVisible();
});

it("keeps recipient details visible but prevents confirmation while refreshing stale rows", async () => {
  const user = userEvent.setup(); render(<WithdrawalsPage />);
  await screen.findByText("001622200001234567890");
  let finishRefresh!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finishRefresh = resolve; }));
  await user.click(screen.getByRole("button", { name: "刷新" }));
  expect(screen.getByText("001622200001234567890")).toBeVisible();
  const checkbox = screen.getByRole("checkbox", { name: "已打款 WR-finance" });
  expect(checkbox).toBeDisabled();
  await user.click(checkbox);
  expect(confirmationCalls).toBe(0);
  await act(async () => { finishRefresh(json({ requests: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } })); });
  expect(screen.queryByRole("checkbox", { name: "已打款 WR-finance" })).not.toBeInTheDocument();
});
