import { PlatformApp } from "@/src/app/PlatformApp";
import { resolveRouteAccess } from "@/src/auth/server/access";
import {
  getBackendSession,
  listBackendAccounts,
  listBackendTeams,
} from "@/src/auth/server/backendClient";
import { IdentityProvider } from "@/src/auth/client/IdentityContext";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug = [] } = await params;
  const initialPath = slug.length ? `/${slug.join("/")}` : "/";
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("evdp_session")?.value ?? null;

  if (!sessionToken) {
    const access = resolveRouteAccess(initialPath, null);
    if (access.kind === "redirect") {
      redirect(access.location);
    }
    return <PlatformApp initialPath={initialPath} />;
  }

  const session = await getBackendSession(sessionToken);
  const currentAccount = session?.user ?? null;
  const access = resolveRouteAccess(initialPath, currentAccount);
  if (access.kind === "redirect") {
    redirect(access.location);
  }

  if (!currentAccount) {
    return <PlatformApp initialPath={initialPath} />;
  }

  const [accounts, teams] = await Promise.all([
    listBackendAccounts(sessionToken),
    listBackendTeams(sessionToken),
  ]);

  return (
    <IdentityProvider
      currentAccount={currentAccount}
      accounts={accounts}
      teams={teams}
    >
      <PlatformApp initialPath={initialPath} />
    </IdentityProvider>
  );
}
