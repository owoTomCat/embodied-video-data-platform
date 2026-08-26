import type { Role } from "../domain/types";

const exactPathsByRole: Record<Role, ReadonlySet<string>> = {
  collector: new Set([
    "/collector",
    "/collector/tasks",
    "/collector/upload",
    "/collector/submissions",
    "/collector/quality",
    "/collector/earnings",
    "/collector/guide",
  ]),
  leader: new Set([
    "/team",
    "/team/members",
    "/team/submissions",
    "/team/review",
    "/team/analytics",
    "/team/income",
  ]),
  admin: new Set([
    "/admin",
    "/admin/tasks",
    "/admin/submissions",
    "/admin/assets",
    "/admin/ai",
    "/admin/review",
    "/admin/people",
    "/admin/labels",
    "/admin/rules",
    "/admin/settlements",
    "/admin/public",
    "/admin/audit",
  ]),
};

export const roleHome: Record<Role, string> = {
  collector: "/collector",
  leader: "/team",
  admin: "/admin",
};

function hasSingleDetailSegment(path: string, prefix: string): boolean {
  if (!path.startsWith(prefix)) return false;
  const detail = path.slice(prefix.length);
  return detail.length > 0 && !detail.includes("/");
}

export function requiredRole(path: string): Role | null {
  if (path === "/account/profile") return null;
  if (path === "/admin" || path.startsWith("/admin/")) return "admin";
  if (path === "/team" || path.startsWith("/team/")) return "leader";
  if (path === "/collector" || path.startsWith("/collector/")) {
    return "collector";
  }
  return null;
}

export function isKnownAuthenticatedPath(path: string, role: Role): boolean {
  if (path === "/account/profile") return true;
  if (exactPathsByRole[role].has(path)) return true;
  if (role === "collector") {
    return hasSingleDetailSegment(path, "/collector/submissions/");
  }
  if (role === "admin") {
    return (
      hasSingleDetailSegment(path, "/admin/submissions/") ||
      hasSingleDetailSegment(path, "/admin/review/")
    );
  }
  return false;
}

export function safeAuthenticatedPath(path: string, role: Role): string {
  return isKnownAuthenticatedPath(path, role) ? path : roleHome[role];
}
