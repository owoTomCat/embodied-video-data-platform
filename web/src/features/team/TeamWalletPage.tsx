"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Landmark, Users } from "lucide-react";

import { StatusBadge } from "../../components/StatusBadge";
import {
  listMemberTransactions,
  listWallets,
} from "../../wallet/client/walletApi";
import type { WalletBalance, WalletTransaction } from "../../wallet/contracts";

type PageMode = "loading" | "live" | "unavailable";

function formatMoney(amount: number): string {
  return `${Math.round(amount * 100) / 100} 元`;
}

/** 累计赚取 = 可提现 + 已提现（不含结算中） */
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

export function TeamWalletPage() {
  const [mode, setMode] = useState<PageMode>("loading");
  const [wallets, setWallets] = useState<WalletBalance[]>([]);
  const [expandedOwner, setExpandedOwner] = useState<string>();
  const [transactions, setTransactions] = useState<Record<string, WalletTransaction[]>>({});
  const [loadingTransactions, setLoadingTransactions] = useState<string>();

  useEffect(() => {
    let active = true;
    listWallets()
      .then((rows) => {
        if (!active) return;
        setWallets(rows);
        setMode("live");
      })
      .catch(() => {
        if (!active) return;
        setWallets([]);
        setMode("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  const totalAvailable = useMemo(
    () => wallets.reduce((sum, item) => sum + item.availableBalance, 0),
    [wallets],
  );
  const totalEarned = useMemo(
    () => wallets.reduce((sum, item) => sum + earnedTotal(item), 0),
    [wallets],
  );

  async function toggleMember(ownerId: string) {
    if (expandedOwner === ownerId) {
      setExpandedOwner(undefined);
      return;
    }
    setExpandedOwner(ownerId);
    if (transactions[ownerId] === undefined) {
      setLoadingTransactions(ownerId);
      try {
        const rows = await listMemberTransactions(ownerId);
        setTransactions((current) => ({ ...current, [ownerId]: rows }));
      } catch {
        setTransactions((current) => ({ ...current, [ownerId]: [] }));
      } finally {
        setLoadingTransactions(undefined);
      }
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <div>
          <p className="page-kicker">本队成员钱包（只读）</p>
          <h1>团队钱包</h1>
          <span>查看本队成员的结算中 / 可提现 / 累计赚取与提现记录；提现由成员本人操作</span>
        </div>
        <span className="live-pill">
          <i />
          {mode === "live" ? "已同步" : mode === "loading" ? "正在读取" : "暂不可用"}
        </span>
      </div>

      <div className="metric-grid">
        <div className="content-card team-wallet-metric">
          <span className="label-set-summary-icon"><Users size={18} /></span>
          <div><strong>{wallets.length} 名成员</strong><small>本队已开通钱包</small></div>
        </div>
        <div className="content-card team-wallet-metric">
          <span className="label-set-summary-icon"><Landmark size={18} /></span>
          <div><strong>{formatMoney(totalAvailable)}</strong><small>全队可提现合计</small></div>
        </div>
        <div className="content-card team-wallet-metric">
          <span className="label-set-summary-icon"><BadgeCheck size={18} /></span>
          <div><strong>{formatMoney(totalEarned)}</strong><small>全队累计赚取合计</small></div>
        </div>
      </div>

      {mode === "unavailable" && (
        <p className="form-message">钱包服务暂不可用，请稍后重试。</p>
      )}

      <section className="content-card table-card">
        <div className="card-heading">
          <div><h2>成员钱包</h2><p>点击成员可展开查看其提现记录</p></div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>成员</th>
                <th>结算中</th>
                <th>可提现</th>
                <th>累计赚取</th>
                <th>已提现</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {wallets.map((item) => (
                <WalletMemberRow
                  key={item.ownerId}
                  item={item}
                  expanded={expandedOwner === item.ownerId}
                  loading={loadingTransactions === item.ownerId}
                  transactions={transactions[item.ownerId] ?? []}
                  onToggle={() => void toggleMember(item.ownerId)}
                />
              ))}
              {wallets.length === 0 && (
                <tr><td colSpan={6}><div className="empty-state compact-empty"><Users size={20} /><span>本队暂无成员钱包数据</span></div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function WalletMemberRow({
  item,
  expanded,
  loading,
  transactions,
  onToggle,
}: {
  item: WalletBalance;
  expanded: boolean;
  loading: boolean;
  transactions: WalletTransaction[];
  onToggle(): void;
}) {
  return (
    <>
      <tr>
        <td><strong>{item.ownerName}</strong><small className="field-help">{item.ownerId}</small></td>
        <td className="nowrap-cell">{formatMoney(item.settlingBalance)}</td>
        <td className="nowrap-cell"><strong>{formatMoney(item.availableBalance)}</strong></td>
        <td className="nowrap-cell">{formatMoney(earnedTotal(item))}</td>
        <td className="nowrap-cell">{formatMoney(item.withdrawnBalance)}</td>
        <td>
          <button className="table-action" onClick={onToggle}>
            {loading ? "读取中…" : expanded ? "收起提现记录" : "查看提现记录"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="wallet-detail-row">
          <td colSpan={6}>
            <div className="wallet-detail-inner">
              <h3>提现记录（{transactions.filter((t) => t.type === "withdraw").length} 条）</h3>
              {transactions.filter((t) => t.type === "withdraw").length > 0 ? (
                <table className="data-table">
                  <thead><tr><th>时间</th><th>类型</th><th>金额</th><th>操作后总余额</th><th>说明</th></tr></thead>
                  <tbody>
                    {transactions
                      .filter((t) => t.type === "withdraw")
                      .map((t) => (
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
                  </tbody>
                </table>
              ) : (
                <p className="form-message">该成员暂无提现记录</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
