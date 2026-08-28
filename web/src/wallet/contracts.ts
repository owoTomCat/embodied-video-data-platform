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
