export type WalletBalance = {
  ownerId: string;
  ownerName: string;
  totalBalance: number;
  settlingBalance: number;
  availableBalance: number;
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
  remark: string | null;
  createdAt: number;
};

export type WithdrawInput = {
  amount: number;
  remark?: string;
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
