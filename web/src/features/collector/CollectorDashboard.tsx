"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Clock3, FileVideo, Wallet } from "lucide-react";

import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import { useIdentity } from "../../auth/client/IdentityContext";
import {
  effectiveDuration,
  estimatePoints,
  isActivePassedSubmission,
  qualityCoefficient,
} from "../../domain/calculations";
import type { Submission } from "../../domain/types";
import { getPointRule } from "../../points/client/pointCycleApi";
import type { BackendPointRule } from "../../points/contracts";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";
import { submissionStatus } from "../../submissions/submissionStatus";
import {
  formatDuration,
  formatRate,
  submissionTimestamp,
  submissionsSince,
} from "../team/teamMetrics";

type PageMode = "loading" | "live" | "unavailable";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "夜深了";
  if (hour < 12) return "早上好";
  if (hour < 18) return "下午好";
  return "晚上好";
}


export function CollectorDashboard({
  navigate,
}: {
  navigate(path: string): void;
}) {
  const { currentAccount, teams } = useIdentity();
  const currentTeam = teams.find((team) => team.id === currentAccount.teamId);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [pointRule, setPointRule] = useState<BackendPointRule | null>(null);
  const [pointRuleState, setPointRuleState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [mode, setMode] = useState<PageMode>("loading");

  useEffect(() => {
    let active = true;
    loadAllSubmissions({ status: "all" })
      .then((result) => {
        if (!active) return;
        setSubmissions(result.map(backendSubmissionToDomain));
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setSubmissions([]);
        setMode("unavailable");
      });
    getPointRule()
      .then((rule) => {
        if (!active) return;
        setPointRule(rule);
        setPointRuleState("ready");
      })
      .catch(() => {
        if (!active) return;
        setPointRule(null);
        setPointRuleState("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  const pointsPerMinute = currentTeam?.unitPricePerMinute ?? 12;
  const month = useMemo(
    () => submissionsSince(submissions, 30),
    [submissions],
  );
  const today = useMemo(() => submissionsSince(submissions, 1), [submissions]);
  const reviewed = month.filter((item) => item.qualityStatus !== "pending");
  const passed = reviewed.filter((item) => item.qualityStatus === "passed");
  const passRate =
    reviewed.length === 0
      ? null
      : (passed.length / reviewed.length) * 100;
  const effectiveSeconds = passed.reduce(
    (total, item) =>
      total + effectiveDuration(item.durationSeconds, item.invalidSeconds),
    0,
  );
  const pendingPoints =
    mode === "live" && pointRuleState === "ready" && pointRule
      ? passed
          .filter(
            (item) =>
              item.settlementStatus === "unsettled" &&
              isActivePassedSubmission(item) &&
              qualityCoefficient(item.finalScore, pointRule.coefficientBands) > 0,
          )
          .reduce(
            (total, item) =>
              total +
              estimatePoints(
                pointsPerMinute,
                item.durationSeconds,
                item.invalidSeconds,
                item.finalScore,
                pointRule.coefficientBands,
              ),
            0,
          )
      : null;
  const pointsLabel =
    mode !== "live"
      ? "—"
      : pointRuleState === "loading"
        ? "规则读取中"
        : pendingPoints === null
          ? "规则不可用"
          : `${pendingPoints.toFixed(2)} 分`;
  const unavailableDetail =
    mode === "loading" ? "数据读取中" : "数据暂不可用";
  const recent = useMemo(
    () =>
      [...submissions]
        .sort((left, right) => {
          const leftTime = submissionTimestamp(left) ?? 0;
          const rightTime = submissionTimestamp(right) ?? 0;
          return rightTime - leftTime;
        })
        .slice(0, 5),
    [submissions],
  );

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">今天也是好数据的一天</p>
          <h1 suppressHydrationWarning>{greeting()}，{currentAccount.displayName}</h1>
          <span>
            {mode === "live"
              ? `本月已上传 ${month.length} 条 · 今日 ${today.length} 条`
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
            onClick={() => navigate("/collector/upload")}
          >
            上传新视频
          </button>
        </div>
      </div>
      <div className="metric-grid">
        <MetricCard
          label="本月上传"
          value={mode === "live" ? `${month.length} 条` : "—"}
          detail={
            mode === "live"
              ? `近 30 日 · 今日 ${today.length} 条`
              : unavailableDetail
          }
          icon={FileVideo}
        />
        <MetricCard
          label="有效时长"
          value={mode === "live" ? formatDuration(effectiveSeconds) : "—"}
          detail={mode === "live" ? "已通过数据的有效时长" : unavailableDetail}
          icon={Clock3}
          tone="violet"
        />
        <MetricCard
          label="质量通过率"
          value={mode === "live" ? formatRate(passRate) : "—"}
          detail={
            mode === "live"
              ? `${reviewed.length} 条已有终态质检`
              : unavailableDetail
          }
          icon={BadgeCheck}
          tone="green"
        />
        <MetricCard
          label="待锁定金额"
          value={pointsLabel}
          detail={
            mode === "live"
              ? "通过且未进入结算周期"
              : unavailableDetail
          }
          icon={Wallet}
          tone="amber"
        />
      </div>
      <div className="dashboard-grid">
        <section className="content-card content-card-wide">
          <div className="card-heading">
            <div>
              <h2>最近数据</h2>
              <p>跟踪你的视频处理和质检进度</p>
            </div>
            <button
              onClick={() => navigate("/collector/submissions")}
              className="text-button"
            >
              查看全部
            </button>
          </div>
          {recent.length > 0 ? (
            <div className="record-list">
              {recent.map((item) => {
                const status = submissionStatus(item);
                return (
                  <div key={item.id}>
                    <span>
                      <strong>{item.fileName}</strong>
                      <small>
                        {item.id} · {item.createdAt}
                      </small>
                    </span>
                    <span className="row-actions">
                      <StatusBadge label={status.label} tone={status.tone} />
                      <button
                        className="text-button"
                        onClick={() =>
                          navigate(`/collector/submissions/${item.id}`)
                        }
                      >
                        查看
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-inline">
              {mode === "loading"
                ? "正在读取数据"
                : mode === "unavailable"
                  ? "数据暂不可用"
                  : "暂无数据，去上传第一条视频吧"}
            </div>
          )}
        </section>
        <aside className="content-card">
          <div className="card-heading">
            <div>
              <h2>采集质量提醒</h2>
              <p>提交前确认关键画面完整</p>
            </div>
          </div>
          <div className="recommend-list">
            <div><em>01</em><span><strong>完整任务链</strong><small>从准备到收尾不要中断</small></span></div>
            <div><em>02</em><span><strong>双手清晰可见</strong><small>避免操作对象被遮挡</small></span></div>
            <div><em>03</em><span><strong>过程连续稳定</strong><small>减少晃动和无效停顿</small></span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
