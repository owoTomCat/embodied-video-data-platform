import {
  effectiveDuration,
  estimateIncome,
  qualityStatus,
  validateWithdrawal,
} from "../domain/calculations";
import type {
  DeliveryPackage,
  LabelConfig,
  Role,
  RuleConfig,
  SettlementBatch,
  Submission,
  User,
  WithdrawalStatus,
} from "../domain/types";
import { demoSeed, type DemoState } from "./demoData";

type Listener = () => void;

function alignTeamsWithUsers(
  teams: DemoState["teams"],
  users: User[],
): DemoState["teams"] {
  return teams.map((team) => {
    const assigned = users.filter((user) => user.teamId === team.id);
    const leaders = assigned.filter((user) => user.role === "leader");
    const primaryLeader =
      leaders.find((user) => user.id === team.leaderId) ?? leaders[0];
    const leaderId = primaryLeader?.id ?? team.leaderId;
    return {
      ...team,
      leaderId,
      memberIds: assigned
        .filter((user) => user.id !== leaderId)
        .map((user) => user.id),
    };
  });
}

export function alignAccountTeams(
  teams: DemoState["teams"],
  users: User[],
): DemoState["teams"] {
  return alignTeamsWithUsers(teams, users);
}

export type InviteMemberInput = { name: string; phone: string };
export type AddUserInput = {
  name: string;
  account: string;
  role: Role;
  teamId?: string;
};
export type UpdateUserInput = {
  userId: string;
  role: Role;
  teamId?: string;
};
export type RuleVersionInput = {
  version: string;
  passThreshold: number;
  description: string;
};
export type UpdateLabelInput = { id: string; name: string; enabled: boolean };
export type DeliveryPackageInput = { name: string };

export class DemoStore {
  private state: DemoState;
  private listeners = new Set<Listener>();

  constructor(seed: DemoState) {
    this.state = structuredClone(seed);
  }

  getState(): DemoState {
    return this.state;
  }

