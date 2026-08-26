import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { searchAccountAudit } from "../../auth/client/accountApi";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

vi.mock("../../auth/client/accountApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../auth/client/accountApi")>();
  return {
    ...actual,
    searchAccountAudit: vi.fn(),
  };
});

const searchAccountAuditMock = vi.mocked(searchAccountAudit);

function renderPath(path: string, admin = false) {
  window.history.replaceState({}, "", path);
  const account = admin ? accountForRole("admin") : undefined;
  const app = <PlatformApp initialPath={path} />;
  return render(
    account ? (
      <IdentityProvider currentAccount={account} accounts={demoAccounts} teams={[]}>
        {app}
      </IdentityProvider>
    ) : (
      <IdentityProvider
        currentAccount={accountForRole("collector")}
        accounts={demoAccounts}
        teams={[]}
      >
        {app}
      </IdentityProvider>
    ),
  );
}

describe("lightweight feedback interactions", () => {
  it("smoothly scrolls the public process call to action", async () => {
    const user = userEvent.setup();
    renderPath("/");
    const scrollIntoView = vi.fn();
    document.getElementById("process")!.scrollIntoView = scrollIntoView;

    await user.click(screen.getByRole("button", { name: "了解生产流程" }));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("links submissions export to the backend CSV endpoint", async () => {
    renderPath("/admin/submissions", true);

    expect(
      await screen.findByRole("link", { name: "导出当前结果" }),
    ).toHaveAttribute(
      "href",
      "http://localhost:4000/api/v1/submissions/export.csv",
    );
  });

  it("renders session operation logs and disables audit export without a backend", async () => {
    searchAccountAuditMock.mockRejectedValue(new Error("offline"));
    renderPath("/admin/audit", true);

    expect(await screen.findByText("审计日志服务不可用")).toBeVisible();
    expect(screen.getByRole("button", { name: "导出日志" })).toBeDisabled();
  });
});
