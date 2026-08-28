"use client";

import { Layers } from "lucide-react";

import type { BackendSubmissionTaskStat } from "../submissions/contracts";
import { TaskTypeBadge } from "./TaskTypeBadge";

export type TaskDimensionFilter = string;

function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

function formatScore(score: number | null): string {
  return score === null ? "—" : `${score.toFixed(1)} 分`;
}

function formatMinutes(minutes: number): string {
  return `${Math.round(minutes * 10) / 10} 分钟`;
}

function formatPoints(points: number): string {
  return `${Math.round(points * 100) / 100} 分`;
}

function overall(stats: BackendSubmissionTaskStat[]): BackendSubmissionTaskStat {
  const total = stats.reduce((sum, stat) => sum + stat.total, 0);
  const reviewed = stats.reduce((sum, stat) => sum + stat.reviewed, 0);
  const passed = stats.reduce((sum, stat) => sum + stat.passed, 0);
  const effectiveMinutes = stats.reduce(
    (sum, stat) => sum + stat.effectiveMinutes,
    0,
  );
  const lockedPoints = stats.reduce((sum, stat) => sum + stat.lockedPoints, 0);
  const scoreSum = stats.reduce(
    (sum, stat) => sum + (stat.avgScore === null ? 0 : stat.avgScore),
    0,
  );
  const scoredCount = stats.filter((stat) => stat.avgScore !== null).length;
  return {
    taskId: null,
    title: "全部任务",
    sceneName: "",
    taskType: "none",
    total,
    reviewed,
    passed,
    failed: stats.reduce((sum, stat) => sum + stat.failed, 0),
    pending: Math.max(0, total - reviewed),
    passRate: reviewed > 0 ? Math.round((passed / reviewed) * 1_000) / 10 : null,
    avgScore: scoredCount > 0 ? Math.round((scoreSum / scoredCount) * 10) / 10 : null,
    effectiveMinutes,
    lockedPoints,
  };
}

function TaskStatCard({
  stat,
  active,
  onSelect,
  tone,
}: {
  stat: BackendSubmissionTaskStat;
  active: boolean;
  onSelect(value: string): void;
  tone: "summary" | "task" | "none";
}) {
  const value = stat.taskId ?? "__none__";
  const isAll = tone === "summary";
  return (
    <button
      type="button"
      className={`task-dim-card task-dim-${tone}${active ? " active" : ""}`}
      aria-pressed={active}
      onClick={() => onSelect(active ? "all" : value)}
      title={active ? "点击取消该任务筛选" : "点击按该任务筛选数据"}
    >
      <span className="task-dim-card-head">
        {isAll ? (
          <span className="task-dim-all-icon"><Layers size={14} /></span>
        ) : stat.taskType === "none" ? (
          <span className="task-dim-none-badge">未关联</span>
        ) : (
          <TaskTypeBadge type={stat.taskType} />
        )}
        <strong>{stat.title}</strong>
      </span>
      {!isAll && stat.sceneName && (
        <span className="task-dim-scene">{stat.sceneName}</span>
      )}
      <span className="task-dim-metrics">
        <span><em>提交</em><b>{stat.total}</b></span>
        <span><em>通过率</em><b>{formatRate(stat.passRate)}</b></span>
        <span><em>均分</em><b>{formatScore(stat.avgScore)}</b></span>
        <span><em>有效时长</em><b>{formatMinutes(stat.effectiveMinutes)}</b></span>
        <span><em>锁定金额</em><b>{formatPoints(stat.lockedPoints)}</b></span>
      </span>
      {active && <span className="task-dim-active">筛选中</span>}
    </button>
  );
}

/**
 * 任务维度统计条：按任务汇总提交/质检/积分，点击卡片与列表 taskId 筛选联动。
 * 三端（管理员全平台 / 团长本队 / 数采本人）共用，范围由后端 task-stats 接口保证。
 */
export function TaskDimensionStats({
  stats,
  active,
  onSelect,
  loading = false,
}: {
  stats: BackendSubmissionTaskStat[];
  active: string;
  onSelect(value: string): void;
  loading?: boolean;
}) {
  if (loading && stats.length === 0) {
    return (
      <section className="content-card task-dimension-stats" aria-label="任务维度统计">
        <div className="task-dim-empty">正在读取任务维度统计…</div>
      </section>
    );
  }
  if (stats.length === 0) {
    return null;
  }
  const summary = overall(stats);
  const noneStat = stats.find((stat) => stat.taskId === null);
  const taskStats = stats.filter((stat) => stat.taskId !== null);
  return (
    <section className="content-card task-dimension-stats" aria-label="任务维度统计">
      <div className="task-dim-header">
        <strong>任务维度</strong>
        <small>点击卡片筛选列表数据，范围与当前角色可见数据一致</small>
      </div>
      <div className="task-dim-scroll">
        <TaskStatCard stat={summary} active={active === "all"} onSelect={onSelect} tone="summary" />
        {taskStats.map((stat) => (
          <TaskStatCard
            key={stat.taskId ?? "none"}
            stat={stat}
            active={active === (stat.taskId ?? "__none__")}
            onSelect={onSelect}
            tone="task"
          />
        ))}
        {noneStat && (
          <TaskStatCard
            stat={noneStat}
            active={active === "__none__"}
            onSelect={onSelect}
            tone="none"
          />
        )}
      </div>
    </section>
  );
}
