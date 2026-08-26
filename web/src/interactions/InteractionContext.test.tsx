import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractionProvider, useInteractions } from "./InteractionContext";

function InteractionProbe() {
  const {
    notifications,
    unreadCount,
    notify,
    markAllRead,
    syncOperationsStatus,
  } = useInteractions();

  return (
    <div>
      <span>{unreadCount} 条未读</span>
      <span>{notifications[0]?.title}</span>
      <button onClick={() => notify("success", "操作已完成")}>
        发送成功提示
      </button>
      <button onClick={() => notify("info", "第一条")}>第一条</button>
      <button onClick={() => notify("info", "第二条")}>第二条</button>
      <button onClick={() => notify("info", "第三条")}>第三条</button>
      <button onClick={() => notify("info", "第四条")}>第四条</button>
      <button onClick={() => notify("error", "操作失败")}>发送错误提示</button>
      <button onClick={markAllRead}>全部标为已读</button>
      <button
        onClick={() =>
          syncOperationsStatus({
            generatedAt: 1,
            unreadCount: 1,
            summary: {
              processingSubmissions: 0,
              failedSubmissions: 1,
              reviewPending: 0,
              unsettledEligible: 0,
              pendingJobs: 0,
              failedJobs: 0,
              workerAlerts: 0,
              recentAudits: 0,
            },
            navigationBadges: [
              { path: "/admin/submissions", count: 1, label: "1" },
            ],
            notifications: [
              {
                id: "submission-failed-1",
                title: "有提交处理失败",
                detail: "1 条视频需要处理。",
                tone: "danger",
                path: "/admin/submissions",
                count: 1,
                createdAt: 1,
              },
            ],
          })
        }
      >
        同步通知
      </button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("InteractionProvider", () => {
  it("starts without fabricated notifications and still shows feedback", async () => {
    const user = userEvent.setup();
    render(
      <InteractionProvider>
        <InteractionProbe />
      </InteractionProvider>,
    );

    expect(screen.getByText("0 条未读")).toBeVisible();
    expect(screen.queryByText("团队质检结果已更新")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "发送成功提示" }));
    expect(screen.getByText("操作已完成")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "全部标为已读" }));
    expect(screen.getByText("0 条未读")).toBeVisible();
  });

  it("keeps only the three most recent toasts", async () => {
    const user = userEvent.setup();
    render(
      <InteractionProvider>
        <InteractionProbe />
      </InteractionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "第一条" }));
    await user.click(screen.getByRole("button", { name: "第二条" }));
    await user.click(screen.getByRole("button", { name: "第三条" }));
    await user.click(screen.getByRole("button", { name: "第四条" }));

    expect(screen.queryByRole("status", { name: "第一条" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "第二条" })).toBeVisible();
    expect(screen.getByRole("status", { name: "第三条" })).toBeVisible();
    expect(screen.getByRole("status", { name: "第四条" })).toBeVisible();
  });

  it("auto-dismisses success toasts but keeps errors until dismissed", async () => {
    vi.useFakeTimers();
    render(
      <InteractionProvider>
        <InteractionProbe />
      </InteractionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送成功提示" }));
    fireEvent.click(screen.getByRole("button", { name: "发送错误提示" }));

    act(() => vi.advanceTimersByTime(2800));
    expect(screen.queryByText("操作已完成")).not.toBeInTheDocument();
    expect(screen.getByText("操作失败")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "关闭操作失败" }));
    expect(screen.queryByText("操作失败")).not.toBeInTheDocument();
  });

  it("persists an explicit mark-all-read action across remounts", async () => {
    const user = userEvent.setup();
    const first = render(
      <InteractionProvider>
        <InteractionProbe />
      </InteractionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "同步通知" }));
    expect(screen.getByText("1 条未读")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "全部标为已读" }));
    expect(screen.getByText("0 条未读")).toBeVisible();
    first.unmount();

    render(
      <InteractionProvider>
        <InteractionProbe />
      </InteractionProvider>,
    );
    await user.click(screen.getByRole("button", { name: "同步通知" }));

    expect(screen.getByText("0 条未读")).toBeVisible();
  });
});
