"use client";

import { useEffect, useMemo, useState } from "react";
import { CircleDollarSign, Clock3, FileCheck2, Timer } from "lucide-react";

import { MetricCard } from "../../components/MetricCard";
import { useIdentity } from "../../auth/client/IdentityContext";
import {
  effectiveDuration,
  qualityCoefficient,
  type QualityCoefficientBand,
} from "../../domain/calculations";
import type { Submission } from "../../domain/types";
import {
  getPointRule,
  listPointCycles,
} from "../../points/client/pointCycleApi";
import type {
  BackendPointCycle,
  BackendPointCycleItem,
} from "../../points/contracts";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";
import {
  contributionMetrics,
  formatDuration,
  formatRate,
} from "./teamMetrics";

type PageMode = "loading" | "live" | "unavailable";

type MemberPointSummary = {
  id: string;
  name: string;
  username: string;
  reviewed: number;
  effectiveSeconds: number;
  points: number;
  averageScore: number | null;
  passRate: number | null;
};

type TeamPointSummary = {
  lockedPoints: number;
  pendingPoints: number;
  reviewedCount: number;
  uploadCount: number;
  pendingQualityCount: number;
  effectiveSeconds: number;
  pointsPerMinute: number;
  members: MemberPointSummary[];
};

function formatPoints(points: number): string {
  return `${points.toFixed(2)} 分`;
}

function pointsForSubmission(
  submission: Submission,
  pointsPerMinute: number,
  coefficientBands?: readonly QualityCoefficientBand[],
): number {
  const ratio = qualityCoefficient(submission.finalScore, coefficientBands);
  return (
    Math.round(
      pointsPerMinute *
        (effectiveDuration(
          submission.durationSeconds,
          submission.invalidSeconds,
        ) /
          60) *
        ratio *
        100,
    ) / 100
  );
}

function lockedItems(cycles: BackendPointCycle[]): BackendPointCycleItem[] {
  return cycles.flatMap((cycle) => cycle.items);
}

function memberSummaryFromSubmissions(
  member: { id: string; displayName: string; username: string },
  visibleSubmissions: Submission[],
  eligibleSubmissions: Submission[],
  locked: BackendPointCycleItem[],
  pointsPerMinute: number,
  coefficientBands?: readonly QualityCoefficientBand[],
): MemberPointSummary {
  const ownVisible = visibleSubmissions.filter(
    (submission) => submission.ownerId === member.id,
  );
  const ownEligible = eligibleSubmissions.filter(
    (submission) => submission.ownerId === member.id,
  );
  const ownLocked = locked.filter((item) => item.ownerId === member.id);
  const metrics = contributionMetrics(ownVisible);
  const scores = ownVisible
    .filter((submission) => submission.qualityStatus !== "pending")
    .map((submission) => submission.finalScore);
  return {
    id: member.id,
    name: member.displayName,
    username: member.username,
    reviewed: metrics.reviewed,
    effectiveSeconds:
      contributionMetrics(ownEligible).effectiveSeconds +
      Math.round(
        ownLocked.reduce(
          (total, item) => total + item.effectiveDurationMs,
          0,
        ) / 1_000,
      ),
    points:
      ownEligible.reduce(
        (total, submission) =>
          total +
          pointsForSubmission(
            submission,
            pointsPerMinute,
            coefficientBands,
          ),
        0,
      ) +
      ownLocked.reduce((total, item) => total + item.points, 0),
    averageScore:
      scores.length === 0
        ? null
        : scores.reduce((total, score) => total + score, 0) / scores.length,
    passRate: metrics.passRate,
  };
}

function backendSummary(
  members: Array<{ id: string; displayName: string; username: string }>,
  cycles: BackendPointCycle[],
  pendingSubmissions: Submission[],
  visibleSubmissions: Submission[],
  pointsPerMinute: number,
  coefficientBands: readonly QualityCoefficientBand[],
): TeamPointSummary {
  const items = lockedItems(cycles);
  const billablePending = pendingSubmissions.filter(
    (submission) =>
      submission.settlementStatus === "unsettled" &&
      submission.qualityStatus === "passed" &&
      qualityCoefficient(submission.finalScore, coefficientBands) > 0,
  );
  const pendingPoints = billablePending.reduce(
    (total, submission) =>
      total +
      pointsForSubmission(submission, pointsPerMinute, coefficientBands),
    0,
  );
  const visibleMetrics = contributionMetrics(visibleSubmissions);
  return {
    lockedPoints: cycles.reduce((total, cycle) => total + cycle.totalPoints, 0),
    pendingPoints,
    reviewedCount: visibleMetrics.reviewed,
    uploadCount: visibleMetrics.uploads,
    pendingQualityCount: Math.max(
      0,
      visibleMetrics.uploads - visibleMetrics.reviewed,
    ),
    effectiveSeconds:
      Math.round(
        items.reduce((total, item) => total + item.effectiveDurationMs, 0) /
          1_000,
      ) +
      billablePending.reduce(
        (total, submission) =>
          total +
          effectiveDuration(
            submission.durationSeconds,
            submission.invalidSeconds,
          ),
        0,
      ),
    pointsPerMinute,
    members: members.map((member) =>
      memberSummaryFromSubmissions(
        member,
        visibleSubmissions,
        billablePending,
        items,
        pointsPerMinute,
        coefficientBands,
      ),
    ),
  };
}

