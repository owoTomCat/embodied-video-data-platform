import {
  isKnownAuthenticatedPath,
  requiredRole,
  roleHome as roleHomeByRole,
} from "../../app/routes";
import type { Role } from "../../domain/types";
import type { AccountPublic } from "../contracts";

export type RouteAccess =
  | { kind: "allow" }
  | { kind: "redirect"; location: string };

export function roleHome(role: Role): string {
  return roleHomeByRole[role];
}

export function resolveRouteAccess(
  path: string,
  account: AccountPublic | null,
): RouteAccess {
  if (path === "/") return { kind: "allow" };

  if (path === "/login") {
    return account
      ? { kind: "redirect", location: roleHome(account.role) }
      : { kind: "allow" };
  }

  if (!account) {
    return { kind: "redirect", location: "/login" };
  }

  const role = requiredRole(path);
  if (role && role !== account.role) {
    return {
      kind: "redirect",
      location: roleHome(account.role),
    };
  }

  if (!isKnownAuthenticatedPath(path, account.role)) {
    return {
      kind: "redirect",
      location: roleHome(account.role),
    };
  }

  return { kind: "allow" };
}
