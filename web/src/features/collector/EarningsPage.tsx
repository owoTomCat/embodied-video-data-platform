"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  CircleDollarSign,
  Clock3,
  Landmark,
} from "lucide-react";

import { useInteractions } from "../../interactions/InteractionContext";
import { useIdentity } from "../../auth/client/IdentityContext";
import { StatusBadge } from "../../components/StatusBadge";
import {
  getMyWallet,
  getSavedPayoutRecipients,
  withdrawWallet,
  type WalletDetail,
} from "../../wallet/client/walletApi";
import type { SavedPayoutRecipient, WalletTransaction } from "../../wallet/contracts";
import { WithdrawalHistory } from "../../wallet/WithdrawalHistory";

type PageMode = "loading" | "live" | "unavailable";

/** 明细视图：结算中 / 可提现 / 累计赚取 */
type DetailView = "settling" | "available" | "earned";

const emptyWallet: WalletDetail = {
  balance: {
    ownerId: "",
    ownerName: "",
    totalBalance: 0,
    settlingBalance: 0,
    nextSettlementAt: null,
    availableBalance: 0,
    reservedBalance: 0,
    withdrawnBalance: 0,
    cumulativeWithdrawn: 0,
  },
  transactions: [],
};

function formatMoney(amount: number): string {
  return `${Math.round(amount * 100) / 100} 元`;
}

const transactionLabels: Record<string, string> = {
  lock: "质检通过入账",
  settle: "结算转可提现",
  withdraw: "提现",
};

function transactionTone(type: string): "success" | "info" | "warning" {
  if (type === "settle") return "success";
  if (type === "lock") return "info";
  return "warning";
}

/** 累计赚取包含结算中、可提现、预留及已提现，不重复累计资金转移流水。 */
function earnedTotal(balance: WalletDetail["balance"]): number {
  return Math.round((balance.settlingBalance + balance.availableBalance + balance.reservedBalance + balance.withdrawnBalance) * 100) / 100;
}

const viewMeta: Record<
  DetailView,
  { label: string; description: string; types: WalletTransaction["type"][] }
> = {
  settling: {
    label: "结算中",
    description: "质检通过且符合计费条件即入账；仅上传或等待人工复核不产生收益。下列为入账历史，预计可提现时间不代表实际付款时间。",
    types: ["lock"],
  },
  available: {
    label: "可提现",
    description: "已结算确认、尚未提现的金额（对应「结算转可提现」流水）",
    types: ["settle"],
  },
  earned: {
    label: "累计赚取",
    description: "累计已入账收益（含结算中、提现预留和已提现）；展示入账记录，结算与提现不重复计为收益。",
    types: ["lock"],
  },
};

export function EarningsPage({ navigate }: { navigate(path: string): void }) {
  const { currentAccount } = useIdentity();
  return <EarningsContent key={currentAccount.id} navigate={navigate} />;
}

