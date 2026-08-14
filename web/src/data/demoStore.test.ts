import { describe, expect, it } from "vitest";
import { createDemoStore, demoSeed } from "./demoStore";

describe("demo account identities", () => {
  it("uses the approved generic names and pinyin usernames", () => {
    expect(
      demoSeed.users.map(({ id, name, account }) => ({
        id,
        name,
        account,
      })),
    ).toEqual([
      {
        id: "U-COL-01",
        name: "测试人员1",
        account: "ceshirenyuan1",
      },
      {
        id: "U-LEAD-01",
        name: "团长1",
        account: "tuanzhang1",
      },
      { id: "U-ADMIN-01", name: "管理员", account: "admin" },
      {
        id: "U-COL-02",
        name: "测试人员2",
        account: "ceshirenyuan2",
      },
      {
        id: "U-COL-03",
        name: "测试人员3",
        account: "ceshirenyuan3",
      },
      {
        id: "U-COL-04",
        name: "测试人员4",
        account: "ceshirenyuan4",
      },
      {
        id: "U-COL-05",
        name: "测试人员5",
        account: "ceshirenyuan5",
      },
      {
        id: "U-LEAD-02",
        name: "团长2",
        account: "tuanzhang2",
      },
    ]);
    expect(
      demoSeed.submissions.find(({ id }) => id === "SUB-001")?.ownerName,
    ).toBe("测试人员1");
  });
});

describe("demo store permissions", () => {
  it("prevents a leader from adjusting another team submission", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("leader");

    expect(() =>
      store.adjustQuality("SUB-OTHER-01", 82, "复核通过"),
    ).toThrow("无权调整该团队数据");
  });

  it("allows an administrator to adjust any unsettled submission", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");
    store.adjustQuality("SUB-OTHER-01", 82, "管理员复核");

    expect(store.getSubmission("SUB-OTHER-01").finalScore).toBe(82);
  });
});

describe("quality review workflow", () => {
  it("preserves the AI score while saving the adjusted final score", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");
    store.adjustQuality("SUB-001", 88, "画面稳定，调整评分");

    const updated = store.getSubmission("SUB-001");
    expect(updated.aiScore).toBe(76);
    expect(updated.finalScore).toBe(88);
    expect(updated.audit.at(-1)?.reason).toBe("画面稳定，调整评分");
  });

  it("rejects quality changes after settlement", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    expect(() =>
      store.adjustQuality("SUB-SETTLED-01", 90, "修改"),
    ).toThrow("已结算数据不可修改");
  });

  it("requires a non-empty adjustment reason", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    expect(() => store.adjustQuality("SUB-001", 88, "  ")).toThrow(
      "请填写调整原因",
    );
  });
});

describe("upload and withdrawal workflows", () => {
  it("creates one queued submission for each uploaded file", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("collector");
    const before = store.getState().submissions.length;

    store.addUploads([
      new File(["a"], "kitchen.mov", { type: "video/quicktime" }),
      new File(["b"], "cleaning.mp4", { type: "video/mp4" }),
    ]);

    const uploads = store.getState().submissions.slice(0, 2);
    expect(store.getState().submissions).toHaveLength(before + 2);
    expect(uploads.map((item) => item.fileName)).toEqual([
      "kitchen.mov",
      "cleaning.mp4",
    ]);
    expect(uploads.every((item) => item.processingStatus === "queued")).toBe(
      true,
    );
  });

  it("freezes the amount when a collector requests a valid withdrawal", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("collector");
    store.requestWithdrawal(200);

    expect(store.getState().wallet.available).toBe(1286.5);
    expect(store.getState().wallet.frozen).toBe(200);
    expect(store.getState().withdrawals[0].status).toBe("pending");
  });

  it("rejects a withdrawal below the configured minimum", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("collector");

    expect(() => store.requestWithdrawal(80)).toThrow(
      "最低提现金额为 ¥100",
    );
  });

  it("lets an administrator approve a pending withdrawal", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");
    store.reviewWithdrawal("WD-001", "approved");

    expect(store.getState().withdrawals[0].status).toBe("approved");
  });

  it("prevents collectors from reviewing withdrawals", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("collector");

    expect(() => store.reviewWithdrawal("WD-001", "approved")).toThrow(
      "仅管理员可审核提现",
    );
  });

  it("notifies subscribers after a state change and supports unsubscribe", () => {
    const store = createDemoStore(demoSeed);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.loginAs("leader");
    unsubscribe();
    store.loginAs("admin");

    expect(notifications).toBe(1);
  });
});

