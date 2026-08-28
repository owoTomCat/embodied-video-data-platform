import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

// 团队金额页测试需要确定性后端不可用状态：mock 相关 API 使其拒绝
vi.mock("../../points/client/pointCycleApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../points/client/pointCycleApi")>();
  return {
    ...actual,
    listPointCycles: vi.fn().mockRejectedValue(new Error("unavailable")),
    getPointRule: vi.fn().mockRejectedValue(new Error("unavailable")),
  };
});
vi.mock("../../submissions/client/submissionApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../submissions/client/submissionApi")>();
  return {
    ...actual,
    loadAllSubmissions: vi.fn().mockRejectedValue(new Error("unavailable")),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderLeader(path: string) {
  window.history.replaceState({}, "", path);
  const leader = accountForRole("leader");
  return render(
    <IdentityProvider
      currentAccount={leader}
      accounts={demoAccounts}
      teams={[{ id: "TEAM-01", name: "星火一队", status: "active", unitPricePerMinute: 12, createdAt: 1_722_708_000_000, updatedAt: 1_722_708_000_000 }]}
    >
      <PlatformApp initialPath={path} />
    </IdentityProvider>,
  );
}

describe("team member interactions", () => {
  it("labels member contribution values as real derived metrics", () => {
    renderLeader("/team/members");

    expect(screen.getByRole("note")).toHaveTextContent(
      "近 30 日上传、有效时长和通过率均根据真实提交与 AI 终态结果计算",
    );
    expect(screen.getByRole("table")).toHaveAccessibleDescription(
      "近 30 日上传、有效时长和通过率均根据真实提交与 AI 终态结果计算",
    );
  });

  it("downloads the current member statistics as a CSV file", async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue("blob:member-metrics");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    renderLeader("/team/members");

    await user.click(await screen.findByRole("button", { name: "导出统计" }));

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    await expect(blob.text()).resolves.toContain(
      '"成员","用户名","角色","状态","上传数","已质检数","通过数","未通过数","有效分钟","平均分","通过率(%)"',
    );
    expect(click.mock.instances[0]).toMatchObject({
      href: "blob:member-metrics",
      download: "星火一队-近 30 日成员统计.csv",
    });
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:member-metrics");
    expect(screen.getByText("成员统计已导出")).toBeVisible();
  });

  it("opens the own-team collector account form", async () => {
    const user = userEvent.setup();
    renderLeader("/team/members");

    await user.click(
      await screen.findByRole("button", { name: "新增数采账号" }),
    );

    expect(
      screen.getByRole("dialog", { name: "新增数采账号" }),
    ).toBeVisible();
    expect(screen.getByText("账号将自动归属星火一队")).toBeVisible();
    expect(screen.getByText("5 位成员")).toBeVisible();
  });

  it("opens read-only member details with contribution metrics", async () => {
    const user = userEvent.setup();
    renderLeader("/team/members");

    const viewButtons = await screen.findAllByRole("button", { name: "查看" });
    await user.click(viewButtons[0]);

    const dialog = screen.getByRole("dialog", { name: "成员详情" });
    expect(within(dialog).getByText("tuanzhang1")).toBeVisible();
    expect(within(dialog).getByText("近 30 日上传")).toBeVisible();
    expect(within(dialog).getByText("有效时长")).toBeVisible();
    expect(within(dialog).getByText("通过率")).toBeVisible();
    expect(within(dialog).getByRole("note")).toHaveTextContent(
      "以下指标根据该成员近 30 日的真实视频提交和 AI 质检结果计算",
    );
    expect(
      within(dialog).getByRole("group", { name: "成员表现" }),
    ).toHaveAccessibleDescription(
      "以下指标根据该成员近 30 日的真实视频提交和 AI 质检结果计算",
    );
  });

  it("guides leaders to the working member management entry", async () => {
    const user = userEvent.setup();
    renderLeader("/team");

    await user.click(
      await screen.findByRole("button", { name: "邀请成员" }),
    );
    expect(
      screen.getByRole("heading", { name: "成员管理" }),
    ).toBeVisible();
  });

  it("shows real-data team points instead of simulated balances", async () => {
    renderLeader("/team/income");

    expect(screen.getByRole("heading", { name: "团队金额汇总" })).toBeVisible();
    expect(await screen.findByText("数据暂不可用")).toBeVisible();
    expect(screen.getByText(/用于线下核对/)).toBeVisible();
    expect(screen.queryByText("成员可用余额")).not.toBeInTheDocument();
  });
});
