"use client";

import {
  Building2,
  ChevronDown,
  ChevronRight,
  Crown,
  Download,
  Search,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { AccountPublic, TeamPublic } from "../../auth/contracts";
import { StatusBadge } from "../../components/StatusBadge";
import type { AccountStatus, Role } from "../../domain/types";
import { useMemberSettlementStats } from "./useMemberSettlementStats";

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`;
}

function formatPoints(points: number): string {
  return `${points.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} 分`;
}

function MemberStatsCell({ value }: { value: number }) {
  return <span className="mono">{value}</span>;
}

function MemberTable({
  accounts,
  currentAccountId,
  stats,
  onEdit,
  onResetPassword,
  onToggleStatus,
  onDelete,
}: {
  accounts: AccountPublic[];
  currentAccountId: string;
  stats?: Record<string, { videoCount: number; effectiveSeconds: number; avgScore: number | null; points: number }>;
  onEdit(account: AccountPublic, button: HTMLButtonElement): void;
  onResetPassword(account: AccountPublic, button: HTMLButtonElement): void;
  onToggleStatus(account: AccountPublic, button: HTMLButtonElement): void;
  onDelete(account: AccountPublic, button: HTMLButtonElement): void;
}) {
  return (
    <div className="table-scroll people-table-wrap">
      <table className="data-table people-table">
        <thead>
          <tr>
            <th>成员</th>
            <th>用户名</th>
            <th>状态</th>
            <th>视频数</th>
            <th>有效时长</th>
            <th>均分</th>
            <th>结算积分</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const memberStats = stats?.[account.id];
            const isCurrent = account.id === currentAccountId;
            const canDelete = !isCurrent && account.status === "disabled";
            return (
              <tr key={account.id}>
                <td>
                  <div className="member-cell">
                    <span>{account.displayName.slice(0, 1)}</span>
                    <div>
                      <strong>{account.displayName}</strong>
                      <small>{account.phone || "未填写手机号"}</small>
                    </div>
                  </div>
                </td>
                <td><span className="mono">{account.username}</span></td>
                <td>
                  <StatusBadge
                    label={account.status === "active" ? "已启用" : "已停用"}
                    tone={account.status === "active" ? "success" : "neutral"}
                  />
                </td>
                <td><MemberStatsCell value={memberStats?.videoCount ?? 0} /></td>
                <td>{memberStats ? formatDuration(memberStats.effectiveSeconds) : "—"}</td>
                <td>{memberStats?.avgScore ?? "—"}</td>
                <td><strong className="settle-points">{memberStats ? memberStats.points.toFixed(2) : "0.00"}</strong></td>
                <td className="table-actions-cell">
                  <span className="row-actions people-actions">
                    <button className="table-action" onClick={(event) => onEdit(account, event.currentTarget)}>编辑</button>
                    <button className="table-action" onClick={(event) => onResetPassword(account, event.currentTarget)}>重置密码</button>
                    <button
                      className="table-action"
                      disabled={isCurrent && account.status === "active"}
                      title={isCurrent && account.status === "active" ? "不能停用当前登录账号" : undefined}
                      onClick={(event) => onToggleStatus(account, event.currentTarget)}
                    >
                      {account.status === "active" ? "停用" : "启用"}
                    </button>
                    <button
                      className="table-action table-action-danger"
                      disabled={!canDelete}
                      title={
                        isCurrent
                          ? "不能删除当前登录账号"
                          : account.status === "active"
                            ? "请先停用账号，再执行删除"
                            : "永久删除该账号"
                      }
                      onClick={(event) => onDelete(account, event.currentTarget)}
                    >
                      删除
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {accounts.length === 0 && (
        <div className="empty-state hierarchy-empty-state">
          <strong>当前层级没有匹配账号</strong>
          <span>请调整搜索词或筛选条件</span>
        </div>
      )}
    </div>
  );
}

export function OrganizationHierarchy({
  accounts,
  teams,
  currentAccountId,
  onEditTeam,
  onAssignLeader,
  onEditAccount,
  onResetPassword,
  onToggleStatus,
  onDeleteAccount,
}: {
  accounts: AccountPublic[];
  teams: TeamPublic[];
  currentAccountId: string;
  onEditTeam(team: TeamPublic, button: HTMLButtonElement): void;
  onAssignLeader(team: TeamPublic, button: HTMLButtonElement): void;
  onEditAccount(account: AccountPublic, button: HTMLButtonElement): void;
  onResetPassword(account: AccountPublic, button: HTMLButtonElement): void;
  onToggleStatus(account: AccountPublic, button: HTMLButtonElement): void;
  onDeleteAccount(account: AccountPublic, button: HTMLButtonElement): void;
}) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "all">("all");
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(["platform", ...teams.map((team) => team.id)]),
  );
  const { stats, loading, unavailable } = useMemberSettlementStats(teams);

  const view = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchesAccount = (account: AccountPublic, groupMatches: boolean) => {
      const matchesSearch =
        !query ||
        groupMatches ||
        account.displayName.toLowerCase().includes(query) ||
        account.username.toLowerCase().includes(query) ||
        (account.phone ?? "").toLowerCase().includes(query) ||
        account.id.toLowerCase().includes(query);
      return (
        matchesSearch &&
        (roleFilter === "all" || account.role === roleFilter) &&
        (statusFilter === "all" || account.status === statusFilter)
      );
    };

    const teamGroups = teams.flatMap((team) => {
      if (teamFilter !== "all" && team.id !== teamFilter) return [];
      const members = accounts.filter((account) => account.teamId === team.id);
      const leaders = members.filter((account) => account.role === "leader");
      const groupMatches =
        !!query &&
        (team.name.toLowerCase().includes(query) ||
          team.id.toLowerCase().includes(query) ||
          leaders.some(
            (leader) =>
              leader.displayName.toLowerCase().includes(query) ||
              (leader.phone ?? "").toLowerCase().includes(query),
          ));
      const visibleMembers = members.filter((account) =>
        matchesAccount(account, groupMatches),
      );
      if (query && !groupMatches && visibleMembers.length === 0) return [];
      if (!query && (roleFilter !== "all" || statusFilter !== "all") && visibleMembers.length === 0) return [];
      return [{ team, members, leaders, visibleMembers }];
    });

    const platformAccounts = accounts
      .filter((account) => account.role === "admin")
      .filter((account) => matchesAccount(account, query === "平台" || query === "管理员"));

    return {
      teamGroups,
      platformAccounts,
      visibleCount:
        platformAccounts.length +
        teamGroups.reduce((total, group) => total + group.visibleMembers.length, 0),
    };
  }, [accounts, roleFilter, search, statusFilter, teamFilter, teams]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const memberTableProps = {
    currentAccountId,
    stats: stats?.byOwner,
    onEdit: onEditAccount,
    onResetPassword,
    onToggleStatus,
    onDelete: onDeleteAccount,
  };

  const overall = stats?.overall;

  return (
    <section className="content-card organizations">
      <div className="people-overview">
        <div className="overview-stats">
          <span><strong>{accounts.length}</strong><small>账号</small></span>
          <span><strong>{teams.length}</strong><small>团队</small></span>
          <span><strong>{overall?.videoCount ?? "—"}</strong><small>视频</small></span>
          <span><strong>{overall ? formatDuration(overall.effectiveSeconds) : "—"}</strong><small>有效时长</small></span>
          <span><strong>{overall?.avgScore ?? "—"}</strong><small>均分</small></span>
          <span><strong>{overall?.points.toFixed(2) ?? "—"}</strong><small>结算积分</small></span>
        </div>
        <div className="overview-actions">
          <span className="overview-total">合计 {overall ? formatPoints(overall.points) : "—"}</span>
          <span className="overview-mode">{unavailable ? "结算数据暂不可用" : loading ? "统计读取中" : "已连接结算数据"}</span>
        </div>
      </div>

      <div className="people-filters">
        <label className="search-field">
          <Search size={15} />
          <span className="sr-only">搜索账号</span>
          <input
            aria-label="搜索账号"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索姓名、手机号、用户名或团队"
          />
        </label>
        <select aria-label="角色筛选" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as Role | "all")}>
          <option value="all">全部角色</option>
          <option value="admin">管理员</option>
          <option value="leader">团长</option>
          <option value="collector">数采人员</option>
        </select>
        <select aria-label="状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AccountStatus | "all")}>
          <option value="all">全部状态</option>
          <option value="active">已启用</option>
          <option value="disabled">已停用</option>
        </select>
        <select aria-label="团队筛选" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
          <option value="all">全部团队</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
        <span className="filter-count">当前显示 {view.visibleCount} 人</span>
      </div>

      <div className="people-groups">
        {view.platformAccounts.length > 0 && (
          <article className="people-group">
            <header className="people-group-header">
              <button
                className="organization-toggle"
                aria-label={`平台管理，${expanded.has("platform") ? "收起" : "展开"}账号`}
                aria-expanded={expanded.has("platform")}
                onClick={() => toggle("platform")}
              >
                {expanded.has("platform") ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span className="people-group-icon platform"><ShieldCheck size={18} /></span>
                <span className="people-group-title"><strong>平台管理</strong><small>不归属采集团队的管理员账号</small></span>
              </button>
              <div className="people-group-stats">
                <span>{view.platformAccounts.length} 人</span>
              </div>
            </header>
            {expanded.has("platform") && <MemberTable accounts={view.platformAccounts} {...memberTableProps} />}
          </article>
        )}

        {view.teamGroups.map(({ team, members, leaders, visibleMembers }) => {
          const isExpanded = expanded.has(team.id);
          const teamStats = stats?.byTeam[team.id];
          return (
            <article className="people-group" key={team.id}>
              <header className="people-group-header">
                <button
                  className="organization-toggle"
                  aria-label={`${team.name}，${isExpanded ? "收起" : "展开"}账号`}
                  aria-expanded={isExpanded}
                  onClick={() => toggle(team.id)}
                >
                  {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                  <span className="people-group-icon"><Building2 size={18} /></span>
                  <span className="people-group-title">
                    <strong>{team.name}</strong>
                    <small>{team.id} · {team.status === "active" ? "团队已启用" : "团队已停用"} · 单价 {team.unitPricePerMinute} 分/分钟</small>
                  </span>
                </button>
                <div className="people-group-leader">
                  <Crown size={15} />
                  <span>{leaders.length ? leaders.map((leader) => `${leader.displayName}${leader.phone ? `（${leader.phone}）` : ""}`).join(" / ") : "待指定"}</span>
                </div>
                <div className="people-group-stats">
                  {teamStats ? (
                    <>
                      <span className="stat-badge">小计 {formatPoints(teamStats.points)}</span>
                      <span>{teamStats.videoCount} 视频</span>
                      <span>{formatDuration(teamStats.effectiveSeconds)}</span>
                      <span>均分 {teamStats.avgScore ?? "—"}</span>
                      <span>{members.length} 人</span>
                    </>
                  ) : (
                    <span>{members.length} 人</span>
                  )}
                </div>
                <div className="people-group-actions">
                  <button className="table-action" onClick={(event) => onEditTeam(team, event.currentTarget)}>编辑团队</button>
                  <button
                    className="table-action"
                    disabled={team.status === "disabled" || members.filter((a) => a.status === "active").length === 0}
                    title={team.status === "disabled" ? "请先启用团队" : members.filter((a) => a.status === "active").length === 0 ? "请先启用团队成员账号" : undefined}
                    onClick={(event) => onAssignLeader(team, event.currentTarget)}
                  >
                    <UserCog size={13} />指定团长
                  </button>
                  <button className="table-action" title="导出本团队结算明细">
                    <Download size={13} />导出团队
                  </button>
                </div>
              </header>
              {isExpanded && <MemberTable accounts={visibleMembers} {...memberTableProps} />}
            </article>
          );
        })}

        {view.teamGroups.length === 0 && view.platformAccounts.length === 0 && (
          <div className="empty-state">
            <Users size={28} />
            <strong>没有匹配的团队或账号</strong>
            <span>请调整搜索词或筛选条件</span>
          </div>
        )}
      </div>
    </section>
  );
}