describe("team member and user management workflows", () => {
  it("synchronizes a persistent account into its assigned team", () => {
    const store = createDemoStore(demoSeed);

    store.syncAccount({
      id: "U-COL-NEW",
      name: "测试人员6",
      account: "ceshirenyuan6",
      role: "collector",
      teamId: "TEAM-02",
      avatar: "测",
      phone: "未设置",
      status: "active",
      updatedAt: 1_722_708_100_000,
    });

    expect(
      store.getState().users.find((user) => user.id === "U-COL-NEW"),
    ).toMatchObject({
      account: "ceshirenyuan6",
      teamId: "TEAM-02",
    });
    expect(store.getState().teams[1].memberIds).toContain("U-COL-NEW");
  });

  it("invites a collector into the leader's own team", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("leader");

    const created = store.inviteMember({
      name: "苏禾",
      phone: "13812345678",
    });

    expect(created.role).toBe("collector");
    expect(created.teamId).toBe("TEAM-01");
    expect(store.getState().teams[0].memberIds).toContain(created.id);
  });

  it("rejects duplicate invitation phones", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("leader");
    store.inviteMember({ name: "苏禾", phone: "13812345678" });

    expect(() =>
      store.inviteMember({ name: "苏禾二", phone: "13812345678" }),
    ).toThrow("该手机号已存在");
  });

  it("rejects invalid invitation fields and non-leader invitations", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("leader");

    expect(() =>
      store.inviteMember({ name: " ", phone: "13812345678" }),
    ).toThrow("请填写成员姓名");
    expect(() =>
      store.inviteMember({ name: "苏禾", phone: "123" }),
    ).toThrow("请输入正确的手机号");

    store.loginAs("collector");
    expect(() =>
      store.inviteMember({ name: "苏禾", phone: "13812345678" }),
    ).toThrow("仅团长可邀请成员");
  });

  it("adds a user and rejects duplicate login accounts", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    const created = store.addUser({
      name: "沈舟",
      account: "shenzhou",
      role: "collector",
      teamId: "TEAM-01",
    });

    expect(created.teamId).toBe("TEAM-01");
    expect(store.getState().teams[0].memberIds).toContain(created.id);
    expect(() =>
      store.addUser({
        name: "重复账号",
        account: "ceshirenyuan1",
        role: "collector",
        teamId: "TEAM-01",
      }),
    ).toThrow("登录账号已存在");
  });

  it("moves a collector between teams", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    const updated = store.updateUser({
      userId: "U-COL-01",
      role: "collector",
      teamId: "TEAM-02",
    });

    expect(updated.teamId).toBe("TEAM-02");
    expect(store.getState().teams[0].memberIds).not.toContain("U-COL-01");
    expect(store.getState().teams[1].memberIds).toContain("U-COL-01");
  });

  it("replaces a team leader without leaving two leaders", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    const replacement = store.updateUser({
      userId: "U-COL-01",
      role: "leader",
      teamId: "TEAM-01",
    });

    expect(replacement.role).toBe("leader");
    expect(store.getState().teams[0].leaderId).toBe("U-COL-01");
    expect(
      store.getState().users.find((user) => user.id === "U-LEAD-01")?.role,
    ).toBe("collector");
    expect(store.getState().teams[0].memberIds).toContain("U-LEAD-01");
    expect(store.getState().teams[0].memberIds).not.toContain("U-COL-01");
  });

  it("requires a replacement before demoting the current leader", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    expect(() =>
      store.updateUser({
        userId: "U-LEAD-01",
        role: "collector",
        teamId: "TEAM-01",
      }),
    ).toThrow("请先为团队指定新的团长");
  });
});

