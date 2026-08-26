import { describe, expect, it } from "vitest";
import { makeAccountPublic } from "../testFactories";
import { resolveRouteAccess } from "./access";

describe("server route access", () => {
  it("allows public pages without an account", () => {
    expect(resolveRouteAccess("/", null)).toEqual({ kind: "allow" });
    expect(resolveRouteAccess("/login", null)).toEqual({
      kind: "allow",
    });
  });

  it("redirects anonymous dashboard requests to login", () => {
    expect(resolveRouteAccess("/admin", null)).toEqual({
      kind: "redirect",
      location: "/login",
    });
    expect(resolveRouteAccess("/unknown", null)).toEqual({
      kind: "redirect",
      location: "/login",
    });
  });

  it("redirects authenticated users away from login", () => {
    expect(
      resolveRouteAccess(
        "/login",
        makeAccountPublic({ role: "leader" }),
      ),
    ).toEqual({
      kind: "redirect",
      location: "/team",
    });
  });

  it("allows only the matching role workspace", () => {
    const collector = makeAccountPublic({ role: "collector" });
    expect(
      resolveRouteAccess("/collector/submissions", collector),
    ).toEqual({ kind: "allow" });
    expect(resolveRouteAccess("/admin", collector)).toEqual({
      kind: "redirect",
      location: "/collector",
    });
  });

  it("redirects unknown authenticated routes to the current role home", () => {
    expect(
      resolveRouteAccess(
        "/admin/not-a-real-page",
        makeAccountPublic({ role: "admin" }),
      ),
    ).toEqual({ kind: "redirect", location: "/admin" });
    expect(
      resolveRouteAccess(
        "/collector/submissions/SUB-1/extra",
        makeAccountPublic({ role: "collector" }),
      ),
    ).toEqual({ kind: "redirect", location: "/collector" });
  });

  it.each(["admin", "leader", "collector"] as const)(
    "allows an authenticated %s to open the role-neutral account profile",
    (role) => {
      expect(
        resolveRouteAccess("/account/profile", makeAccountPublic({ role })),
      ).toEqual({ kind: "allow" });
    },
  );
});
