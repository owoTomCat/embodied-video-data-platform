"use client";

import { Phone, ShieldCheck, UserRound } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import {
  AccountApiError,
  changeOwnPassword,
  updateOwnAccount,
} from "../../auth/client/accountApi";
import { useIdentity } from "../../auth/client/IdentityContext";
import { useInteractions } from "../../interactions/InteractionContext";

const roleLabels = {
  collector: "数采人员",
  leader: "团长",
  admin: "平台管理员",
};

const statusLabels = {
  active: "正常",
  disabled: "已停用",
};

export function AccountProfilePage() {
  const { currentAccount, teams, upsertAccount } = useIdentity();
  const { notify } = useInteractions();
  const [phone, setPhone] = useState(currentAccount.phone ?? "");
  const [phoneError, setPhoneError] = useState("");
  const [phoneSaving, setPhoneSaving] = useState(false);
  const phoneSavingRef = useRef(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const team = teams.find((candidate) => candidate.id === currentAccount.teamId);

  function clearPasswords() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
  }

  async function savePhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phoneSavingRef.current) return;
    const trimmedPhone = phone.trim();
    if (trimmedPhone && !/^1[3-9]\d{9}$/.test(trimmedPhone)) {
      setPhoneError("手机号格式不正确");
      return;
    }
    phoneSavingRef.current = true;
    setPhoneSaving(true);
    setPhoneError("");
    try {
      const updated = await updateOwnAccount({ phone: trimmedPhone || undefined });
      upsertAccount(updated);
      setPhone(updated.phone ?? "");
      notify("success", "手机号已保存");
    } catch (reason) {
      setPhoneError(
        reason instanceof AccountApiError
          ? reason.message
          : "保存手机号失败，请稍后重试",
      );
    } finally {
      phoneSavingRef.current = false;
      setPhoneSaving(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (newPassword !== confirmation) {
      setError("两次输入的密码不一致");
      return;
    }
    if (newPassword.length < 8 || newPassword.length > 64) {
      setError("密码长度需为 8 到 64 位");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      await changeOwnPassword(currentPassword, newPassword);
      clearPasswords();
      notify("success", "密码已修改，请使用新密码重新登录");
      window.setTimeout(() => window.location.assign("/login"), 800);
    } catch (reason) {
      setNewPassword("");
      setConfirmation("");
      setError(
        reason instanceof AccountApiError
          ? reason.message
          : "修改密码失败，请稍后重试",
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">个人账号</p>
          <h1>个人资料</h1>
          <span>查看账号信息并修改登录密码</span>
        </div>
      </div>
      <div className="profile-grid">
        <aside className="content-card profile-card">
          <span className="profile-avatar">
            {currentAccount.displayName.slice(0, 1)}
          </span>
          <h2>{currentAccount.displayName}</h2>
          <p>{roleLabels[currentAccount.role]}</p>
          <div>
            <span>
              <UserRound size={15} /> 用户名 {currentAccount.username}
            </span>
            <span>
              <ShieldCheck size={15} /> {statusLabels[currentAccount.status]}
            </span>
          </div>
        </aside>
        <section className="content-card">
          <div className="card-heading">
            <div>
              <h2>账户信息</h2>
              <p>以下信息由身份服务维护。</p>
            </div>
          </div>
          <dl className="metadata-grid">
            <div>
              <small>显示名称</small>
              <strong>{currentAccount.displayName}</strong>
            </div>
            <div>
              <small>用户名</small>
              <strong>{currentAccount.username}</strong>
            </div>
            <div>
              <small>角色</small>
              <strong>{roleLabels[currentAccount.role]}</strong>
            </div>
            <div>
              <small>所属团队</small>
              <strong>{team?.name ?? "未分配团队"}</strong>
            </div>
            <div>
              <small>手机号</small>
              <strong>{currentAccount.phone || "未填写"}</strong>
            </div>
            <div>
              <small>账号状态</small>
              <strong>{statusLabels[currentAccount.status]}</strong>
            </div>
          </dl>
          <form className="profile-form" onSubmit={savePhone}>
            <div className="form-section-title">修改手机号</div>
            <label>
              <span>手机号</span>
              <input
                type="tel"
                autoComplete="tel"
                maxLength={30}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="用于人员管理快速联系（选填）"
              />
            </label>
            {phoneError && (
              <p className="form-alert" role="alert">
                {phoneError}
              </p>
            )}
            <button
              className="button button-secondary"
              type="submit"
              disabled={phoneSaving}
            >
              <Phone size={15} />
              {phoneSaving ? "保存中…" : "保存手机号"}
            </button>
          </form>
          <form className="profile-form" onSubmit={submit}>
            <div className="form-section-title">修改密码</div>
            <label>
              <span>当前密码</span>
              <input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
              />
            </label>
            <div className="form-grid">
              <label>
                <span>新密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </label>
              <label>
                <span>确认新密码</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                />
              </label>
            </div>
            {error && (
              <p className="form-alert" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button-primary"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "修改中…" : "修改密码"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
