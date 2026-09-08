"use client";

import { Phone, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  AccountApiError,
  changeOwnPassword,
  updateOwnAccount,
} from "../../auth/client/accountApi";
import { useIdentity } from "../../auth/client/IdentityContext";
import { useInteractions } from "../../interactions/InteractionContext";
import { deletePayoutRecipient, getSavedPayoutRecipients, savePayoutRecipient, WalletApiError } from "../../wallet/client/walletApi";
import type { SavedPayoutRecipient } from "../../wallet/contracts";

const roleLabels = {
  collector: "数采人员",
  leader: "团长",
  admin: "平台管理员",
};

const statusLabels = {
  active: "正常",
  disabled: "已停用",
};

function SavedRecipientForm({ method, initial }: { method: SavedPayoutRecipient["method"]; initial?: SavedPayoutRecipient }) {
  const { notify } = useInteractions();
  const [name, setName] = useState(initial?.name ?? "");
  const [account, setAccount] = useState(initial?.account ?? "");
  const [bankName, setBankName] = useState(initial?.bankName ?? "");
  const [saved, setSaved] = useState(Boolean(initial));
  const [pending, setPending] = useState<"save" | "delete" | null>(null);
  const pendingRef = useRef(false);
  const [error, setError] = useState("");
  const label = method === "alipay" ? "支付宝" : "银行账户";

  async function persist(action: "save" | "delete") {
    if (pendingRef.current) return;
    if (action === "save" && (!name.trim() || !account.trim() || (method === "bank" && !bankName.trim()))) {
      setError("请完整填写收款人姓名、账号及银行名称（银行账户）");
      return;
    }
    if (action === "delete" && !window.confirm(`确认删除已保存的${label}收款信息？已提交的提现申请不受影响。`)) return;
    pendingRef.current = true;
    setPending(action);
    setError("");
    try {
      if (action === "delete") {
        await deletePayoutRecipient(method);
        setName("");
        setAccount("");
        setBankName("");
        setSaved(false);
        notify("success", `${label}收款信息已删除`);
      } else {
        const recipient = await savePayoutRecipient(method, { name: name.trim(), account: account.trim(), bankName: method === "bank" ? bankName.trim() : undefined });
        setName(recipient.name);
        setAccount(recipient.account);
        setBankName(recipient.bankName);
        setSaved(true);
        notify("success", `${label}收款信息已保存`);
      }
    } catch (reason) {
      setError(reason instanceof WalletApiError ? reason.message : "操作未能确认完成，请重试");
    } finally {
      pendingRef.current = false;
      setPending(null);
    }
  }

  return (
    <form className="profile-form saved-recipient-form" onSubmit={event => { event.preventDefault(); void persist("save"); }}>
      <fieldset disabled={pending !== null}>
        <legend>{label}收款信息</legend>
        <p className="form-message">{saved ? "已保存 · 修改后请点击保存" : "尚未保存 · 可选填写"}</p>
        <label><span>{label}收款人姓名</span><input value={name} onChange={event => setName(event.target.value)} maxLength={120} required autoComplete="off" /></label>
        <label><span>{method === "alipay" ? "支付宝账号" : "银行卡 / 账户"}</span><input value={account} onChange={event => setAccount(event.target.value)} maxLength={200} required autoComplete="off" /></label>
        {method === "bank" && <label><span>银行名称</span><input value={bankName} onChange={event => setBankName(event.target.value)} maxLength={120} required autoComplete="off" /></label>}
        {error && <p className="form-alert" role="alert">{error}</p>}
        <div className="saved-recipient-actions">
          <button className="button button-primary" type="submit">{pending === "save" ? "保存中…" : `保存${label}`}</button>
          {saved && <button className="button button-secondary" type="button" onClick={() => void persist("delete")}>{pending === "delete" ? "删除中…" : `删除已保存的${label}`}</button>}
        </div>
      </fieldset>
    </form>
  );
}

function SavedRecipientsSection() {
  const [recipients, setRecipients] = useState<SavedPayoutRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    getSavedPayoutRecipients().then(values => {
      if (!active) return;
      setRecipients(values);
      setLoading(false);
    }).catch(reason => {
      if (!active) return;
      setError(reason instanceof WalletApiError ? reason.message : "收款信息加载失败，请重试");
      setLoading(false);
    });
    return () => { active = false; };
  }, [revision]);

  return (
    <section className="content-card saved-recipients-card" aria-labelledby="saved-recipients-heading">
      <div className="card-heading"><div><h2 id="saved-recipients-heading">常用收款信息</h2><p>支付宝和银行账户可分别保存一份，收款人姓名可不同。仅供本人提现时选用，也可始终手动填写。</p></div></div>
      <p className="form-message">修改或删除不会影响已提交的提现申请。请勿填写身份证、密码、PIN 或 CVV。</p>
      {loading ? <p className="form-message" role="status">正在加载收款信息…</p> : error ? (
        <div><p className="form-alert" role="alert">{error}。不影响手机号和密码修改。</p><button type="button" className="button button-secondary" onClick={() => { setError(""); setLoading(true); setRevision(value => value + 1); }}>重试加载收款信息</button></div>
      ) : (
        <div className="saved-recipient-grid">
          {(["alipay", "bank"] as const).map(method => <SavedRecipientForm key={method} method={method} initial={recipients.find(recipient => recipient.method === method)} />)}
        </div>
      )}
    </section>
  );
}

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
          <span>管理个人账号、登录密码与常用收款信息</span>
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
      <SavedRecipientsSection key={currentAccount.id} />
    </div>
  );
}
