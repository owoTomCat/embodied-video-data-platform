import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { InteractionProvider } from "../../interactions/InteractionContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { AuditLogPage } from "./AuditLogPage";
import { searchAccountAudit } from "../../auth/client/accountApi";

vi.mock("../../auth/client/accountApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../auth/client/accountApi")>();
  return {
    ...actual,
    searchAccountAudit: vi.fn(),
  };
});

const searchAccountAuditMock = vi.mocked(searchAccountAudit);

function renderPage() {
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <InteractionProvider>
        <AuditLogPage />
      </InteractionProvider>
    </IdentityProvider>,
  );
}

describe("AuditLogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchAccountAuditMock.mockResolvedValue({
      logs: [
        {
          id: "AUD-ACCOUNT-01",
          actorAccountId: "U-ADMIN-01",
          actorName: "管理员",
          action: "reset_password",
          targetAccountId: "U-COL-01",
          targetName: "测试人员1",
          summary: "管理员重置了测试人员1的密码",
          createdAt: Date.UTC(2026, 7, 4, 6, 30),
        },
      ],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 21,
        totalPages: 2,
      },
    });
  });

  it("loads server-side audit logs with pagination", async () => {
    renderPage();

    expect(await screen.findByText("重置密码")).toBeVisible();
    expect(screen.getByText("测试人员1")).toBeVisible();
    expect(screen.getByText("后端筛选 1-1 / 21 条")).toBeVisible();
    expect(screen.getByRole("link", { name: "导出日志" })).toHaveAttribute(
      "href",
      "http://localhost:4000/api/v1/audit-logs/export.csv",
    );
    expect(searchAccountAuditMock).toHaveBeenCalledWith({
      q: "",
      actor: "",
      action: "all",
      from: "",
      to: "",
      page: 1,
      pageSize: 20,
    });
  });

  it("labels every persisted identity action and safely falls back for unknown actions", async () => {
    searchAccountAuditMock.mockResolvedValue({
      logs: [
          "change_password",
          "local_identity_reconcile",
          "team_create",
          "team_update",
          "ai_quality_rerun",
          "point_cycle_lock",
          "point_cycle_adjustment",
          "delivery_package_create",
          "future_action",
        ].map((action, index) => ({
        id: `AUD-ACTION-${index}`,
        actorAccountId: "U-ADMIN-01",
        actorName: "管理员",
        action,
        targetAccountId: "U-COL-01",
        targetName: `对象${index}`,
        summary: `操作说明${index}`,
        createdAt: Date.UTC(2026, 7, 4, 7, index),
      })),
      pagination: {
        page: 1,
        pageSize: 20,
        total: 9,
        totalPages: 1,
      },
    });
    renderPage();

    expect(await screen.findByText("修改密码")).toBeVisible();
    expect(screen.getAllByText("本地账号校准").at(-1)).toBeVisible();
    expect(screen.getAllByText("创建团队").at(-1)).toBeVisible();
    expect(screen.getAllByText("更新团队").at(-1)).toBeVisible();
    expect(screen.getAllByText("重跑 AI 质检").at(-1)).toBeVisible();
    expect(screen.getAllByText("锁定积分周期")[0]).toBeVisible();
    expect(screen.getAllByText("周期积分调整").at(-1)).toBeVisible();
    expect(screen.getAllByText("创建交付包").at(-1)).toBeVisible();
    expect(screen.getByText("未知操作")).toBeVisible();
  });

  it("sends filters and page changes to the backend", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("重置密码");
    await user.type(screen.getByLabelText("搜索"), "密码");
    await user.type(screen.getByLabelText("操作人"), "管理员");
    await user.selectOptions(screen.getByLabelText("动作筛选"), "reset_password");
    await user.type(screen.getByLabelText("开始日期"), "2026-08-04");
    await user.type(screen.getByLabelText("结束日期"), "2026-08-05");
    await waitFor(() =>
      expect(searchAccountAuditMock).toHaveBeenLastCalledWith({
        q: "密码",
        actor: "管理员",
        action: "reset_password",
        from: "2026-08-04",
        to: "2026-08-05",
        page: 1,
        pageSize: 20,
      }),
    );
    expect(screen.getByRole("link", { name: "导出日志" })).toHaveAttribute(
      "href",
      "http://localhost:4000/api/v1/audit-logs/export.csv?q=%E5%AF%86%E7%A0%81&actor=%E7%AE%A1%E7%90%86%E5%91%98&action=reset_password&from=2026-08-04&to=2026-08-05",
    );

    await user.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() =>
      expect(searchAccountAuditMock).toHaveBeenLastCalledWith({
        q: "密码",
        actor: "管理员",
        action: "reset_password",
        from: "2026-08-04",
        to: "2026-08-05",
        page: 2,
        pageSize: 20,
      }),
    );
  });
});
