"use client";

import { useEffect, useState } from "react";
import * as accountApi from "../auth/client/accountApi";
import { useIdentity } from "../auth/client/IdentityContext";
import type { Role } from "../domain/types";
import { LoginPage } from "../features/auth/LoginPage";
import { AdminDashboard } from "../features/admin/AdminDashboard";
import { AiQueuePage } from "../features/admin/AiQueuePage";
import { AssetsPage } from "../features/admin/AssetsPage";
import { AuditLogPage } from "../features/admin/AuditLogPage";
import { PublicConfigPage } from "../features/admin/PublicConfigPage";
import { QualityReviewPage } from "../features/admin/QualityReviewPage";
import { RulesPage } from "../features/admin/RulesPage";
import { SettlementPage } from "../features/admin/SettlementPage";
import { SubmissionsAdminPage } from "../features/admin/SubmissionsAdminPage";
import { UsersTeamsPage } from "../features/admin/UsersTeamsPage";
import { WithdrawalsPage } from "../features/admin/WithdrawalsPage";
import { CollectorDashboard } from "../features/collector/CollectorDashboard";
import { EarningsPage } from "../features/collector/EarningsPage";
import { GuidePage } from "../features/collector/GuidePage";
import { AccountProfilePage } from "../features/account/AccountProfilePage";
import { SubmissionDetail } from "../features/collector/SubmissionDetail";
import { SubmissionsPage } from "../features/collector/SubmissionsPage";
import { UploadPage } from "../features/collector/UploadPage";
import { PublicHomePage } from "../features/public/PublicHomePage";
import { TeamDashboard } from "../features/team/TeamDashboard";
import { MembersPage } from "../features/team/MembersPage";
import { ReviewPage } from "../features/team/ReviewPage";
import { TeamAnalyticsPage } from "../features/team/TeamAnalyticsPage";
import { TeamIncomePage } from "../features/team/TeamIncomePage";
import { TeamSubmissionsPage } from "../features/team/TeamSubmissionsPage";
import { DashboardShell } from "../layout/DashboardShell";
import { InteractionProvider } from "../interactions/InteractionContext";
import { roleHome } from "./navigation";

function requiredRole(path: string): Role | null {
  if (path === "/account/profile") return null;
  if (path.startsWith("/collector")) return "collector";
  if (path.startsWith("/team")) return "leader";
  if (path.startsWith("/admin")) return "admin";
  return null;
}

export function PlatformApp({ initialPath }: { initialPath: string }) {
  return (
    <InteractionProvider>
      <PlatformContent initialPath={initialPath} />
    </InteractionProvider>
  );
}

function PlatformContent({ initialPath }: { initialPath: string }) {
  const [path, setPath] = useState(initialPath || "/");

  useEffect(() => {
    if (path !== "/collector/quality") return;
    window.history.replaceState({}, "", "/collector/submissions");
    setPath("/collector/submissions");
  }, [path]);

  function navigate(nextPath: string) {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }

  if (path === "/") return <PublicHomePage navigate={navigate} />;
  if (path === "/login") {
    return (
      <LoginPage
        navigate={navigate}
        onAuthenticated={({ homePath }) => {
          window.location.assign(homePath);
        }}
      />
    );
  }

  return <AuthenticatedPlatformContent initialPath={initialPath} path={path} navigate={navigate} />;
}

function AuthenticatedPlatformContent({
  initialPath,
  path,
  navigate,
}: {
  initialPath: string;
  path: string;
  navigate(path: string): void;
}) {
  const { currentAccount } = useIdentity();

  const gatedRole = requiredRole(path);
  const safePath = gatedRole && gatedRole !== currentAccount.role ? roleHome[currentAccount.role] : path;

  let page = <CollectorDashboard navigate={navigate} />;
  if (safePath === "/account/profile") {
    page = <AccountProfilePage />;
  } else if (safePath === "/collector" && initialPath.startsWith("/admin")) {
    page = <CollectorDashboard navigate={navigate} title />;
  } else if (currentAccount.role === "collector") {
    if (safePath === "/collector/upload") page = <UploadPage />;
    else if (safePath === "/collector/submissions") page = <SubmissionsPage navigate={navigate} />;
    else if (safePath.startsWith("/collector/submissions/")) page = <SubmissionDetail id={safePath.split("/").at(-1) ?? ""} navigate={navigate} />;
    else if (safePath === "/collector/earnings") page = <EarningsPage />;
    else if (safePath === "/collector/guide") page = <GuidePage navigate={navigate} />;
  } else if (currentAccount.role === "leader") {
    if (safePath === "/team/members") page = <MembersPage />;
    else if (safePath === "/team/submissions") page = <TeamSubmissionsPage />;
    else if (safePath === "/team/review") page = <ReviewPage />;
    else if (safePath === "/team/analytics") page = <TeamAnalyticsPage />;
    else if (safePath === "/team/income") page = <TeamIncomePage />;
    else page = <TeamDashboard />;
  } else if (currentAccount.role === "admin") {
    if (safePath === "/admin/submissions") page = <SubmissionsAdminPage />;
    else if (safePath === "/admin/ai") page = <AiQueuePage />;
    else if (safePath === "/admin/review") page = <QualityReviewPage />;
    else if (safePath === "/admin/assets") page = <AssetsPage />;
    else if (safePath === "/admin/people") page = <UsersTeamsPage />;
    else if (safePath === "/admin/rules") page = <RulesPage />;
    else if (safePath === "/admin/settlements") page = <SettlementPage />;
    else if (safePath === "/admin/withdrawals") page = <WithdrawalsPage />;
    else if (safePath === "/admin/public") page = <PublicConfigPage />;
    else if (safePath === "/admin/audit") page = <AuditLogPage />;
    else page = <AdminDashboard />;
  }

  return (
    <DashboardShell
      currentPath={safePath}
      navigate={navigate}
      onLogout={async () => {
        await accountApi.logout();
        window.location.assign("/login");
      }}
    >
      {page}
    </DashboardShell>
  );
}
