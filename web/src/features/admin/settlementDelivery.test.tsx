import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { DemoStoreProvider } from "../../data/DemoStoreContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";

function renderAdmin(path: string) {
  window.history.replaceState({}, "", path);
  const admin = accountForRole("admin");
  return render(
    <IdentityProvider currentAccount={admin} accounts={demoAccounts} teams={[]}>
      <DemoStoreProvider currentAccount={admin} accounts={demoAccounts}>
        <PlatformApp initialPath={path} />
      </DemoStoreProvider>
    </IdentityProvider>,
  );
}

describe("settlement actions", () => {
  it("previews and locks the eligible settlement records", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/settlements");

    await user.click(
      await screen.findByRole("button", { name: "生成演示批次" }),
    );
    const dialog = screen.getByRole("dialog", { name: "确认生成结算批次" });
    expect(within(dialog).getByText("4 条")).toBeVisible();
    expect(within(dialog).getByText("11.27 分钟")).toBeVisible();
    expect(within(dialog).getByText("¥119.05")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "确认生成" }));

    expect(screen.getByText("结算批次已生成并锁定")).toBeVisible();
    const firstBatch = screen.getAllByRole("row")[1];
    expect(within(firstBatch).getByText("4 条")).toBeVisible();
    expect(within(firstBatch).getByText("已锁定")).toBeVisible();
  });

  it("disables confirmation when no settlement data remains", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/settlements");

    await user.click(
      await screen.findByRole("button", { name: "生成演示批次" }),
    );
    await user.click(screen.getByRole("button", { name: "确认生成" }));
    await user.click(screen.getByRole("button", { name: "生成演示批次" }));

    expect(screen.getByText("当前没有可结算数据")).toBeVisible();
    expect(screen.getByRole("button", { name: "确认生成" })).toBeDisabled();
  });
});

describe("delivery package actions", () => {
  it("creates a session delivery package and updates the monthly metric", async () => {
    const user = userEvent.setup();
    renderAdmin("/admin/assets");

    await user.click(
      await screen.findByRole("button", { name: "创建交付包" }),
    );
    const dialog = screen.getByRole("dialog", { name: "创建交付包" });
    expect(within(dialog).getByText("2 条可交付资产")).toBeVisible();
    await user.type(screen.getByLabelText("交付包名称"), "八月家庭任务包");
    await user.click(screen.getByRole("button", { name: "确认创建" }));

    expect(screen.getByText("交付包已创建")).toBeVisible();
    expect(screen.getByText("19")).toBeVisible();
  });
});
