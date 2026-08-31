"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  CircleDollarSign,
  Clock3,
  Landmark,
  Wallet,
} from "lucide-react";

import { useInteractions } from "../../interactions/InteractionContext";
import { useIdentity } from "../../auth/client/IdentityContext";
import { StatusBadge } from "../../components/StatusBadge";
import {
  getMyWallet,
  withdrawWallet,
  type WalletDetail,
} from "../../wallet/client/walletApi";
import type { WalletTransaction } from "../../wallet/contracts";

type PageMode = "loading" | "live" | "unavailable";

/** 明细视图：结算中 / 可提现 / 累计赚取 */
type DetailView = "settling" | "available" | "earned";

const emptyWallet: WalletDetail = {
  balance: {
    ownerId: "",
    ownerName: "",
    totalBalance: 0,
    settlingBalance: 0,
    availableBalance: 0,
    withdrawnBalance: 0,
    cumulativeWithdrawn: 0,
  },
  transactions: [],
};

function formatMoney(amount: number): string {
  return `${Math.round(amount * 100) / 100} 元`;
}

const transactionLabels: Record<string, string> = {
  lock: "锁定入结算中",
  settle: "结算转可提现",
  withdraw: "提现",
};

function transactionTone(type: string): "success" | "info" | "warning" {
  if (type === "settle") return "success";
  if (type === "lock") return "info";
  return "warning";
}

/** 累计赚取 = 可提现 + 已提现（不含结算中） */
function earnedTotal(balance: WalletDetail["balance"]): number {
  return Math.round((balance.availableBalance + balance.withdrawnBalance) * 100) / 100;
}

const viewMeta: Record<
  DetailView,
  { label: string; description: string; types: WalletTransaction["type"][] }
> = {
  settling: {
    label: "结算中",
    description: "已提交数据、锁定但尚未结算的金额（对应「锁定入结算中」流水）",
    types: ["lock"],
  },
  available: {
    label: "可提现",
    description: "已结算确认、尚未提现的金额（对应「结算转可提现」流水）",
    types: ["settle"],
  },
  earned: {
    label: "累计赚取",
    description: "总共赚到的金额（含已提现，不含结算中）——对应结算与提现流水",
    types: ["settle", "withdraw"],
  },
};

export function EarningsPage() {
  const { notify } = useInteractions();
  const { currentAccount } = useIdentity();
  const [wallet, setWallet] = useState<WalletDetail>(emptyWallet);
  const [mode, setMode] = useState<PageMode>("loading");
  const [view, setView] = useState<DetailView>("settling");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawRemark, setWithdrawRemark] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);

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
    if (withdrawing) return;
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
        `确认提现 ${formatMoney(amount)}？提现后金额转入已提现，累计提现同步累加。`,
      )
    ) {
      return;
    }
    setWithdrawing(true);
    try {
      const next = await withdrawWallet({
        amount,
        remark: withdrawRemark.trim() || undefined,
      });
      setWallet((current) => ({
        ...current,
        balance: next,
        transactions: [
          {
            id: `WT-${Date.now()}`,
            type: "withdraw",
            amount: -amount,
            balanceAfter: next.totalBalance,
            cycleId: null,
            submissionId: null,
            remark: withdrawRemark.trim() || "钱包提现",
            createdAt: Date.now(),
          },
          ...current.transactions,
        ],
      }));
      setWithdrawAmount("");
      setWithdrawRemark("");
      notify("success", "提现成功，已记录累计提现");
    } catch (reason) {
      notify("error", reason instanceof Error ? reason.message : "提现失败，请重试");
    } finally {
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
          <span>点击下方金额卡片可查看对应明细；锁定任务进入「结算中」，3 天后自动结算为「可提现」</span>
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
          <small>提交数据还未结算</small>
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
          <small>含已提现，不含结算中</small>
        </button>
      </div>

      {view === "available" && (
        <section className="content-card wallet-withdraw-card">
          <div className="card-heading">
            <div>
              <h2>提现</h2>
              <p>从可提现余额转出，金额进入已提现并累加累计提现</p>
            </div>
          </div>
          <form className="wallet-withdraw-form" onSubmit={submitWithdraw}>
            <div className="input-with-suffix wallet-amount-field">
              <input
                aria-label="提现金额"
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
            <input
              aria-label="提现备注"
              className="wallet-remark-field"
              value={withdrawRemark}
              onChange={(event) => setWithdrawRemark(event.target.value)}
              placeholder="备注（可选）"
              maxLength={200}
            />
            <button
              type="submit"
              className="button button-primary"
              disabled={withdrawing || mode !== "live"}
            >
              {withdrawing ? "提现中…" : "确认提现"}
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
                  <td colSpan={5}>
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
