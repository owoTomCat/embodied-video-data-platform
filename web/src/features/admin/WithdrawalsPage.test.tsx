import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WithdrawalsPage } from "./WithdrawalsPage";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import type { WithdrawalDetail, WithdrawalRequest } from "../../wallet/contracts";

let row: WithdrawalRequest;
let detail: WithdrawalDetail;
let conflict = false;
const actor = accountForRole("admin");
beforeEach(() => {
  conflict = false;
  row = { id: "WR-finance", ownerId: "U-collector", ownerName: "Collector", teamName: null, assigneeId: null, assigneeName: null, assignedAt: null, registeredById: null, reviewedById: null, reviewedAt: null, reviewMode: null, latestRegistrationId: null, revision: 0, overdue: true, amount: 8.25, status: "pending", method: "bank", accountMasked: "***1234", nameMasked: "张***", batchId: null, reason: null, transferReference: null, paidAt: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  detail = { request: row, registrations: [], evidence: [], timeline: [], admins: [{ id: actor.id, displayName: actor.displayName }, { id: "other-admin", displayName: "Reviewer" }], singleConfirmationAllowed: false };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (path.endsWith("/summary")) return json(Object.fromEntries(["pending", "processing", "reviewPending", "investigating", "overdue"].map(key => [key, { count: 1, amount: 8.25 }])));
    if (path.endsWith("/withdrawals")) { const requests = url.searchParams.get("status") === row.status ? [row] : []; return json({ requests, pagination: { page: 1, pageSize: 25, total: requests.length, totalPages: 1 } }); }
    if (path.endsWith("/withdrawal-batches")) { row = { ...row, status: "processing", batchId: "WB-finance", assigneeId: actor.id, assigneeName: actor.displayName, revision: row.revision + 1 }; return json({ batchId: row.batchId, requests: [row] }); }
    if (path.endsWith("/recipient")) return json({ recipient: { method: "bank", name: "张三", account: "622200001234", bankName: "测试银行" } });
    if (path.endsWith("/evidence")) {
      if (!(init?.body instanceof FormData) || new Headers(init.headers).has("content-type")) return json({ error: "multipart boundary missing" }, 400);
      const file = init.body.get("file") as File;
      const evidence = { id: "proof-1", originalFileName: file.name, contentType: file.type, sizeBytes: file.size, sha256: "a".repeat(64), uploadedById: actor.id, createdAt: "2026-01-02T01:00:00Z" };
      detail.evidence.push(evidence); return json({ evidence });
    }
    if (path.endsWith("/register")) {
      if (conflict) { row = { ...row, status: "investigating", assigneeId: "other-admin", assigneeName: "Reviewer", revision: row.revision + 1 }; return json({ error: "conflict" }, 409); }
      if (!body.evidenceIds.length || !body.transferReference) return json({ error: "proof required" }, 400);
      detail.registrations.push({ id: "reg-1", registeredById: actor.id, registeredByName: actor.displayName, transferReference: body.transferReference, paidAt: body.paidAt, evidenceIds: body.evidenceIds, note: null, createdAt: "2026-01-02T02:00:00Z" });
      row = { ...row, status: "review_pending", registeredById: actor.id, latestRegistrationId: "reg-1", revision: row.revision + 1 }; return json({ request: row });
    }
    if (path.endsWith("/review")) { row = { ...row, status: body.decision === "return" ? "investigating" : "paid", reviewMode: body.mode, revision: row.revision + 1 }; return json({ request: row }); }
    if (path.endsWith("/WR-finance")) return json({ ...detail, request: row });
    throw new Error(`Unexpected wallet request ${path}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function renderWorkbench() {
  render(<IdentityProvider currentAccount={actor} accounts={demoAccounts} teams={[]}><WithdrawalsPage /></IdentityProvider>);
}
async function claimAndOpen(user: UserEvent) {
  await user.click(await screen.findByLabelText("选择 WR-finance"));
  await user.click(screen.getByRole("button", { name: /领取所选申请/ }));
  await user.click(await screen.findByRole("button", { name: "处理详情 WR-finance" }));
  await screen.findByLabelText("实际转账参考号");
}
async function fillRegistration(user: UserEvent) {
  await user.type(screen.getByLabelText("实际转账参考号"), "BANK-123");
  fireEvent.change(screen.getByLabelText("实际转账时间（上海 UTC+08:00）"), { target: { value: "2026-01-02T12:30" } });
  await user.upload(screen.getByLabelText(/上传凭证/), new File(["proof"], "bank.png", { type: "image/png" }));
  await screen.findByRole("button", { name: /下载凭证 bank.png/ });
}
it("claims without export, explicitly reveals private recipient, uploads multipart proof and cannot self-review", async () => {
  const user = userEvent.setup(); renderWorkbench(); await claimAndOpen(user);
  expect(screen.queryByText(/622200001234/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /授权查看完整收款信息/ }));
  expect(await screen.findByText(/622200001234/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "关闭提现处理详情" }));
  await user.click(screen.getByRole("button", { name: "处理详情 WR-finance" }));
  await screen.findByLabelText("实际转账参考号");
  expect(screen.queryByText(/622200001234/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "登记实际转账并提交复核" })).toBeDisabled();
  await fillRegistration(user);
  await user.click(screen.getByRole("button", { name: "登记实际转账并提交复核" }));
  expect(await screen.findByRole("heading", { name: "BANK-123" })).toBeVisible();
  expect(screen.getByRole("button", { name: "复核通过并记为已付款" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "登记实际转账并提交复核" })).not.toBeInTheDocument();
});
it("reopens current state on a registration conflict and removes stale assignee actions", async () => {
  const user = userEvent.setup(); renderWorkbench(); await claimAndOpen(user); await fillRegistration(user); conflict = true;
  await user.click(screen.getByRole("button", { name: "登记实际转账并提交复核" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByRole("button", { name: "登记实际转账并提交复核" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByText(/经办人 Reviewer/)).toBeVisible();
});
it("requires explicit single-mode acknowledgement rather than silently approving own registration", async () => {
  const user = userEvent.setup();
  row = { ...row, status: "review_pending", assigneeId: actor.id, registeredById: actor.id };
  detail.singleConfirmationAllowed = true; detail.admins = [{ id: actor.id, displayName: actor.displayName }];
  renderWorkbench(); await user.click(screen.getByRole("button", { name: "待复核" }));
  await user.click(await screen.findByRole("button", { name: "处理详情 WR-finance" }));
  const approve = await screen.findByRole("button", { name: "复核通过并记为已付款" });
  expect(approve).toBeDisabled();
  await user.click(screen.getByLabelText(/我明确选择单人确认/)); await user.click(approve);
  expect(await screen.findByText("单人确认，未经独立复核")).toBeVisible();
  expect(screen.queryByRole("button", { name: "复核通过并记为已付款" })).not.toBeInTheDocument();
});
it("returns an independently reviewed registration to investigation without enabling a second payment", async () => {
  const user = userEvent.setup();
  row = { ...row, status: "review_pending", assigneeId: "other-admin", assigneeName: "Reviewer", registeredById: "other-admin", latestRegistrationId: "reg-existing" };
  detail.registrations = [{ id: "reg-existing", registeredById: "other-admin", registeredByName: "Reviewer", transferReference: "ORIGINAL-TRANSFER", paidAt: "2026-01-02T00:00:00Z", evidenceIds: [], note: null, createdAt: "2026-01-02T01:00:00Z" }];
  renderWorkbench(); await user.click(screen.getByRole("button", { name: "待复核" }));
  await user.click(await screen.findByRole("button", { name: "处理详情 WR-finance" }));
  const returnButton = await screen.findByRole("button", { name: /退回调查/ });
  expect(returnButton).toBeDisabled();
  await user.type(screen.getByLabelText("原因（不要填写完整收款账号）"), "银行记录尚待核对");
  await user.click(returnButton);
  expect(await screen.findByRole("button", { name: /确认未付 \/ 已退回并释放预留/ })).toBeDisabled();
  expect(screen.getByRole("heading", { name: "ORIGINAL-TRANSFER" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "登记实际转账并提交复核" })).not.toBeInTheDocument();
});
