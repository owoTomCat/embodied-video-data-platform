"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Landmark, Wallet } from "lucide-react";

import { Modal } from "../../components/Modal";
import { StatusBadge } from "../../components/StatusBadge";
import { listMemberTransactions } from "../../wallet/client/walletApi";
import type { WalletBalance, WalletTransaction } from "../../wallet/contracts";

function formatMoney(amount: number): string {
  return `${Math.round(amount * 100) / 100} 元`;
}

function earnedTotal(balance: WalletBalance): number {
  return (
    Math.round((balance.availableBalance + balance.withdrawnBalance) * 100) /
    100
  );
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

export function WalletDetailModal({
  member,
  onClose,
  returnFocusRef,
}: {
  member: WalletBalance;
  onClose(): void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    listMemberTransactions(member.ownerId)
      .then((rows) => {
        if (!active) return;
        setTransactions(rows);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setTransactions([]);
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, [member.ownerId]);

  const withdrawals = transactions.filter((t) => t.type === "withdraw");

  return (
    <Modal
      open
      title={`${member.ownerName} · 钱包明细`}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
    >
      <div className="wallet-detail-modal">
        <div className="wallet-detail-summary">
          <span><Wallet size={15} />可提现 <strong>{formatMoney(member.availableBalance)}</strong></span>
          <span><BadgeCheck size={15} />累计赚取 <strong>{formatMoney(earnedTotal(member))}</strong></span>
          <span><Landmark size={15} />已提现 <strong>{formatMoney(member.withdrawnBalance)}</strong></span>
          <span>结算中 <strong>{formatMoney(member.settlingBalance)}</strong></span>
        </div>

        <h3>提现记录（{withdrawals.length} 条）</h3>
        {mode === "unavailable" ? (
          <p className="form-message">流水读取失败，请稍后重试。</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>时间</th><th>类型</th><th>金额</th><th>操作后总余额</th><th>说明</th></tr></thead>
              <tbody>
                {withdrawals.map((t) => (
                  <tr key={t.id}>
                    <td className="nowrap-cell">
                      {new Intl.DateTimeFormat("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        hour12: false,
                      }).format(t.createdAt)}
                    </td>
                    <td><StatusBadge label={transactionLabels[t.type] ?? t.type} tone={transactionTone(t.type)} /></td>
                    <td className="money-out"><strong>{formatMoney(t.amount)}</strong></td>
                    <td className="nowrap-cell">{formatMoney(t.balanceAfter)}</td>
                    <td>{t.remark ?? "—"}</td>
                  </tr>
                ))}
                {withdrawals.length === 0 && (
                  <tr><td colSpan={5}><div className="empty-state compact-empty"><Landmark size={18} /><span>暂无提现记录</span></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
