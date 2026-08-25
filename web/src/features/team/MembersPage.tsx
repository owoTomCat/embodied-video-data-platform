"use client";

import { Search, UserPlus, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import * as accountApi from "../../auth/client/accountApi";
import { useIdentity } from "../../auth/client/IdentityContext";
import type {
  AccountPublic,
  CreateAccountInput,
  UpdateAccountInput,
} from "../../auth/contracts";
import { StatusBadge } from "../../components/StatusBadge";
import type { Submission, User } from "../../domain/types";
import { useInteractions } from "../../interactions/InteractionContext";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";
import { AccountStatusModal } from "../admin/AccountStatusModal";
import { ResetPasswordModal } from "../admin/ResetPasswordModal";
import { CollectorAccountFormModal } from "./CollectorAccountFormModal";
import {
  MemberDetailModal,
  type MemberMetrics,
} from "./MemberDetailModal";
import {
  contributionMetrics,
  formatDuration,
  formatRate,
  submissionsSince,
} from "./teamMetrics";

type MetricsPeriod = "today" | "7d" | "30d" | "all";
type PageMode = "loading" | "live" | "unavailable";

const periodDays: Record<Exclude<MetricsPeriod, "all">, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
};

const periodLabel: Record<MetricsPeriod, string> = {
  today: "今日",
  "7d": "近 7 日",
  "30d": "近 30 日",
  all: "累计",
};

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function accountToMember(account: AccountPublic): User {
  return {
    id: account.id,
    name: account.displayName,
    account: account.username,
    role: account.role,
    teamId: account.teamId,
    avatar: account.displayName.slice(0, 1),
    phone: "未设置",
    status: account.status,
    updatedAt: account.updatedAt,
  };
}

