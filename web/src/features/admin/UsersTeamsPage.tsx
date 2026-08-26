"use client";

import {
  Building2,
  UserRoundPlus,
} from "lucide-react";
import { useRef, useState } from "react";
import * as accountApi from "../../auth/client/accountApi";
import { useIdentity } from "../../auth/client/IdentityContext";
import type {
  AccountPublic,
  CreateTeamInput,
  CreateAccountInput,
  TeamPublic,
  UpdateTeamInput,
  UpdateAccountInput,
} from "../../auth/contracts";
import { useInteractions } from "../../interactions/InteractionContext";
import { AccountDeleteModal } from "./AccountDeleteModal";
import { AccountStatusModal } from "./AccountStatusModal";
import { AssignTeamLeaderModal } from "./AssignTeamLeaderModal";
import { ResetPasswordModal } from "./ResetPasswordModal";
import { TeamFormModal } from "./TeamFormModal";
import { UserFormModal } from "./UserFormModal";
import { OrganizationHierarchy } from "./OrganizationHierarchy";

export function UsersTeamsPage() {
  const {
    accounts,
    currentAccount,
    teams,
    removeAccount,
    upsertAccount,
    upsertTeam,
  } = useIdentity();
  const { notify } = useInteractions();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AccountPublic>();
  const [resetTarget, setResetTarget] = useState<AccountPublic>();
  const [statusTarget, setStatusTarget] = useState<AccountPublic>();
  const [deleteTarget, setDeleteTarget] = useState<AccountPublic>();
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [editTeamTarget, setEditTeamTarget] = useState<TeamPublic>();
  const [leaderTeamTarget, setLeaderTeamTarget] = useState<TeamPublic>();
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement>(null);
  const createTeamTriggerRef = useRef<HTMLButtonElement>(null);
  const teamActionTriggerRef = useRef<HTMLButtonElement>(null);

  async function create(input: CreateAccountInput) {
    const account = await accountApi.createAccount(input);
    upsertAccount(account);
    notify("success", "账号已创建");
    return account;
  }

  async function update(id: string, input: UpdateAccountInput) {
    const account = await accountApi.updateAccount(id, input);
    upsertAccount(account);
    notify("success", "账号信息已更新");
    return account;
  }

  async function createTeam(input: CreateTeamInput) {
    const team = await accountApi.createTeam(input);
    upsertTeam(team);
    notify("success", "团队已创建");
    return team;
  }

  async function updateTeam(id: string, input: UpdateTeamInput) {
    const team = await accountApi.updateTeam(id, input);
    upsertTeam(team);
    notify("success", "团队信息已更新");
    return team;
  }

  async function assignLeader(teamId: string, accountId: string) {
    const changed = await accountApi.assignTeamLeader(teamId, accountId);
    changed.forEach(upsertAccount);
    notify("success", "团长已更新，相关账号需重新登录");
  }

  function rememberActionTrigger(button: HTMLButtonElement) {
    actionTriggerRef.current = button;
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">组织与权限</p>
          <h1>用户与团队</h1>
          <span>创建真实登录账号、设置角色并维护团队归属</span>
        </div>
        <div className="page-heading-actions">
          <button
            ref={createTeamTriggerRef}
            className="button button-secondary"
            onClick={() => setCreateTeamOpen(true)}
          >
            <Building2 size={16} />
            新增团队
          </button>
          <button
            ref={createTriggerRef}
            className="button button-primary"
            onClick={() => setCreateOpen(true)}
          >
            <UserRoundPlus size={16} />
            新增账号
          </button>
        </div>
      </div>

      <OrganizationHierarchy
        accounts={accounts}
        teams={teams}
        currentAccountId={currentAccount.id}
        onEditTeam={(team, button) => {
          teamActionTriggerRef.current = button;
          setEditTeamTarget(team);
        }}
        onAssignLeader={(team, button) => {
          teamActionTriggerRef.current = button;
          setLeaderTeamTarget(team);
        }}
        onEditAccount={(account, button) => {
          rememberActionTrigger(button);
          setEditTarget(account);
        }}
        onResetPassword={(account, button) => {
          rememberActionTrigger(button);
          setResetTarget(account);
        }}
        onToggleStatus={(account, button) => {
          rememberActionTrigger(button);
          setStatusTarget(account);
        }}
        onDeleteAccount={(account, button) => {
          rememberActionTrigger(button);
          setDeleteTarget(account);
        }}
      />

      {createOpen && (
        <UserFormModal
          open
          mode="create"
          onCreate={create}
          onUpdate={update}
          onClose={() => setCreateOpen(false)}
          returnFocusRef={createTriggerRef}
        />
      )}
      {createTeamOpen && (
        <TeamFormModal
          mode="create"
          onCreate={createTeam}
          onUpdate={updateTeam}
          onClose={() => setCreateTeamOpen(false)}
          returnFocusRef={createTeamTriggerRef}
        />
      )}
      {editTeamTarget && (
        <TeamFormModal
          mode="edit"
          team={editTeamTarget}
          memberCount={
            accounts.filter(
              (account) =>
                account.teamId === editTeamTarget.id &&
                account.status === "active",
            ).length
          }
          onCreate={createTeam}
          onUpdate={updateTeam}
          onClose={() => setEditTeamTarget(undefined)}
          returnFocusRef={teamActionTriggerRef}
        />
      )}
      {leaderTeamTarget && (
        <AssignTeamLeaderModal
          team={leaderTeamTarget}
          accounts={accounts}
          onAssign={(accountId) => assignLeader(leaderTeamTarget.id, accountId)}
          onClose={() => setLeaderTeamTarget(undefined)}
          returnFocusRef={teamActionTriggerRef}
        />
      )}
      {editTarget && (
        <UserFormModal
          open
          mode="edit"
          account={editTarget}
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
            const result = await accountApi.resetAccountPassword(
              resetTarget.id,
              password,
            );
            notify("success", "账号密码已重置");
            if (result.reauthenticate) {
              window.location.assign("/login");
            }
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
              statusTarget.status === "active"
                ? "disabled"
                : "active";
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
      {deleteTarget && (
        <AccountDeleteModal
          account={deleteTarget}
          returnFocusRef={actionTriggerRef}
          onClose={() => setDeleteTarget(undefined)}
          onDelete={async () => {
            await accountApi.deleteAccount(deleteTarget.id);
            removeAccount(deleteTarget.id);
            notify("success", "账号已永久删除");
          }}
        />
      )}
    </div>
  );
}
