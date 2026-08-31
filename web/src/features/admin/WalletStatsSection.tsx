"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  getWalletFlowStats,
  getWalletTeamStats,
} from "../../wallet/client/walletApi";
import type { WalletFlowPoint, WalletTeamStat } from "../../wallet/contracts";

const PIE_COLORS = [
  "#4774df",
  "#7aa2f7",
  "#16a085",
  "#f0b429",
  "#b94b47",
  "#8e6fd8",
  "#3d9b8f",
  "#e07856",
];

const BUCKET_LABELS = { day: "按日", week: "按周", month: "按月" } as const;

function formatMoney(amount: number): string {
  return `${Math.round(amount * 100) / 100} 元`;
}

export function WalletStatsSection() {
  const [bucket, setBucket] = useState<"day" | "week" | "month">("day");
  const [flow, setFlow] = useState<WalletFlowPoint[]>([]);
  const [teams, setTeams] = useState<WalletTeamStat[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    Promise.all([getWalletFlowStats(bucket), getWalletTeamStats()])
      .then(([nextFlow, nextTeams]) => {
        if (!active) return;
        setFlow(nextFlow);
        setTeams(nextTeams);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setFlow([]);
        setTeams([]);
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [bucket]);

  const teamPie = teams
    .filter((team) => Math.abs(team.settle) > 0 || Math.abs(team.withdraw) > 0)
    .map((team) => ({
      name: team.teamName,
      settle: Math.round(team.settle * 100) / 100,
      withdraw: Math.round(team.withdraw * 100) / 100,
      lock: Math.round(team.lock * 100) / 100,
    }));
  const teamTotal = teamPie.reduce((sum, item) => sum + item.settle, 0);

  return (
    <section className="content-card">
      <div className="card-heading">
        <div><h2>流水统计</h2><p>全平台钱包流水监控：折线图为锁定/结算/提现金额趋势，饼图为各团队已结算金额分布</p></div>
        <div className="scene-library-tabs">
          {(Object.keys(BUCKET_LABELS) as Array<keyof typeof BUCKET_LABELS>).map((key) => (
            <button
              key={key}
              type="button"
              className={`scene-library-tab${bucket === key ? " active" : ""}`}
              onClick={() => setBucket(key)}
            >
              {BUCKET_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {mode === "unavailable" && (
        <p className="form-message">流水统计暂不可用，请稍后重试。</p>
      )}

      <div className="wallet-stats-grid">
        <div className="wallet-stats-panel">
          <h3>流水趋势（{BUCKET_LABELS[bucket]}）</h3>
          {flow.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={flow} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6ebf2" />
                <XAxis dataKey="bucket" tick={{ fontSize: 10 }} tickFormatter={(value: string) => value.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} width={52} />
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [
                    formatMoney(Number(value ?? 0)),
                    String(name) === "lock"
                      ? "锁定入结算中"
                      : String(name) === "settle"
                        ? "结算转可提现"
                        : "提现（流出）",
                  ]}
                  labelFormatter={(label: unknown) => `周期起点：${String(label ?? "")}`}
                />
                <Legend formatter={(value: string) =>
                  value === "lock" ? "锁定入结算中" : value === "settle" ? "结算转可提现" : "提现"
                } />
                <Line type="monotone" dataKey="lock" stroke="#8e6fd8" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="settle" stroke="#4774df" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="withdraw" stroke="#b94b47" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="form-message">当前时间范围内暂无流水数据</p>
          )}
        </div>

        <div className="wallet-stats-panel">
          <h3>团队分布（已结算金额）</h3>
          {teamPie.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={teamPie}
                    dataKey="settle"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={78}
                    paddingAngle={2}
                    label={(entry) => entry.name}
                  >
                    {teamPie.map((entry, index) => (
                      <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: unknown, _name: unknown, entry) => {
                      const item = (entry as { payload?: WalletTeamStat }).payload;
                      return [
                        `${formatMoney(Number(value ?? 0))}（结算 ${formatMoney(item?.settle ?? 0)} / 锁定 ${formatMoney(item?.lock ?? 0)} / 提现 ${formatMoney(item?.withdraw ?? 0)}）`,
                        "已结算金额",
                      ];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="wallet-team-legend">
                {teamPie.map((team, index) => (
                  <span key={team.name}>
                    <i style={{ background: PIE_COLORS[index % PIE_COLORS.length] }} />
                    {team.name}
                    <em>
                      {teamTotal > 0 ? `${Math.round((team.settle / teamTotal) * 100)}%` : "—"} ·{" "}
                      {formatMoney(team.settle)}
                    </em>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="form-message">暂无团队流水数据</p>
          )}
        </div>
      </div>
    </section>
  );
}
