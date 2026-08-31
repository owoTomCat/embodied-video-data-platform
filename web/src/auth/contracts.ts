import type { AccountStatus, Role } from "../domain/types";

export type AccountPublic = {
  id: string;
  displayName: string;
  username: string;
  role: Role;
  teamId?: string;
  phone?: string;
  status: AccountStatus;
  updatedAt: number;
};

export type TeamPublic = {
  id: string;
  name: string;
  status: "active" | "disabled";
  unitPricePerMinute: number;
  createdAt: number;
  updatedAt: number;
};

export type CreateTeamInput = Pick<
  TeamPublic,
  "name" | "unitPricePerMinute"
>;

export type UpdateTeamInput = CreateTeamInput &
  Pick<TeamPublic, "status">;

export type KnownAccountAuditAction =
  | "create"
  | "update"
  | "reset_password"
  | "change_password"
  | "enable"
  | "disable"
  | "delete"
  | "local_identity_reconcile"
  | "team_create"
  | "team_update"
  | "team_assign_leader"
  | "quality_review"
  | "ai_quality_rerun"
  | "point_cycle_lock"
  | "point_cycle_adjustment"
  | "delivery_package_create"
  | "asset_quarantine"
  | "asset_release"
  | "ai_quality_prompt_update"
  | "quality_rule_publish"
  | "label_set_update"
  | "point_rule_publish"
  | "scene_pricing_update"
  | "task_auto_normalize"
  | "public_site_snapshot_publish";

export type AccountAuditAction =
  | KnownAccountAuditAction
  | (string & {});

export type AccountAuditLog = {
  id: string;
  actorAccountId: string;
  actorName: string;
  action: AccountAuditAction;
  targetAccountId: string;
  targetName: string;
  summary: string;
  beforeValue?: Record<string, unknown> | null;
  afterValue?: Record<string, unknown> | null;
  createdAt: number;
};

export type AccountAuditPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type AccountAuditListResult = {
  logs: AccountAuditLog[];
  pagination: AccountAuditPagination;
};

export type SearchAccountAuditInput = {
  q?: string;
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export type CreateAccountInput = {
  displayName: string;
  username: string;
  password: string;
  role: Role;
  teamId?: string;
  phone?: string;
};

export type UpdateAccountInput = Omit<CreateAccountInput, "password">;
