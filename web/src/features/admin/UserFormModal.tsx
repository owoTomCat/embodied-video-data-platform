"use client";

import {
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type {
  AccountPublic,
  CreateAccountInput,
  UpdateAccountInput,
} from "../../auth/contracts";
import { Modal } from "../../components/Modal";
import { useIdentity } from "../../auth/client/IdentityContext";
import type { Role } from "../../domain/types";

export function UserFormModal({
  open,
  mode,
  account,
  onCreate,
  onUpdate,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  mode: "create" | "edit";
  account?: AccountPublic;
  onCreate(input: CreateAccountInput): Promise<AccountPublic>;
  onUpdate(
    id: string,
    input: UpdateAccountInput,
  ): Promise<AccountPublic>;
  onClose(): void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { teams } = useIdentity();
  const availableTeams = teams.filter(
    (team) => team.status === "active" || team.id === account?.teamId,
  );
  const [displayName, setDisplayName] = useState(
    account?.displayName ?? "",
  );
  const [username, setUsername] = useState(account?.username ?? "");
  const [phone, setPhone] = useState(account?.phone ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>(
    account?.role ?? "collector",
  );
  const [teamId, setTeamId] = useState(
    account?.teamId ?? availableTeams[0]?.id ?? "",
  );
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  function close() {
    if (submittingRef.current) return;
    setPassword("");
    setError("");
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      setError("手机号格式不正确");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    const fields = {
      displayName,
      username,
      role,
      teamId: role === "admin" ? undefined : teamId,
      phone: trimmedPhone || undefined,
    };

    try {
      if (mode === "create") {
        await onCreate({ ...fields, password });
      } else if (account) {
        await onUpdate(account.id, fields);
      }
      setPassword("");
      submittingRef.current = false;
      setSubmitting(false);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "保存失败，请重试",
      );
      setSubmitting(false);
      submittingRef.current = false;
    }
  }

  const title = mode === "create" ? "新增账号" : "编辑账号";
  return (
    <Modal
      open={open}
      title={title}
      onClose={close}
      returnFocusRef={returnFocusRef}
      initialFocusRef={firstInputRef}
    >
      <form className="modal-form" onSubmit={submit}>
        <label>
          显示名称
          <input
            ref={firstInputRef}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <label>
          用户名
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          手机号
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            maxLength={30}
            placeholder="用于快速联系（选填）"
          />
        </label>
        {mode === "create" && (
          <label>
            初始密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={64}
              required
            />
          </label>
        )}
        <label>
          角色
          <select
            value={role}
            onChange={(event) => {
              const nextRole = event.target.value as Role;
              setRole(nextRole);
              if (nextRole !== "admin" && !teamId) {
                setTeamId(availableTeams[0]?.id ?? "");
              }
            }}
          >
            <option value="collector">数采人员</option>
            <option value="leader">团长</option>
            <option value="admin">管理员</option>
          </select>
        </label>
        {role !== "admin" && (
          <label>
            所属团队
            <select
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
              required
            >
              <option value="" disabled>
                请选择团队
              </option>
              {availableTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}{team.status === "disabled" ? "（已停用）" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={close}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={submitting}
          >
            {submitting
              ? "保存中…"
              : mode === "create"
                ? "创建账号"
                : "保存账号"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
