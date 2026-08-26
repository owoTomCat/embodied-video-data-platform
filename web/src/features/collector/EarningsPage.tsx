"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, CircleDollarSign, Clock3, FileCheck2 } from "lucide-react";

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
import type { BackendPointCycle } from "../../points/contracts";
import {
  loadAllSubmissions,
  searchSubmissions,
} from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

type PageMode = "loading" | "live" | "unavailable";

type PointRow = {
  id: string;
  fileName: string;
  finalScore: number;
  effectiveSeconds: number;
  points: number;
  status: "locked" | "pending";
};

type EarningsSummary = {
  lockedPoints: number;
  pendingPoints: number;
  effectiveSeconds: number;
  reviewedCount: number;
  pendingQualityCount: number;
  rows: PointRow[];
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

function summaryFromBackend(
  cycles: BackendPointCycle[],
  pendingSubmissions: Submission[],
  reviewedTotal: number,
  allTotal: number,
  pointsPerMinute: number,
  coefficientBands: readonly QualityCoefficientBand[],
): EarningsSummary {
  const lockedRows = cycles.flatMap((cycle) =>
    cycle.items.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      finalScore: item.finalScore,
      effectiveSeconds: Math.round(item.effectiveDurationMs / 1_000),
      points: item.points,
      status: "locked" as const,
    })),
  );
  const pendingRows = pendingSubmissions
    .filter(
      (item) =>
        item.settlementStatus === "unsettled" &&
        item.qualityStatus === "passed" &&
        qualityCoefficient(item.finalScore, coefficientBands) > 0,
    )
    .map((item) => ({
      id: item.id,
      fileName: item.fileName,
      finalScore: item.finalScore,
      effectiveSeconds: effectiveDuration(
        item.durationSeconds,
        item.invalidSeconds,
      ),
      points: pointsForSubmission(item, pointsPerMinute, coefficientBands),
      status: "pending" as const,
    }));
  const lockedPoints = cycles.reduce(
    (total, cycle) => total + cycle.totalPoints,
    0,
  );
  const pendingPoints = pendingRows.reduce(
    (total, item) => total + item.points,
    0,
  );
  return {
    lockedPoints,
    pendingPoints,
    effectiveSeconds:
      lockedRows.reduce((total, item) => total + item.effectiveSeconds, 0) +
      pendingRows.reduce((total, item) => total + item.effectiveSeconds, 0),
    reviewedCount: reviewedTotal,
    pendingQualityCount: Math.max(0, allTotal - reviewedTotal),
    rows: [...pendingRows, ...lockedRows].slice(0, 8),
  };
}

const emptySummary: EarningsSummary = {
  lockedPoints: 0,
  pendingPoints: 0,
  effectiveSeconds: 0,
  reviewedCount: 0,
  pendingQualityCount: 0,
  rows: [],
};

export function EarningsPage() {
  const { currentAccount, teams } = useIdentity();
  const currentTeam = teams.find((team) => team.id === currentAccount.teamId);
  const pointsPerMinute = currentTeam?.unitPricePerMinute ?? 12;
  const [summary, setSummary] = useState<EarningsSummary>(emptySummary);
  const [mode, setMode] = useState<PageMode>("loading");

  useEffect(() => {
    let active = true;
    Promise.all([
      listPointCycles(),
      loadAllSubmissions({ status: "unsettled" }),
      searchSubmissions({ status: "reviewed", page: 1, pageSize: 1 }),
      searchSubmissions({ status: "all", page: 1, pageSize: 1 }),
      getPointRule(),
    ])
      .then(([cycles, pending, reviewed, all, pointRule]) => {
        if (!active) return;
        const effectivePointsPerMinute =
          pointsPerMinute > 0
            ? pointsPerMinute
            : pointRule.defaultPointsPerMinute;
        setSummary(
          summaryFromBackend(
            cycles,
            pending.map(backendSubmissionToDomain),
            reviewed.pagination.total,
            all.pagination.total,
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
  }, [pointsPerMinute]);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">个人积分账户</p>
          <h1>积分明细</h1>
          <span>平台只记录积分，线下结算由团长按周期核对处理</span>
        </div>
        <span className="live-pill">
          <i />
          {mode === "live"
            ? "已连接后端积分"
            : mode === "loading"
              ? "正在读取积分"
              : "数据暂不可用"}
        </span>
      </div>
      <div className="metric-grid">
        <MetricCard
          label="累计积分"
          value={formatPoints(summary.lockedPoints + summary.pendingPoints)}
          detail={`${summary.reviewedCount} 条已有终态质检`}
          icon={CircleDollarSign}
        />
        <MetricCard
          label="待锁定积分"
          value={formatPoints(summary.pendingPoints)}
          detail="进入下个积分周期"
          icon={Clock3}
          tone="amber"
        />
        <MetricCard
          label="有效时长"
          value={`${Math.round((summary.effectiveSeconds / 60) * 100) / 100} 分钟`}
          detail="仅统计通过数据"
          icon={BadgeCheck}
          tone="green"
        />
        <MetricCard
          label="待质检视频"
          value={`${summary.pendingQualityCount} 条`}
          detail="出结果后自动计算积分"
          icon={FileCheck2}
          tone="violet"
        />
      </div>
      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h2>视频积分明细</h2>
            <p>按有效时长、最终评分和积分系数测算</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>视频</th>
                <th>最终分</th>
                <th>有效时长</th>
                <th>积分</th>
                <th>周期状态</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.fileName}</strong>
                  </td>
                  <td>{item.finalScore}/100</td>
                  <td>{Math.round((item.effectiveSeconds / 60) * 100) / 100} 分钟</td>
                  <td>
                    <strong>{formatPoints(item.points)}</strong>
                  </td>
                  <td>{item.status === "locked" ? "已锁定" : "待锁定"}</td>
                </tr>
              ))}
              {summary.rows.length === 0 && (
                <tr>
                  <td colSpan={5}>暂无积分明细</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
