import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BackendSubmissionTaskStat } from "../submissions/contracts";
import { TaskDimensionStats } from "./TaskDimensionStats";

const stats: BackendSubmissionTaskStat[] = [
  {
    taskId: "TASK-1",
    title: "厨房预设任务",
    sceneName: "家庭-厨房",
    taskType: "preset",
    total: 5,
    reviewed: 4,
    passed: 3,
    failed: 1,
    pending: 1,
    passRate: 75,
    avgScore: 82.5,
    effectiveMinutes: 12.4,
    lockedPoints: 96.4,
  },
  {
    taskId: "TASK-2",
    title: "通用综合采集",
    sceneName: "通用",
    taskType: "generic",
    total: 2,
    reviewed: 1,
    passed: 1,
    failed: 0,
    pending: 1,
    passRate: 100,
    avgScore: 90,
    effectiveMinutes: 4.2,
    lockedPoints: 20,
  },
  {
    taskId: null,
    title: "未关联任务",
    sceneName: "",
    taskType: "none",
    total: 1,
    reviewed: 0,
    passed: 0,
    failed: 0,
    pending: 1,
    passRate: null,
    avgScore: null,
    effectiveMinutes: 0,
    lockedPoints: 0,
  },
];

describe("TaskDimensionStats", () => {
  it("renders an overall summary card plus per-task and legacy buckets", () => {
    render(
      <TaskDimensionStats stats={stats} active="all" onSelect={vi.fn()} />,
    );
    expect(screen.getByText("全部任务")).toBeInTheDocument();
    expect(screen.getByText("厨房预设任务")).toBeInTheDocument();
    expect(screen.getByText("通用综合采集")).toBeInTheDocument();
    expect(screen.getByText("未关联任务")).toBeInTheDocument();
    // 类型徽标
    expect(screen.getByText("预设")).toBeInTheDocument();
    expect(screen.getAllByText("通用").length).toBeGreaterThan(0);
    // 汇总提交数
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("selects a task on click and deselects when clicked again", () => {
    const onSelect = vi.fn();
    render(
      <TaskDimensionStats stats={stats} active="all" onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText("厨房预设任务"));
    expect(onSelect).toHaveBeenCalledWith("TASK-1");

    fireEvent.click(screen.getByText("未关联任务"));
    expect(onSelect).toHaveBeenCalledWith("__none__");
  });

  it("highlights the active task and lets the user clear the filter", () => {
    const onSelect = vi.fn();
    render(
      <TaskDimensionStats stats={stats} active="TASK-2" onSelect={onSelect} />,
    );
    const genericCard = screen
      .getByText("通用综合采集")
      .closest("button");
    expect(genericCard?.className).toContain("active");
    fireEvent.click(screen.getByText("通用综合采集"));
    expect(onSelect).toHaveBeenCalledWith("all");
  });

  it("shows a loading placeholder when no stats have arrived", () => {
    render(
      <TaskDimensionStats stats={[]} active="all" onSelect={vi.fn()} loading />,
    );
    expect(screen.getByText(/正在读取任务维度统计/)).toBeInTheDocument();
  });

  it("renders nothing when the backend returned no stats", () => {
    const { container } = render(
      <TaskDimensionStats stats={[]} active="all" onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
