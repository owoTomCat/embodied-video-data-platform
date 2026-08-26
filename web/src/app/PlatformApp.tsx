"use client";

import { useEffect, useState } from "react";
import * as accountApi from "../auth/client/accountApi";
import { useIdentity } from "../auth/client/IdentityContext";
import { LoginPage } from "../features/auth/LoginPage";
import { AdminDashboard } from "../features/admin/AdminDashboard";
import { AiQueuePage } from "../features/admin/AiQueuePage";
import { AssetsPage } from "../features/admin/AssetsPage";
import { AuditLogPage } from "../features/admin/AuditLogPage";
import { PublicConfigPage } from "../features/admin/PublicConfigPage";
import { AdminReviewDetailPage } from "../features/admin/AdminReviewDetailPage";
import { QualityReviewPage } from "../features/admin/QualityReviewPage";
import { LabelSetPage } from "../features/admin/LabelSetPage";
import { RulesPage } from "../features/admin/RulesPage";
import { SettlementPage } from "../features/admin/SettlementPage";
import { SubmissionsAdminPage } from "../features/admin/SubmissionsAdminPage";
import { TasksPage } from "../features/admin/TasksPage";
import { UsersTeamsPage } from "../features/admin/UsersTeamsPage";
import { CollectorDashboard } from "../features/collector/CollectorDashboard";
import { EarningsPage } from "../features/collector/EarningsPage";
import { GuidePage } from "../features/collector/GuidePage";
import { TaskHallPage } from "../features/collector/TaskHallPage";
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
import { safeAuthenticatedPath } from "./routes";

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
    function syncPathFromBrowser() {
      setPath(window.location.pathname || "/");
    }

    window.addEventListener("popstate", syncPathFromBrowser);
    return () => window.removeEventListener("popstate", syncPathFromBrowser);
  }, []);

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

  return <AuthenticatedPlatformContent path={path} navigate={navigate} />;
}

function AuthenticatedPlatformContent({
  path,
  navigate,
}: {
  path: string;
  navigate(path: string): void;
}) {
  const { currentAccount } = useIdentity();

  const safePath = safeAuthenticatedPath(path, currentAccount.role);

  useEffect(() => {
    if (safePath === path) return;
    window.history.replaceState({}, "", safePath);
  }, [path, safePath]);

  let page = <CollectorDashboard navigate={navigate} />;
  if (safePath === "/account/profile") {
    page = <AccountProfilePage />;
  } else if (currentAccount.role === "collector") {
    if (safePath === "/collector/tasks") page = <TaskHallPage navigate={navigate} />;
    else if (safePath === "/collector/upload") page = <UploadPage />;
    else if (safePath === "/collector/submissions") page = <SubmissionsPage navigate={navigate} />;
    else if (safePath.startsWith("/collector/submissions/")) page = <SubmissionDetail id={safePath.split("/").at(-1) ?? ""} navigate={navigate} />;
    else if (safePath === "/collector/quality") page = <SubmissionsPage qualityOnly navigate={navigate} />;
    else if (safePath === "/collector/earnings") page = <EarningsPage />;
    else if (safePath === "/collector/guide") page = <GuidePage />;
  } else if (currentAccount.role === "leader") {
    if (safePath === "/team/members") page = <MembersPage />;
    else if (safePath === "/team/submissions") page = <TeamSubmissionsPage />;
    else if (safePath === "/team/review") page = <ReviewPage />;
    else if (safePath === "/team/analytics") page = <TeamAnalyticsPage />;
    else if (safePath === "/team/income") page = <TeamIncomePage />;
    else page = <TeamDashboard navigate={navigate} />;
  } else if (currentAccount.role === "admin") {
    if (safePath === "/admin/submissions") page = <SubmissionsAdminPage navigate={navigate} />;
    else if (safePath.startsWith("/admin/submissions/")) {
      page = (
        <SubmissionDetail
          id={safePath.split("/").at(-1) ?? ""}
          navigate={navigate}
          backPath="/admin/submissions"
          backLabel="返回数据提交"
        />
      );
    }
    else if (safePath === "/admin/ai") page = <AiQueuePage />;
    else if (safePath === "/admin/review") page = <QualityReviewPage navigate={navigate} />;
    else if (safePath.startsWith("/admin/review/")) {
      page = (
        <AdminReviewDetailPage
          id={safePath.split("/").at(-1) ?? ""}
          navigate={navigate}
        />
      );
    }
    else if (safePath === "/admin/assets") page = <AssetsPage />;
    else if (safePath === "/admin/tasks") page = <TasksPage />;
    else if (safePath === "/admin/people") page = <UsersTeamsPage />;
    else if (safePath === "/admin/labels") page = <LabelSetPage />;
    else if (safePath === "/admin/rules") page = <RulesPage />;
    else if (safePath === "/admin/settlements") page = <SettlementPage />;
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
