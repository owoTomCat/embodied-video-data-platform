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

export type WithdrawalStatus = "pending" | "processing" | "review_pending" | "investigating" | "paid" | "rejected" | "failed";
export type WithdrawalRequest = {
  id: string;
  ownerId: string;
  ownerName: string | null;
  teamName: string | null;
  amount: number;
  status: WithdrawalStatus;
  method: "alipay" | "bank";
  accountMasked: string;
  nameMasked: string;
  createdAt: string;
  updatedAt: string;
};
export type WithdrawalList = {
  requests: WithdrawalRequest[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
export const withdrawalLabels: Record<WithdrawalStatus, string> = {
  pending: "待打款", processing: "待打款", review_pending: "已登记打款（待勾选确认）", investigating: "打款结果待核对", paid: "人工确认已打款", rejected: "已拒绝（余额已退回）", failed: "未打款 / 已退回（余额已释放）",
};

export type PayoutStatus = "unpaid" | "paid" | "all";
export type PayoutRequest = WithdrawalRequest & {
  recipient: WithdrawalRecipient;
  confirmedById: string | null;
  confirmedByName: string | null;
  /** 平台人工勾选时间，不是银行转账时间。 */
  confirmedAt: string | null;
};
export type PayoutList = {
  requests: PayoutRequest[];
  pagination: WithdrawalList["pagination"];
};
export type WithdrawalRecipient = { method: "alipay" | "bank"; name: string; account: string; bankName?: string };
export const shanghaiTime = (value: string) => `${new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（上海）`;