export function MembersPage() {
  const { accounts, currentAccount, teams, upsertAccount } = useIdentity();
  const { notify } = useInteractions();
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState<MetricsPeriod>("30d");
  const [selectedMember, setSelectedMember] = useState<User>();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AccountPublic>();
  const [resetTarget, setResetTarget] = useState<AccountPublic>();
  const [statusTarget, setStatusTarget] = useState<AccountPublic>();
  const [metricsMode, setMetricsMode] = useState<PageMode>("loading");
  const detailTriggerRef = useRef<HTMLButtonElement>(null);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement>(null);
  const currentTeam = teams.find((team) => team.id === currentAccount.teamId);
  const teamMembers = accounts
    .filter((account) => account.teamId === currentTeam?.id)
    .sort((left, right) =>
      Number(right.role === "leader") - Number(left.role === "leader"),
    )
    .map(accountToMember);
  const members = teamMembers.filter((user) =>
    `${user.name}${user.account}`.toLowerCase().includes(query.toLowerCase()),
  );
  const [teamSubmissions, setTeamSubmissions] = useState<Submission[]>([]);

  useEffect(() => {
    let active = true;
    loadAllSubmissions({ status: "all" })
      .then((result) => {
        if (!active) return;
        setTeamSubmissions(result.map(backendSubmissionToDomain));
        setMetricsMode("live");
      })
      .catch(() => {
        if (!active) return;
        setTeamSubmissions([]);
        setMetricsMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  const scopedSubmissions =
    period === "all"
      ? teamSubmissions
      : submissionsSince(teamSubmissions, periodDays[period]);

  function metricsFor(memberId: string): MemberMetrics {
    const metrics = contributionMetrics(
      scopedSubmissions.filter(
        (submission) => submission.ownerId === memberId,
      ),
    );
    return {
      uploads: metrics.uploads,
      duration: formatDuration(metrics.effectiveSeconds),
      passRate: formatRate(metrics.passRate),
      averageScore:
        metrics.averageScore === null
          ? "—"
          : metrics.averageScore.toFixed(1),
    };
  }

  function exportMetrics() {
    const rows = teamMembers.map((member) => {
      const metrics = contributionMetrics(
        scopedSubmissions.filter(
          (submission) => submission.ownerId === member.id,
        ),
      );
      return [
        member.name,
        member.account,
        member.role === "leader" ? "团长" : "数采人员",
        member.status === "active" ? "已启用" : "已停用",
        metrics.uploads,
        metrics.reviewed,
        metrics.passed,
        metrics.failed,
        Math.round((metrics.effectiveSeconds / 60) * 100) / 100,
        metrics.averageScore?.toFixed(1) ?? "",
        metrics.passRate?.toFixed(1) ?? "",
      ];
    });
    const csv = [
      [
        "成员",
        "用户名",
        "角色",
        "状态",
        "上传数",
        "已质检数",
        "通过数",
        "未通过数",
        "有效分钟",
        "平均分",
        "通过率(%)",
      ],
      ...rows,
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${currentTeam?.name ?? "团队"}-${periodLabel[period]}成员统计.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    notify("success", "成员统计已导出");
  }

  async function create(input: CreateAccountInput) {
    const account = await accountApi.createAccount(input);
    upsertAccount(account);
    notify("success", "数采账号已创建");
    return account;
  }

  async function update(id: string, input: UpdateAccountInput) {
    const account = await accountApi.updateAccount(id, input);
    upsertAccount(account);
    notify("success", "数采名称已更新");
    return account;
  }

  function rememberAction(button: HTMLButtonElement) {
    actionTriggerRef.current = button;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">{currentTeam?.name}</p>
          <h1>成员管理</h1>
          <span>查看成员表现并管理本团队数采账号</span>
        </div>
        <div className="button-row">
          <span className="live-pill">
            <i />
            {metricsMode === "live"
              ? "已连接后端指标"
              : metricsMode === "loading"
                ? "正在读取指标"
                : "数据暂不可用"}
          </span>
          <button
            ref={createTriggerRef}
            className="button button-primary"
            disabled={!currentTeam}
            onClick={() => setCreateOpen(true)}
          >
            <UserPlus size={16} />
            新增数采账号
          </button>
        </div>
      </div>
      <section className="content-card table-card">
        <div className="filter-bar">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="搜索成员"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索姓名或账号"
            />
          </label>
          <select
            aria-label="统计周期"
            value={period}
            onChange={(event) => setPeriod(event.target.value as MetricsPeriod)}
          >
            <option value="today">今日</option>
            <option value="7d">近 7 日</option>
            <option value="30d">近 30 日</option>
            <option value="all">累计</option>
          </select>
          <button className="table-action" type="button" onClick={exportMetrics}>
            导出统计
          </button>
          <span className="filter-count">
            <Users size={15} />
            {members.length} 位成员
          </span>
        </div>
        <p id="member-metrics-note" className="table-summary" role="note">
          {periodLabel[period]}上传、有效时长和通过率均根据真实提交与 AI 终态结果计算
        </p>
        <div className="table-scroll">
          <table
            className="data-table"
            aria-describedby="member-metrics-note"
          >
            <thead>
              <tr>
                <th>成员</th>
                <th>角色</th>
                <th>{periodLabel[period]}上传</th>
                <th>有效时长</th>
                <th>平均分</th>
                <th>通过率</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const metrics = metricsFor(member.id);
                const account: AccountPublic = {
                  id: member.id,
                  displayName: member.name,
                  username: member.account,
                  role: member.role,
                  teamId: member.teamId,
                  status: member.status,
                  updatedAt: member.updatedAt,
                };
                return (
                  <tr key={member.id}>
                    <td>
                      <div className="member-cell">
                        <span>{member.avatar}</span>
                        <div>
                          <strong>{member.name}</strong>
                          <small>
                            {member.account} · {member.phone}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>
                      {member.role === "leader" ? "团长" : "数采人员"}
                    </td>
                    <td>{metrics.uploads} 条</td>
                    <td>{metrics.duration}</td>
                    <td><strong>{metrics.averageScore}</strong></td>
                    <td>
                      <strong>{metrics.passRate}</strong>
                    </td>
                    <td>
                      <StatusBadge
                        label={
                          member.status === "active" ? "已启用" : "已停用"
                        }
                        tone={
                          member.status === "active" ? "success" : "neutral"
                        }
                      />
                    </td>
                    <td>
                      <div className="account-row-actions">
                        <button
                          className="table-action"
                          onClick={(event) => {
                            detailTriggerRef.current = event.currentTarget;
                            setSelectedMember(member);
                          }}
                        >
                          查看
                        </button>
                        {member.role === "collector" && (
                          <>
                            <button
                              className="table-action"
                              onClick={(event) => {
                                rememberAction(event.currentTarget);
                                setEditTarget(account);
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="table-action"
                              onClick={(event) => {
                                rememberAction(event.currentTarget);
                                setResetTarget(account);
                              }}
                            >
                              重置密码
                            </button>
                            <button
                              className="table-action"
                              onClick={(event) => {
                                rememberAction(event.currentTarget);
                                setStatusTarget(account);
                              }}
                            >
                              {member.status === "active" ? "停用" : "启用"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {members.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <div className="empty-state compact-empty">
                      <strong>暂无可显示成员</strong>
                      <span>调整搜索条件，或点击“新增数采账号”添加成员</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <MemberDetailModal
        member={selectedMember}
        team={currentTeam}
        open={Boolean(selectedMember)}
        periodLabel={periodLabel[period]}
        metrics={selectedMember ? metricsFor(selectedMember.id) : {
          uploads: 0,
          duration: "0 分钟",
          passRate: "—",
          averageScore: "—",
        }}
        onClose={() => setSelectedMember(undefined)}
        returnFocusRef={detailTriggerRef}
      />
      {createOpen && currentTeam && (
        <CollectorAccountFormModal
          mode="create"
          team={currentTeam}
          onCreate={create}
          onUpdate={update}
          onClose={() => setCreateOpen(false)}
          returnFocusRef={createTriggerRef}
        />
      )}
      {editTarget && currentTeam && (
        <CollectorAccountFormModal
          mode="edit"
          account={editTarget}
          team={currentTeam}
          onCreate={create}
          onUpdate={update}
          onClose={() => setEditTarget(undefined)}
          returnFocusRef={actionTriggerRef}
        />
      )}
      {resetTarget && (
        <ResetPasswordModal
          account={resetTarget}
          onClose={() => setResetTarget(undefined)}
          returnFocusRef={actionTriggerRef}
          onReset={async (password) => {
            await accountApi.resetAccountPassword(resetTarget.id, password);
            notify("success", "账号密码已重置");
          }}
        />
      )}
      {statusTarget && (
        <AccountStatusModal
          account={statusTarget}
          onClose={() => setStatusTarget(undefined)}
          returnFocusRef={actionTriggerRef}
          onConfirm={async () => {
            const nextStatus =
              statusTarget.status === "active" ? "disabled" : "active";
            const account = await accountApi.setAccountStatus(
              statusTarget.id,
              nextStatus,
            );
            upsertAccount(account);
            notify(
              "success",
              nextStatus === "active" ? "账号已启用" : "账号已停用",
            );
          }}
        />
      )}
    </div>
  );
}
