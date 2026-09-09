export type WalletBalance = {
  ownerId: string;
  ownerName: string;
  totalBalance: number;
  settlingBalance: number;
  nextSettlementAt: number | null;
  availableBalance: number;
  reservedBalance: number;
  withdrawnBalance: number;
  cumulativeWithdrawn: number;
};

export type WalletTransaction = {
  id: string;
  type: "lock" | "settle" | "withdraw";
  amount: number;
  balanceAfter: number;
  cycleId: string | null;
  submissionId: string | null;
  settleDueAt: number | null;
  fileName: string | null;
  remark: string | null;
  createdAt: number;
};

export type WithdrawInput = {
  amount: number;
  idempotencyKey: string;
  method: "alipay" | "bank";
  account: string;
  name: string;
  bankName?: string;
};

/** 流水统计点（日/周/月聚合；withdraw 为负值=流出） */
export type WalletFlowPoint = {
  bucket: string;
  lock: number;
  settle: number;
  withdraw: number;
};

/** 团队流水分布（饼图数据） */
export type WalletTeamStat = {
  teamId: string | null;
  teamName: string;
  lock: number;
  settle: number;
  withdraw: number;
};

export type WithdrawalStatus = "pending" | "processing" | "paid" | "rejected" | "failed";
export type WithdrawalRequest = {
  id: string;
  ownerId: string;
  amount: number;
  status: WithdrawalStatus;
  method: "alipay" | "bank";
  accountMasked: string;
  nameMasked: string;
  batchId: string | null;
  reason: string | null;
  transferReference: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type WithdrawalList = {
  requests: WithdrawalRequest[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export const withdrawalLabels: Record<WithdrawalStatus, string> = {
  pending: "待审核", processing: "人工付款处理中", paid: "已确认付款", rejected: "已拒绝（余额已退回）", failed: "已确认失败（余额已退回）",
};
