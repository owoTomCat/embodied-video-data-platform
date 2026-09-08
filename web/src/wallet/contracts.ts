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
  assigneeId: string | null;
  assigneeName: string | null;
  assignedAt: string | null;
  registeredById: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewMode: "independent" | "single" | "legacy" | null;
  latestRegistrationId: string | null;
  revision: number;
  overdue: boolean;
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
  pending: "待领取", processing: "人工付款处理中", review_pending: "已登记，等待复核", investigating: "结果待查（资金预留）", paid: "人工确认付款", rejected: "已拒绝（余额已退回）", failed: "已确认未付 / 退回（余额已释放）",
};

export type WithdrawalEvidence = {
  id: string; originalFileName: string; contentType: string; sizeBytes: number;
  sha256: string; uploadedById: string; createdAt: string;
};
export type WithdrawalRegistration = {
  id: string; registeredById: string; registeredByName: string;
  transferReference: string; paidAt: string; evidenceIds: string[];
  note: string | null; createdAt: string;
};
export type WithdrawalDetail = {
  request: WithdrawalRequest;
  registrations: WithdrawalRegistration[];
  evidence: WithdrawalEvidence[];
  timeline: { id: string; action: string; actorId: string | null; actorName: string; createdAt: string; reason: string | null; registrationId: string | null; evidenceIds: string[]; assignment: { fromId: string | null; fromName: string | null; toId: string; toName: string | null } | null }[];
  admins: { id: string; displayName: string }[];
  singleConfirmationAllowed: boolean;
};
export type WithdrawalRecipient = { method: "alipay" | "bank"; name: string; account: string; bankName?: string };
export type WithdrawalSummary = Record<"pending" | "processing" | "reviewPending" | "investigating" | "overdue", { count: number; amount: number }>;
export const shanghaiTime = (value: string) => `${new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（上海）`;
