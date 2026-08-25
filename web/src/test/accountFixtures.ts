import type { AccountPublic } from "../auth/contracts";
import type { Role } from "../domain/types";

/**
 * 测试夹具：固定的账号快照，与旧演示数据的账号/团队结构保持一致，
 * 保证依赖这些账号的测试稳定。生产代码已移除演示数据，这里只是测试夹具。
 */
export const demoAccounts: AccountPublic[] = [
  {
    id: "U-COL-01",
    displayName: "测试人员1",
    username: "ceshirenyuan1",
    role: "collector",
    teamId: "TEAM-01",
    status: "active",
    updatedAt: 1_722_708_000_000,
  },
  {
    id: "U-LEAD-01",
    displayName: "团长1",
    username: "tuanzhang1",
    role: "leader",
    teamId: "TEAM-01",
    status: "active",
    updatedAt: 1_722_708_000_000,
  },
  {
    id: "U-ADMIN-01",
    displayName: "管理员",
    username: "admin",
    role: "admin",
    status: "active",
    updatedAt: 1_722_708_000_000,
  },
  {
    id: "U-COL-02",
    displayName: "测试人员2",
    username: "ceshirenyuan2",
    role: "collector",
    teamId: "TEAM-02",
    status: "active",
    updatedAt: 1_722_708_000_000,
  },
  {
    id: "U-COL-03",
    displayName: "测试人员3",
    username: "ceshirenyuan3",
    role: "collector",
    teamId: "TEAM-01",
    status: "active",
    updatedAt: 1_722_708_000_000,
  },
  {
    id: "U-COL-04",
    displayName: "测试人员4",
    username: "ceshirenyuan4",
    role: "collector",
    teamId: "TEAM-01",
    status: "active",
    updatedAt: 1_722_708_000_000,
  },
  {
    id: "U-COL-05",
    displayName: "测试人员5",
    username: "ceshirenyuan5",
    role: "collector",
    teamId: "TEAM-01",
    status: "active",
    updatedAt: 1_722_708_000_000,
  },
  {
    id: "U-LEAD-02",
    displayName: "团长2",
    username: "tuanzhang2",
    role: "leader",
    teamId: "TEAM-02",
    status: "active",
    updatedAt: 1_722_708_000_000,
  },
];

export function accountForRole(role: Role): AccountPublic {
  const account = demoAccounts.find((candidate) => candidate.role === role);
  if (!account) {
    throw new Error(`Missing ${role} test account`);
  }
  return account;
}