const emptySummary: TeamPointSummary = {
  lockedPoints: 0,
  pendingPoints: 0,
  reviewedCount: 0,
  uploadCount: 0,
  pendingQualityCount: 0,
  effectiveSeconds: 0,
  pointsPerMinute: 0,
  members: [],
};

export function TeamIncomePage() {
  const { accounts, teams, currentAccount } = useIdentity();
  const currentTeam = teams.find((team) => team.id === currentAccount.teamId);
  const pointsPerMinute = currentTeam?.unitPricePerMinute ?? 0;
  const members = useMemo(
    () =>
      accounts.filter(
        (account) =>
          account.teamId === currentTeam?.id && account.role === "collector",
      ),
    [accounts, currentTeam?.id],
  );
  const [summary, setSummary] = useState<TeamPointSummary>(emptySummary);
  const [mode, setMode] = useState<PageMode>("loading");

  useEffect(() => {
    let active = true;
    Promise.all([
      listPointCycles(),
      loadAllSubmissions({ status: "unsettled" }),
      loadAllSubmissions({ status: "all" }),
      getPointRule(),
    ])
      .then(([cycles, pending, all, pointRule]) => {
        if (!active) return;
        const effectivePointsPerMinute =
          pointsPerMinute > 0
            ? pointsPerMinute
            : pointRule.defaultPointsPerMinute;
        setSummary(
          backendSummary(
            members,
            cycles,
            pending.map(backendSubmissionToDomain),
            all.map(backendSubmissionToDomain),
            effectivePointsPerMinute,
            pointRule.coefficientBands,
          ),
        );
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setSummary(emptySummary);
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [members, pointsPerMinute]);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">只读金额视图</p>
          <h1>团队金额汇总</h1>
          <span>
            按当前规则 {summary.pointsPerMinute.toFixed(2)}
            元/小时、有效时长和最终评分测算，用于线下核对
          </span>
        </div>
        <span className="live-pill">
          <i />
          {mode === "live"
            ? "已连接后端金额"
            : mode === "loading"
              ? "正在读取金额"
              : "数据暂不可用"}
        </span>
      </div>
      <div className="metric-grid">
        <MetricCard
          label="当前金额"
          value={formatPoints(summary.lockedPoints + summary.pendingPoints)}
          detail={`${summary.reviewedCount} 条已有终态质检`}
          icon={CircleDollarSign}
        />
        <MetricCard
          label="待质检视频"
          value={`${summary.pendingQualityCount} 条`}
          detail="质检完成后自动纳入预估"
          icon={Clock3}
          tone="amber"
        />
        <MetricCard
          label="质检完成视频"
          value={`${summary.reviewedCount} 条`}
          detail={`共上传 ${summary.uploadCount} 条`}
          icon={FileCheck2}
          tone="green"
        />
        <MetricCard
          label="计价有效时长"
          value={formatDuration(summary.effectiveSeconds)}
          detail="仅统计质检通过数据"
          icon={Timer}
          tone="violet"
        />
      </div>
      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h2>成员金额汇总</h2>
            <p>根据真实提交、终态质检和锁定周期计算</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>质检完成</th>
                <th>有效时长</th>
                <th>累计金额</th>
                <th>平均分</th>
                <th>通过率</th>
              </tr>
            </thead>
            <tbody>
              {summary.members.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className="member-cell">
                      <span>{member.name.slice(0, 1)}</span>
                      <div>
                        <strong>{member.name}</strong>
                        <small>{member.username}</small>
                      </div>
                    </div>
                  </td>
                  <td>{member.reviewed} 条</td>
                  <td>{formatDuration(member.effectiveSeconds)}</td>
                  <td>
                    <strong>{formatPoints(member.points)}</strong>
                  </td>
                  <td>
                    {member.averageScore === null
                      ? "—"
                      : member.averageScore.toFixed(1)}
                  </td>
                  <td>{formatRate(member.passRate)}</td>
                </tr>
              ))}
              {summary.members.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state compact-empty">
                      <strong>暂无数采成员</strong>
                      <span>请先在成员管理中创建数采账号</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
