"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Clock3, FileVideo, Timer } from "lucide-react";
import { MetricCard } from "../../components/MetricCard";
import { useIdentity } from "../../auth/client/IdentityContext";
import { useInteractions } from "../../interactions/InteractionContext";
import type { Submission } from "../../domain/types";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";
import {
  contributionMetrics,
  dailyContributions,
  formatDuration,
  formatRate,
  submissionsSince,
} from "./teamMetrics";

type PageMode = "loading" | "live" | "unavailable";

function trendHeight(uploads: number, maxUploads: number): string {
  if (uploads === 0) return "0%";
  return `${Math.max(8, (uploads / maxUploads) * 100)}%`;
}

function countPendingReview(submissions: Submission[]): number {
  return submissions.filter(
    (submission) =>
      submission.qualityResult?.status === "review_pending" &&
      submission.qualityResult.manualReview === undefined,
  ).length;
}

function countFailedTasks(submissions: Submission[]): number {
  return submissions.filter(
    (submission) => submission.pipelineStage === "system_failed",
  ).length;
}

export function TeamDashboard({
  navigate,
}: {
  navigate?(path: string): void;
}) {
  const { accounts, currentAccount, teams } = useIdentity();
  const { notify } = useInteractions();
  const currentTeam = teams.find((team) => team.id === currentAccount.teamId);
  const members = accounts.filter(
    (account) => account.teamId === currentTeam?.id,
  );
  const [teamSubmissions, setTeamSubmissions] = useState<Submission[]>([]);
  const [mode, setMode] = useState<PageMode>("loading");

  useEffect(() => {
    let active = true;
    loadAllSubmissions({ status: "all" })
      .then((result) => {
        if (!active) return;
        setTeamSubmissions(result.map(backendSubmissionToDomain));
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setTeamSubmissions([]);
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  const today = submissionsSince(teamSubmissions, 1);
  const month = submissionsSince(teamSubmissions, 30);
  const monthMetrics = contributionMetrics(month);
  const trend = dailyContributions(teamSubmissions, 7);
  const maxUploads = Math.max(1, ...trend.map((record) => record.uploads));
  const pendingReview = countPendingReview(teamSubmissions);
  const failedTasks = countFailedTasks(teamSubmissions);
  const totalUploads = trend.reduce((total, record) => total + record.uploads, 0);
  const metricsAvailable = mode === "live";
  const unavailableDetail =
    mode === "loading" ? "数据读取中" : "数据暂不可用";

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">团队运营总览</p>
          <h1>{currentTeam?.name ?? "团队工作台"}</h1>
          <span>
            当前 {members.filter((member) => member.status === "active").length} 个启用账号，
            {metricsAvailable
              ? `${pendingReview} 条数据需要人工关注`
              : unavailableDetail}
          </span>
        </div>
        <div className="button-row">
          <span className="live-pill">
            <i />
            {mode === "live"
              ? "已连接后端数据"
              : mode === "loading"
                ? "正在读取数据"
                : "数据暂不可用"}
          </span>
          <button
            className="button button-primary"
            onClick={() => {
              if (navigate) {
                navigate("/team/members");
              } else {
                notify("info", "请前往“成员管理”新增数采账号");
              }
            }}
          >
            邀请成员
          </button>
        </div>
      </div>
      <div className="metric-grid">
        <MetricCard
          label="上传视频数"
          value={metricsAvailable ? `${monthMetrics.uploads} 条` : "—"}
          detail={
            metricsAvailable
              ? `近 30 日 · 今日 ${today.length} 条`
              : unavailableDetail
          }
          icon={FileVideo}
          tone="violet"
        />
        <MetricCard
          label="上传总时长"
          value={metricsAvailable ? formatDuration(monthMetrics.totalSeconds) : "—"}
          detail={
            metricsAvailable
              ? `近 30 日 · 有效 ${formatDuration(monthMetrics.effectiveSeconds)}`
              : unavailableDetail
          }
          icon={Clock3}
          tone="amber"
        />
        <MetricCard
          label="视频平均分"
          value={
            metricsAvailable && monthMetrics.averageScore !== null
              ? monthMetrics.averageScore.toFixed(1)
              : "—"
          }
          detail={
            metricsAvailable
              ? `${monthMetrics.reviewed} 条已有终态质检`
              : unavailableDetail
          }
          icon={BadgeCheck}
          tone="green"
        />
        <MetricCard
          label="高分有效时长"
          value={
            metricsAvailable
              ? formatDuration(monthMetrics.highScoreEffectiveSeconds)
              : "—"
          }
          detail={
            metricsAvailable
              ? `80 分及以上 · 通过率 ${formatRate(monthMetrics.passRate)}`
              : unavailableDetail
          }
          icon={Timer}
        />
      </div>
      <div className="dashboard-grid">
        <section className="content-card content-card-wide">
          <div className="card-heading">
            <div>
              <h2>团队数据趋势</h2>
              <p>近 7 日真实上传量</p>
            </div>
          </div>
          <div className="large-chart-placeholder" aria-label="近 7 日上传趋势">
            {!metricsAvailable ? (
              <span className="chart-empty-hint">{unavailableDetail}</span>
            ) : totalUploads === 0 ? (
              <span className="chart-empty-hint">近 7 日暂无上传数据</span>
            ) : (
              trend.map((record) => (
                <div
                  className="chart-column"
                  key={record.date}
                  title={`${record.date} · ${record.uploads} 条 · ${formatDuration(record.effectiveSeconds)}`}
                >
                  <i style={{ height: trendHeight(record.uploads, maxUploads) }} />
                  <span>{record.date.slice(5)}</span>
                </div>
              ))
            )}
          </div>
        </section>
        <aside className="content-card">
          <div className="card-heading">
            <div><h2>待处理事项</h2><p>根据真实任务状态汇总</p></div>
          </div>
          <div className="todo-list">
            <div>
              <span className="dot dot-red" />
              <p>
                <strong>{metricsAvailable ? `${pendingReview} 条数据待关注` : "—"}</strong>
                <small>{metricsAvailable ? "AI 已标记需要人工复核" : unavailableDetail}</small>
              </p>
            </div>
            <div>
              <span className="dot dot-amber" />
              <p>
                <strong>{metricsAvailable ? `${failedTasks} 个系统任务失败` : "—"}</strong>
                <small>{metricsAvailable ? "可联系平台管理员排查或重跑" : unavailableDetail}</small>
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
