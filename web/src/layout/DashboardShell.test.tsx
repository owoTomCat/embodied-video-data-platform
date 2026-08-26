import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountPublic } from "../auth/contracts";
import { IdentityProvider } from "../auth/client/IdentityContext";
import { InteractionProvider } from "../interactions/InteractionContext";
import { DashboardShell } from "./DashboardShell";

const operationsApi = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

vi.mock("../operations/client/operationsApi", () => ({
  getOperationsStatus: operationsApi.getStatus,
}));

const admin: AccountPublic = {
  id: "U-ADMIN-01",
  displayName: "管理员",
  username: "admin",
  role: "admin",
  status: "active",
  updatedAt: 1_722_708_000_000,
};

describe("DashboardShell", () => {
  beforeEach(() => {
    operationsApi.getStatus.mockReset().mockResolvedValue({
      generatedAt: 1,
      unreadCount: 2,
      summary: {
        processingSubmissions: 1,
        failedSubmissions: 1,
        reviewPending: 2,
        unsettledEligible: 0,
        pendingJobs: 0,
        failedJobs: 0,
        workerAlerts: 0,
        recentAudits: 0,
      },
      navigationBadges: [
        { path: "/admin/review", label: "2", count: 2 },
        { path: "/admin/submissions", label: "1", count: 1 },
      ],
      notifications: [
        {
          id: "admin-review-2",
          title: "有视频等待人工复核",
          detail: "2 条终态质检结果需要平台确认。",
          tone: "warning",
          path: "/admin/review",
          count: 2,
          createdAt: 1,
        },
        {
          id: "admin-submissions-1",
          title: "有提交处理失败",
          detail: "1 条视频处于系统失败或质检不通过状态。",
          tone: "danger",
          path: "/admin/submissions",
          count: 1,
          createdAt: 1,
        },
      ],
    });
  });

  it("shows the authenticated account and signs out once", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn().mockResolvedValue(undefined);
    render(
      <IdentityProvider currentAccount={admin} accounts={[admin]} teams={[]}>
        <InteractionProvider>
          <DashboardShell
            currentPath="/admin"
            navigate={vi.fn()}
            onLogout={onLogout}
          >
            <p>content</p>
          </DashboardShell>
        </InteractionProvider>
      </IdentityProvider>,
    );

    expect(screen.getByText("管理员")).toBeVisible();
    expect(screen.getByRole("link", { name: /^AI 任务/ })).toBeVisible();
    expect(screen.queryByLabelText("演示角色")).not.toBeInTheDocument();
    await user.dblClick(
      screen.getByRole("button", { name: "退出登录" }),
    );
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("shows live notification badges from the backend status snapshot", async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(
      <IdentityProvider currentAccount={admin} accounts={[admin]} teams={[]}>
        <InteractionProvider>
          <DashboardShell
            currentPath="/admin"
            navigate={navigate}
            onLogout={vi.fn()}
          >
            <p>content</p>
          </DashboardShell>
        </InteractionProvider>
      </IdentityProvider>,
    );

    const reviewLink = await screen.findByRole("link", { name: /^质量复核/ });
    expect(within(reviewLink).getByText("2")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "通知，2 条未读" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "通知，2 条未读" }));
    expect(screen.getByText("有视频等待人工复核")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: "查看" })[0]!);
    expect(navigate).toHaveBeenCalledWith("/admin/review");
  });

  it("highlights the parent navigation on detail pages and reports backend alerts", async () => {
    render(
      <IdentityProvider currentAccount={admin} accounts={[admin]} teams={[]}>
        <InteractionProvider>
          <DashboardShell
            currentPath="/admin/review/SUB-001"
            navigate={vi.fn()}
            onLogout={vi.fn()}
          >
            <p>content</p>
          </DashboardShell>
        </InteractionProvider>
      </IdentityProvider>,
    );

    expect(screen.getByRole("link", { name: /^质量复核/ })).toHaveClass(
      "nav-link-active",
    );
    expect(await screen.findByText("系统有待处理异常")).toBeVisible();
  });

  it("does not claim the system is healthy when status cannot be read", async () => {
    operationsApi.getStatus.mockRejectedValueOnce(new Error("offline"));
    render(
      <IdentityProvider currentAccount={admin} accounts={[admin]} teams={[]}>
        <InteractionProvider>
          <DashboardShell currentPath="/admin" navigate={vi.fn()} onLogout={vi.fn()}>
            <p>content</p>
          </DashboardShell>
        </InteractionProvider>
      </IdentityProvider>,
    );

    expect(await screen.findByText("暂时无法读取状态")).toBeVisible();
    expect(screen.queryByText("系统运行正常")).not.toBeInTheDocument();
  });
});