describe("administrator rule, settlement, and delivery workflows", () => {
  it("publishes the active rule and records an operation log", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    const created = store.createRuleVersion({
      version: "RULE-2026-09",
      passThreshold: 65,
      description: "九月质量规则",
    });

    expect(created).toEqual({
      version: "RULE-2026-09",
      passThreshold: 65,
      description: "九月质量规则",
    });
    expect(store.getState().rule).toEqual(created);
    expect(store.getState().operationLogs[0].action).toBe("发布质量规则");
  });

  it("rejects invalid rule values", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    expect(() =>
      store.createRuleVersion({
        version: " ",
        passThreshold: 65,
        description: "说明",
      }),
    ).toThrow("请填写版本名称");
    expect(() =>
      store.createRuleVersion({
        version: "RULE-2026-09",
        passThreshold: 60.5,
        description: "说明",
      }),
    ).toThrow("通过阈值必须是 0 到 100 的整数");
    expect(() =>
      store.createRuleVersion({
        version: "RULE-2026-09",
        passThreshold: 65,
        description: " ",
      }),
    ).toThrow("请填写规则说明");
  });

  it("updates an existing label and rejects an empty name", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    const updated = store.updateLabel({
      id: "SCENE-001",
      name: "家庭烹饪",
      enabled: true,
    });

    expect(updated.name).toBe("家庭烹饪");
    expect(store.getState().labels[0].name).toBe("家庭烹饪");
    expect(() =>
      store.updateLabel({ id: "SCENE-001", name: " ", enabled: true }),
    ).toThrow("请填写标签名称");
  });

  it("locks only completed, passed, unsettled submissions", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    const batch = store.createSettlementBatch();

    expect(batch.submissionCount).toBe(4);
    expect(batch.effectiveMinutes).toBe(11.27);
    expect(batch.amount).toBe(119.05);
    expect(batch.status).toBe("locked");
    expect(store.getState().settlements[0]).toEqual(batch);
    expect(store.getSubmission("SUB-001").settlementStatus).toBe("settled");
    expect(store.getSubmission("SUB-003").settlementStatus).toBe("unsettled");
    expect(store.getSubmission("SUB-004").settlementStatus).toBe("unsettled");
    expect(store.getState().operationLogs[0].action).toBe("生成结算批次");
  });

  it("rejects a second settlement when nothing remains eligible", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");
    store.createSettlementBatch();

    expect(() => store.createSettlementBatch()).toThrow("当前没有可结算数据");
  });

  it("creates a delivery package from settled passed assets", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("admin");

    const created = store.createDeliveryPackage({
      name: "八月家庭任务包",
    });

    expect(created.name).toBe("八月家庭任务包");
    expect(created.assetCount).toBe(2);
    expect(created.status).toBe("ready");
    expect(store.getState().deliveryPackages).toEqual([created]);
  });

  it("rejects delivery when there are no eligible assets", () => {
    const seed = structuredClone(demoSeed);
    seed.submissions = seed.submissions.map((submission) => ({
      ...submission,
      settlementStatus: "unsettled",
    }));
    const store = createDemoStore(seed);
    store.loginAs("admin");

    expect(() =>
      store.createDeliveryPackage({ name: "无资产交付包" }),
    ).toThrow("当前没有可交付资产");
  });

  it("rejects configuration commands from non-administrators", () => {
    const store = createDemoStore(demoSeed);
    store.loginAs("leader");

    expect(() =>
      store.createRuleVersion({
        version: "RULE-2026-09",
        passThreshold: 65,
        description: "九月质量规则",
      }),
    ).toThrow("仅管理员可执行该操作");
  });
});
