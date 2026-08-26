"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, ChartNoAxesCombined, RotateCcw, Target } from "lucide-react";
import { MetricCard } from "../../components/MetricCard";
import { TaskTypeBadge } from "../../components/TaskTypeBadge";
import { useIdentity } from "../../auth/client/IdentityContext";
import type { Submission } from "../../domain/types";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";
import {
  contributionMetrics,
  formatDuration,
  formatRate,
  sceneContributions,
  submissionsSince,
  taskContributions,
} from "./teamMetrics";

const sceneColors = ["#4775ef", "#805de2", "#39b985", "#e5a03f"];
type PageMode = "loading" | "live" | "unavailable";

function visibleScenes(scenes: ReturnType<typeof sceneContributions>) {
  if (scenes.length <= 4) return scenes;
  const leading = scenes.slice(0, 3);
  const remaining = scenes.slice(3);
  return [
    ...leading,
    {
      scene: "其他",
      seconds: remaining.reduce((sum, scene) => sum + scene.seconds, 0),
      percentage: remaining.reduce((sum, scene) => sum + scene.percentage, 0),
    },
  ];
}

function sceneGradient(scenes: ReturnType<typeof sceneContributions>): string {
  if (scenes.length === 0) return "#edf1f8";
  let offset = 0;
  const stops = scenes.map((scene, index) => {
    const start = offset;
    offset += scene.percentage;
    return `${sceneColors[index]} ${start}% ${offset}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

export function TeamAnalyticsPage() {
  const { accounts, currentAccount, teams } = useIdentity();
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

  const monthSubmissions = submissionsSince(teamSubmissions, 30);
  const metrics = contributionMetrics(monthSubmissions);
  const scenes = sceneContributions(monthSubmissions);
  const tasks = taskContributions(monthSubmissions);
  const displayedScenes = visibleScenes(scenes);
  const contributions = members
    .map((member) => ({
      member,
      metrics: contributionMetrics(
        monthSubmissions.filter((submission) => submission.ownerId === member.id),
      ),
    }))
    .filter((item) => item.metrics.uploads > 0)
    .sort((left, right) => right.metrics.effectiveSeconds - left.metrics.effectiveSeconds);
  const maxContribution = Math.max(
    1,
    ...contributions.map((item) => item.metrics.effectiveSeconds),
  );
  const averageEffectiveSeconds =
    contributions.length === 0
      ? null
      : metrics.effectiveSeconds / contributions.length;
  const pendingCount = monthSubmissions.filter(
    (submission) => submission.qualityStatus === "pending",
  ).length;

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">近 30 日表现</p>
          <h1>团队分析</h1>
          <span>{currentTeam?.name} 的场景分布、成员贡献和质量结果</span>
        </div>
        <span className="live-pill">
          <i />
          {mode === "live"
            ? "已连接后端数据"
            : mode === "loading"
              ? "正在读取数据"
              : "数据暂不可用"}
        </span>
      </div>
      <div className="metric-grid">
        <MetricCard label="团队通过率" value={formatRate(metrics.passRate)} detail={`${metrics.reviewed} 条终态结果`} icon={BadgeCheck} tone="green" />
        <MetricCard label="人均有效时长" value={averageEffectiveSeconds === null ? "—" : formatDuration(averageEffectiveSeconds)} detail="按有上传的成员平均 · 近 30 日累计" icon={ChartNoAxesCombined} />
        <MetricCard label="不通过率" value={metrics.passRate === null ? "—" : formatRate(100 - metrics.passRate)} detail={`${metrics.failed} 条未通过`} icon={RotateCcw} tone="amber" />
        <MetricCard label="待质检数据" value={`${pendingCount} 条`} detail={`共上传 ${metrics.uploads} 条`} icon={Target} tone="violet" />
      </div>
      <div className="dashboard-grid">
        <section className="content-card">
          <div className="card-heading">
            <div><h2>场景分布</h2><p>通过质检的真实有效时长占比</p></div>
          </div>
          <div className="distribution-chart">
            <div className="donut-chart" style={{ background: sceneGradient(displayedScenes) }}><strong>{formatDuration(scenes.reduce((sum, scene) => sum + scene.seconds, 0))}<small>有效时长</small></strong></div>
            {displayedScenes.length > 0 ? (
              <ul>
                {displayedScenes.map((scene, index) => (
                  <li key={scene.scene}>
                    <i style={{ background: sceneColors[index] }} />
                    {scene.scene}
                    <strong>{scene.percentage.toFixed(1)}%</strong>
                  </li>
                ))}
              </ul>
            ) : <div className="empty-state compact-empty"><strong>暂无已通过数据</strong><span>AI 质检完成后将在这里显示场景占比</span></div>}
          </div>
        </section>
        <aside className="content-card">
          <div className="card-heading"><div><h2>成员贡献</h2><p>按近 30 日有效时长排序</p></div></div>
          {contributions.length > 0 ? (
            <div className="ranking-list">
              {contributions.map(({ member, metrics: memberMetrics }, index) => (
                <div key={member.id}>
                  <em>{index + 1}</em>
                  <span><strong>{member.displayName}</strong><i><b style={{ width: `${(memberMetrics.effectiveSeconds / maxContribution) * 100}%` }} /></i></span>
                  <small>{formatDuration(memberMetrics.effectiveSeconds)}</small>
                </div>
              ))}
            </div>
          ) : <div className="empty-state compact-empty"><strong>暂无成员贡献</strong><span>成员上传视频后将在这里汇总</span></div>}
        </aside>
      </div>
      <section className="content-card">
        <div className="card-heading">
          <div><h2>任务分布</h2><p>近 30 日按任务维度汇总的提交与有效时长</p></div>
        </div>
        {tasks.length > 0 ? (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>类型</th>
                  <th>提交</th>
                  <th>通过率</th>
                  <th>有效时长</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.taskId ?? "__none__"}>
                    <td>
                      <strong>{task.title}</strong>
                      {task.sceneName && <small className="row-sub">{task.sceneName}</small>}
                    </td>
                    <td className="nowrap-cell">
                      {task.taskId === null ? (
                        <span className="task-type-badge task-type-badge-neutral">未关联</span>
                      ) : (
                        <TaskTypeBadge type={task.taskType} />
                      )}
                    </td>
                    <td>{task.uploads}</td>
                    <td className="nowrap-cell">
                      {task.reviewed === 0
                        ? "—"
                        : formatRate((task.passed / task.reviewed) * 100)}
                    </td>
                    <td className="nowrap-cell">{formatDuration(task.effectiveSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty-state compact-empty"><strong>暂无任务数据</strong><span>成员按任务提交视频后将在这里按任务维度汇总</span></div>}
      </section>
    </div>
  );
}