function EarningsContent({ navigate }: { navigate(path: string): void }) {
  const { notify } = useInteractions();
  const { currentAccount } = useIdentity();
  const [wallet, setWallet] = useState<WalletDetail>(emptyWallet);
  const [mode, setMode] = useState<PageMode>("loading");
  const [view, setView] = useState<DetailView>("settling");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [method, setMethod] = useState<"alipay" | "bank">("alipay");
  const [account, setAccount] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [bankName, setBankName] = useState("");
  const [revision, setRevision] = useState(0);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const withdrawingRef = useRef(false);
  const [recipients, setRecipients] = useState<SavedPayoutRecipient[]>([]);
  const [recipientSource, setRecipientSource] = useState<"manual" | "alipay" | "bank">("manual");
  const [recipientsLoading, setRecipientsLoading] = useState(true);
  const [recipientsError, setRecipientsError] = useState("");
  const [recipientsRevision, setRecipientsRevision] = useState(0);

  useEffect(() => {
    let active = true;
    getSavedPayoutRecipients().then(values => {
      if (!active) return;
      setRecipients(values);
      setRecipientsLoading(false);
    }).catch(() => {
      if (!active) return;
      setRecipientsError("常用收款信息暂不可用，仍可手动填写并提现。");
      setRecipientsLoading(false);
    });
    return () => { active = false; };
  }, [currentAccount.id, recipientsRevision]);

  function changeMethod(value: SavedPayoutRecipient["method"]) {
    setMethod(value);
    setRecipientSource("manual");
    setRecipientName("");
    setAccount("");
    setBankName("");
  }

  function changeSource(value: "manual" | "alipay" | "bank") {
    if (value === "manual") {
      changeMethod(method);
      return;
    }
    const recipient = recipients.find(item => item.method === value);
    if (!recipient) return;
    setRecipientSource(value);
    setMethod(recipient.method);
    setRecipientName(recipient.name);
    setAccount(recipient.account);
    setBankName(recipient.method === "bank" ? recipient.bankName : "");
  }

  useEffect(() => {
    let active = true;
    getMyWallet()
      .then((detail) => {
        if (!active) return;
        setWallet(detail);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setWallet(emptyWallet);
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [currentAccount.id]);

  const balance = wallet.balance;
  const earned = earnedTotal(balance);

  async function submitWithdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (withdrawingRef.current) return;
    const amount = Number(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      notify("error", "请输入大于 0 的提现金额");
      return;
    }
    if (amount > balance.availableBalance) {
      notify("error", "提现金额不能超过可提现余额");
      return;
    }
    if (
      !window.confirm(
        `确认申请提现 ${formatMoney(amount)} 至 ${method === "bank" ? bankName : "支付宝"} / ${recipientName.trim()} / ${account.trim()}？请核对收款信息。此操作仅预留金额，需财务线下转账，不代表已付款。`,
      )
    ) {
      return;
    }
    withdrawingRef.current = true;
    setWithdrawing(true);
    try {
      const input = { amount, method, account: account.trim(), name: recipientName.trim(), bankName: method === "bank" ? bankName.trim() : undefined };
      const payload = JSON.stringify(input);
      if (!attempt.current || attempt.current.payload !== payload) {
        attempt.current = { payload, key: crypto.randomUUID() };
      }
      await withdrawWallet({ ...input, idempotencyKey: attempt.current.key });
      attempt.current = null;
      setWithdrawAmount("");
      setAccount("");
      setRecipientName("");
      setBankName("");
      setRecipientSource("manual");
      setRevision(value => value + 1);
      notify("success", "提现申请已提交，金额已预留，等待财务人工付款");
      try {
        setWallet(await getMyWallet());
      } catch {
        setMode("unavailable");
        notify("error", "申请已提交，但余额刷新失败；请刷新页面，不要重复申请");
      }
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "提现失败，请重试");
    } finally {
      withdrawingRef.current = false;
      setWithdrawing(false);
    }
  }

  const viewTransactions = useMemo(() => {
    const allowed = viewMeta[view].types;
    return wallet.transactions.filter((item) => allowed.includes(item.type));
  }, [wallet.transactions, view]);

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">个人钱包账户</p>
          <h1>钱包</h1>
          <span>质检通过且符合计费条件，金额立即进入「结算中」；北京时间次日02:00转为「可提现」，非满24小时。</span>
        </div>
        <span className="live-pill">
          <i />
          {mode === "live"
            ? "已连接钱包数据"
            : mode === "loading"
              ? "正在读取钱包"
              : "钱包服务暂不可用"}
        </span>
      </div>

      <div className="wallet-summary-cards">
        <button
          type="button"
          className={`wallet-summary-card${view === "settling" ? " active" : ""}`}
          onClick={() => setView("settling")}
          aria-pressed={view === "settling"}
        >
          <span className="wallet-summary-icon"><Clock3 size={20} /></span>
          <span className="wallet-summary-label">结算中</span>
          <strong>{formatMoney(balance.settlingBalance)}</strong>
          <small>质检通过已入账，等待次日可提现</small>
        </button>
        <button
          type="button"
          className={`wallet-summary-card${view === "available" ? " active" : ""}`}
          onClick={() => setView("available")}
          aria-pressed={view === "available"}
        >
          <span className="wallet-summary-icon"><CircleDollarSign size={20} /></span>
          <span className="wallet-summary-label">可提现</span>
          <strong>{formatMoney(balance.availableBalance)}</strong>
          <small>已结算确认、未提现</small>
        </button>
        <button
          type="button"
          className={`wallet-summary-card${view === "earned" ? " active" : ""}`}
          onClick={() => setView("earned")}
          aria-pressed={view === "earned"}
        >
          <span className="wallet-summary-icon"><Landmark size={20} /></span>
          <span className="wallet-summary-label">累计赚取</span>
          <strong>{formatMoney(earned)}</strong>
          <small>含结算中、预留和已提现</small>
        </button>
      </div>
      <p className="form-message">
        最早预计可提现（北京时间）：{balance.nextSettlementAt === null ? "暂无待结算时间" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(balance.nextSettlementAt)}。
        可提现不等于到账，实际付款仍需提交提现申请并由财务人工转账。
      </p>
      <p className="form-message">提现处理中（已预留）：<strong>{formatMoney(balance.reservedBalance)}</strong>，不计为已付款。</p>
      <WithdrawalHistory key={currentAccount.id} revision={revision} />

      {view === "available" && (
        <section className="content-card wallet-withdraw-card">
          <div className="card-heading">
            <div>
              <h2>提现</h2>
              <p>提交后预留金额，由财务线下人工转账；只在实际付款确认后计入已提现。不要填写身份证、密码、PIN 或 CVV。</p>
            </div>
          </div>
          <form className="wallet-withdraw-form modal-form" onSubmit={submitWithdraw}>
            <div className="wallet-recipient-source">
              <label>收款信息来源<select aria-label="收款信息来源" value={recipientSource} disabled={withdrawing} onChange={event => changeSource(event.target.value as "manual" | "alipay" | "bank")}>
                <option value="manual">手动填写（不保存）</option>
                {recipients.map(recipient => <option key={recipient.method} value={recipient.method}>已保存的{recipient.method === "alipay" ? "支付宝" : "银行账户"}</option>)}
              </select></label>
              <p className="form-message">选用后仍可编辑，修改仅用于本次提现，不会自动保存。<button type="button" className="table-action" disabled={withdrawing} onClick={() => navigate("/account/profile")}>管理常用收款信息</button></p>
              {recipientsLoading && <p className="form-message" role="status">正在加载常用收款信息，可先手动填写…</p>}
              {recipientsError && <div className="wallet-recipient-feedback"><p className="form-message" role="status">{recipientsError}</p><button type="button" className="button button-secondary" disabled={recipientsLoading || withdrawing} onClick={() => { setRecipientsError(""); setRecipientsLoading(true); setRecipientsRevision(value => value + 1); }}>重试加载收款信息</button></div>}
            </div>
            <label>收款方式<select aria-label="收款方式" value={method} disabled={withdrawing} onChange={event => changeMethod(event.target.value as "alipay" | "bank")}><option value="alipay">支付宝</option><option value="bank">银行账户</option></select></label>
            <label>收款人姓名<input aria-label="收款人姓名" value={recipientName} disabled={withdrawing} onChange={event => setRecipientName(event.target.value)} maxLength={120} required autoComplete="off" /></label>
            <label>{method === "bank" ? "银行卡 / 账户" : "支付宝账号"}<input aria-label="收款账号" value={account} disabled={withdrawing} onChange={event => setAccount(event.target.value)} maxLength={200} required autoComplete="off" /></label>
            {method === "bank" && <label>银行名称<input aria-label="银行名称" value={bankName} disabled={withdrawing} onChange={event => setBankName(event.target.value)} maxLength={120} required autoComplete="off" /></label>}
            <div className="input-with-suffix wallet-amount-field">
              <input
                aria-label="提现金额"
                disabled={withdrawing}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={withdrawAmount}
                onChange={(event) => setWithdrawAmount(event.target.value)}
                placeholder="请输入提现金额"
                required
              />
              <span>元</span>
            </div>
            <button
              type="submit"
              className="button button-primary"
              disabled={withdrawing || mode !== "live"}
            >
              {withdrawing ? "提交中…" : "确认提现"}
            </button>
          </form>
        </section>
      )}

      <section className="content-card table-card">
        <div className="card-heading">
          <div>
            <h2>{viewMeta[view].label}明细</h2>
            <p>{viewMeta[view].description}</p>
          </div>
          <span className="live-pill"><i />共 {viewTransactions.length} 条</span>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>视频</th>
                <th>预计可提现（北京时间）</th>
                <th>金额</th>
                <th>操作后总余额</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {viewTransactions.map((item) => (
                <tr key={item.id}>
                  <td className="nowrap-cell">
                    {new Intl.DateTimeFormat("zh-CN", {
                      timeZone: "Asia/Shanghai",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    }).format(item.createdAt)}
                  </td>
                  <td>
                    <StatusBadge
                      label={transactionLabels[item.type] ?? item.type}
                      tone={transactionTone(item.type)}
                    />
                  </td>
                  <td>{item.fileName ?? (item.submissionId ? item.submissionId : "历史记录未关联视频")}</td>
                  <td className="nowrap-cell">{item.settleDueAt === null ? "未记录" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(item.settleDueAt)}</td>
                  <td className={item.amount < 0 ? "money-out" : "money-in"}>
                    <strong>
                      {item.amount < 0 ? "" : "+"}
                      {formatMoney(item.amount)}
                    </strong>
                  </td>
                  <td className="nowrap-cell">{formatMoney(item.balanceAfter)}</td>
                  <td>
                    {item.remark ?? "—"}
                    {item.cycleId ? <small className="row-sub">周期 {item.cycleId}</small> : null}
                  </td>
                </tr>
              ))}
              {viewTransactions.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty-state compact-empty">
                      <BadgeCheck size={20} />
                      <span>{viewMeta[view].label}暂无流水</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