  getSubmission(id: string): Submission {
    const submission = this.state.submissions.find((item) => item.id === id);
    if (!submission) throw new Error("数据提交不存在");
    return submission;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  loginAs(role: Role): void {
    const user = this.state.users.find((item) => item.role === role);
    if (!user) throw new Error("演示账号不存在");
    this.state = { ...this.state, currentUserId: user.id };
    this.notify();
  }

  syncAccount(user: User): void {
    const existing = this.state.users.some(
      (item) => item.id === user.id,
    );
    const users = existing
      ? this.state.users.map((item) =>
          item.id === user.id ? user : item,
        )
      : [...this.state.users, user];
    this.state = {
      ...this.state,
      users,
      teams: alignTeamsWithUsers(this.state.teams, users),
    };
    this.notify();
  }

  upsertSubmission(submission: Submission): void {
    this.state = {
      ...this.state,
      submissions: [
        submission,
        ...this.state.submissions.filter(
          (item) => item.id !== submission.id,
        ),
      ],
    };
    this.notify();
  }

  inviteMember(input: InviteMemberInput): User {
    const current = this.currentUser();
    if (current.role !== "leader") {
      throw new Error("仅团长可邀请成员");
    }
    if (!current.teamId) {
      throw new Error("当前团长未加入团队");
    }

    const name = input.name.trim();
    const phone = input.phone.trim();
    if (!name) throw new Error("请填写成员姓名");
    if (!/^1\d{10}$/.test(phone)) {
      throw new Error("请输入正确的手机号");
    }
    if (this.state.users.some((user) => user.phone === phone)) {
      throw new Error("该手机号已存在");
    }

    const now = Date.now();
    const created: User = {
      id: `U-INV-${now}`,
      name,
      account: `invited_${now}`,
      role: "collector",
      teamId: current.teamId,
      avatar: name.slice(0, 1),
      phone,
      status: "active",
      updatedAt: now,
    };

    this.state = {
      ...this.state,
      users: [...this.state.users, created],
      teams: this.state.teams.map((team) =>
        team.id === current.teamId
          ? { ...team, memberIds: [...team.memberIds, created.id] }
          : team,
      ),
    };
    this.notify();
    return created;
  }

  addUser(input: AddUserInput): User {
    this.requireAdministrator("仅管理员可配置用户");
    const name = input.name.trim();
    const account = input.account.trim();
    if (!name) throw new Error("请填写用户姓名");
    if (!account) throw new Error("请填写登录账号");
    if (this.state.users.some((user) => user.account === account)) {
      throw new Error("登录账号已存在");
    }

    const team = this.teamForRole(input.role, input.teamId);
    const created: User = {
      id: `U-NEW-${Date.now()}`,
      name,
      account,
      role: input.role,
      teamId: team?.id,
      avatar: name.slice(0, 1),
      phone: "未设置",
      status: "active",
      updatedAt: Date.now(),
    };

    let users = [...this.state.users, created];
    let teams = this.state.teams.map((item) => ({
      ...item,
      memberIds: [...item.memberIds],
    }));

    if (team && input.role === "collector") {
      teams = teams.map((item) =>
        item.id === team.id
          ? { ...item, memberIds: [...item.memberIds, created.id] }
          : item,
      );
    }
    if (team && input.role === "leader") {
      ({ users, teams } = this.assignLeader(created.id, team.id, users, teams));
    }

    this.state = { ...this.state, users, teams };
    this.notify();
    return created;
  }

  updateUser(input: UpdateUserInput): User {
    this.requireAdministrator("仅管理员可配置用户");
    const existing = this.state.users.find((user) => user.id === input.userId);
    if (!existing) throw new Error("用户不存在");

    const ledTeam = this.state.teams.find((team) => team.leaderId === existing.id);
    if (ledTeam && (input.role !== "leader" || input.teamId !== ledTeam.id)) {
      throw new Error("请先为团队指定新的团长");
    }

    const team = this.teamForRole(input.role, input.teamId);
    const updated: User = {
      ...existing,
      role: input.role,
      teamId: team?.id,
    };
    let users = this.state.users.map((user) =>
      user.id === updated.id ? updated : user,
    );
    let teams = this.state.teams.map((item) => ({
      ...item,
      memberIds: item.memberIds.filter((id) => id !== updated.id),
    }));

    if (team && input.role === "collector") {
      teams = teams.map((item) =>
        item.id === team.id
          ? { ...item, memberIds: [...item.memberIds, updated.id] }
          : item,
      );
    }
    if (team && input.role === "leader") {
      ({ users, teams } = this.assignLeader(updated.id, team.id, users, teams));
    }

    this.state = { ...this.state, users, teams };
    this.notify();
    return users.find((user) => user.id === updated.id)!;
  }

  createRuleVersion(input: RuleVersionInput): RuleConfig {
    const current = this.requireAdministrator("仅管理员可执行该操作");
    const version = input.version.trim();
    const description = input.description.trim();
    if (!version) throw new Error("请填写版本名称");
    if (
      !Number.isInteger(input.passThreshold) ||
      input.passThreshold < 0 ||
      input.passThreshold > 100
    ) {
      throw new Error("通过阈值必须是 0 到 100 的整数");
    }
    if (!description) throw new Error("请填写规则说明");

    const rule: RuleConfig = {
      version,
      passThreshold: input.passThreshold,
      description,
    };
    this.state = {
      ...this.state,
      rule,
      operationLogs: [
        {
          id: `OP-RULE-${Date.now()}`,
          actor: current.name,
          action: "发布质量规则",
          target: rule.version,
          reason: rule.description,
          createdAt: "2026-08-03 18:10",
        },
        ...this.state.operationLogs,
      ],
    };
    this.notify();
    return rule;
  }

  updateLabel(input: UpdateLabelInput): LabelConfig {
    this.requireAdministrator("仅管理员可执行该操作");
    const existing = this.state.labels.find((label) => label.id === input.id);
    if (!existing) throw new Error("标签不存在");
    const name = input.name.trim();
    if (!name) throw new Error("请填写标签名称");

    const updated = { ...existing, name, enabled: input.enabled };
    this.state = {
      ...this.state,
      labels: this.state.labels.map((label) =>
        label.id === updated.id ? updated : label,
      ),
    };
    this.notify();
    return updated;
  }

  createSettlementBatch(): SettlementBatch {
    const current = this.requireAdministrator("仅管理员可执行该操作");
    const eligible = this.state.submissions.filter(
      (item) =>
        item.processingStatus === "completed" &&
        item.qualityStatus === "passed" &&
        item.settlementStatus === "unsettled",
    );
    if (eligible.length === 0) {
      throw new Error("当前没有可结算数据");
    }

    const effectiveSeconds = eligible.reduce(
      (total, item) =>
        total + effectiveDuration(item.durationSeconds, item.invalidSeconds),
      0,
    );
    const amount = eligible.reduce((total, item) => {
      const team = this.state.teams.find((entry) => entry.id === item.teamId);
      if (!team) throw new Error("提交数据所属团队不存在");
      return (
        total +
        estimateIncome(
          team.unitPricePerMinute,
          item.durationSeconds,
          item.invalidSeconds,
          item.finalScore,
          item.qualityResult?.settlementRatio,
        )
      );
    }, 0);
    const batch: SettlementBatch = {
      id: `SET-${Date.now()}`,
      date: "2026-08-03",
      submissionCount: eligible.length,
      effectiveMinutes: Math.round((effectiveSeconds / 60) * 100) / 100,
      amount: Math.round(amount * 100) / 100,
      status: "locked",
    };
    const eligibleIds = new Set(eligible.map((item) => item.id));
    this.state = {
      ...this.state,
      submissions: this.state.submissions.map((item) =>
        eligibleIds.has(item.id)
          ? { ...item, settlementStatus: "settled" as const }
          : item,
      ),
      settlements: [batch, ...this.state.settlements],
      operationLogs: [
        {
          id: `OP-SET-${Date.now()}`,
          actor: current.name,
          action: "生成结算批次",
          target: batch.id,
          reason: `锁定 ${batch.submissionCount} 条合格数据`,
          createdAt: "2026-08-03 18:12",
        },
        ...this.state.operationLogs,
      ],
    };
    this.notify();
    return batch;
  }

  createDeliveryPackage(input: DeliveryPackageInput): DeliveryPackage {
    this.requireAdministrator("仅管理员可执行该操作");
    const name = input.name.trim();
    if (!name) throw new Error("请填写交付包名称");
    const assetCount = this.state.submissions.filter(
      (item) =>
        item.settlementStatus === "settled" && item.qualityStatus === "passed",
    ).length;
    if (assetCount === 0) throw new Error("当前没有可交付资产");

    const created: DeliveryPackage = {
      id: `PKG-${Date.now()}`,
      name,
      assetCount,
      status: "ready",
      createdAt: "2026-08-03 18:14",
    };
    this.state = {
      ...this.state,
      deliveryPackages: [created, ...this.state.deliveryPackages],
    };
    this.notify();
    return created;
  }

  addUploads(files: File[]): void {
    const user = this.currentUser();
    const team = this.state.teams.find((item) => item.id === user.teamId);
    if (!team) throw new Error("当前账号未加入团队");

    const created = files.map<Submission>((file, index) => ({
      id: `SUB-UP-${Date.now()}-${index}`,
      fileName: file.name,
      ownerId: user.id,
      ownerName: user.name,
      teamId: team.id,
      teamName: team.name,
      scene: "待识别",
      action: "AI 分析中",
      object: "待识别",
      durationSeconds: 0,
      invalidSeconds: 0,
      sizeMb: Math.max(0.1, Math.round((file.size / 1024 / 1024) * 10) / 10),
      resolution: "解析中",
      processingStatus: "queued",
      qualityStatus: "pending",
      aiScore: 0,
      finalScore: 0,
      settlementStatus: "unsettled",
      createdAt: "2026-08-03 17:00",
      tags: [],
      issues: [],
      audit: [],
    }));

    this.state = {
      ...this.state,
      submissions: [...created, ...this.state.submissions],
    };
    this.notify();
  }

  adjustQuality(id: string, score: number, reason: string): void {
    const current = this.currentUser();
    const submission = this.getSubmission(id);

    if (submission.settlementStatus === "settled") {
      throw new Error("已结算数据不可修改");
    }
    if (current.role === "collector") {
      throw new Error("无权调整该数据");
    }
    if (current.role === "leader" && current.teamId !== submission.teamId) {
      throw new Error("无权调整该团队数据");
    }
    if (!reason.trim()) {
      throw new Error("请填写调整原因");
    }

    this.state = {
      ...this.state,
      submissions: this.state.submissions.map((item) =>
        item.id === id
          ? {
              ...item,
              finalScore: score,
              qualityStatus: qualityStatus(score),
              audit: [
                ...item.audit,
                {
                  id: `AUD-${Date.now()}`,
                  actor: current.name,
                  action: "人工调整质量评分",
                  reason: reason.trim(),
                  createdAt: "2026-08-03 17:02",
                  previousScore: item.finalScore,
                  nextScore: score,
                },
              ],
            }
          : item,
      ),
    };
    this.notify();
  }

  requestWithdrawal(amount: number): void {
    const user = this.currentUser();
    const validation = validateWithdrawal(
      amount,
      this.state.wallet.available,
      this.state.wallet.minimumWithdrawal,
    );
    if (!validation.valid) throw new Error(validation.message);

    this.state = {
      ...this.state,
      wallet: {
        ...this.state.wallet,
        available: this.state.wallet.available - amount,
        frozen: this.state.wallet.frozen + amount,
      },
      withdrawals: [
        {
          id: `WD-${Date.now()}`,
          userId: user.id,
          userName: user.name,
          amount,
          status: "pending",
          account: user.alipayAccount ?? "未设置",
          createdAt: "2026-08-03 17:03",
        },
        ...this.state.withdrawals,
      ],
    };
    this.notify();
  }

  reviewWithdrawal(id: string, status: WithdrawalStatus): void {
    if (this.currentUser().role !== "admin") {
      throw new Error("仅管理员可审核提现");
    }

    this.state = {
      ...this.state,
      withdrawals: this.state.withdrawals.map((item) =>
        item.id === id ? { ...item, status } : item,
      ),
    };
    this.notify();
  }

  private currentUser() {
    const user = this.state.users.find(
      (item) => item.id === this.state.currentUserId,
    );
    if (!user) throw new Error("当前演示账号不存在");
    return user;
  }

  private requireAdministrator(message: string): User {
    const current = this.currentUser();
    if (current.role !== "admin") throw new Error(message);
    return current;
  }

  private teamForRole(role: Role, teamId?: string) {
    if (role === "admin") return undefined;
    const team = this.state.teams.find((item) => item.id === teamId);
    if (!team) throw new Error("请选择有效团队");
    return team;
  }

  private assignLeader(
    leaderId: string,
    teamId: string,
    users: User[],
    teams: DemoState["teams"],
  ): { users: User[]; teams: DemoState["teams"] } {
    const team = teams.find((item) => item.id === teamId)!;
    const previousLeaderId = team.leaderId;
    const nextUsers = users.map((user) => {
      if (user.id === leaderId) {
        return { ...user, role: "leader" as const, teamId };
      }
      if (user.id === previousLeaderId && previousLeaderId !== leaderId) {
        return { ...user, role: "collector" as const, teamId };
      }
      return user;
    });
    const nextTeams = teams.map((item) => {
      if (item.id !== teamId) return item;
      const memberIds = item.memberIds.filter((id) => id !== leaderId);
      if (previousLeaderId !== leaderId && !memberIds.includes(previousLeaderId)) {
        memberIds.push(previousLeaderId);
      }
      return { ...item, leaderId, memberIds };
    });
    return { users: nextUsers, teams: nextTeams };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}

export function createDemoStore(seed: DemoState): DemoStore {
  return new DemoStore(seed);
}

export { demoSeed };
