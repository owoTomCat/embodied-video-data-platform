"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { AccountPublic, TeamPublic } from "../auth/contracts";

/**
 * 客户端身份快照。平台已移除演示兜底数据，所有业务数据一律来自后端接口；
 * 这里只保留登录账号与团队（与 IdentityContext 一致），并提供派生当前团队。
 */
export type DemoStoreValue = {
  currentAccount: AccountPublic;
  accounts: AccountPublic[];
  teams: TeamPublic[];
  currentTeam?: TeamPublic;
};

const DemoStoreContext = createContext<DemoStoreValue | null>(null);

export function DemoStoreProvider({
  children,
  currentAccount,
  accounts = [],
  teams = [],
}: {
  children: ReactNode;
  currentAccount: AccountPublic;
  accounts?: AccountPublic[];
  teams?: TeamPublic[];
}) {
  const currentTeam = teams.find((team) => team.id === currentAccount.teamId);
  return (
    <DemoStoreContext.Provider
      value={{ currentAccount, accounts, teams, currentTeam }}
    >
      {children}
    </DemoStoreContext.Provider>
  );
}

export function useDemoStore(): DemoStoreValue {
  const value = useContext(DemoStoreContext);
  if (!value) {
    throw new Error("useDemoStore must be used inside DemoStoreProvider");
  }
  return value;
}
