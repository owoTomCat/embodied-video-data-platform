import { describe, expect, it } from "vitest";

import { shapeNormalizedOutput } from "../src/tasks/requirement-normalizer.service.js";
import {
  assertTaskCanBeDeleted,
  assertTaskReadyForPublication,
  numericOrNull,
  publicTask,
} from "../src/tasks/tasks.service.js";
import { CollectionTaskEntity } from "../src/database/entities/collection-task.entity.js";

describe("RequirementNormalizerService.shapeNormalizedOutput", () => {
  it("shapes a well-formed model output", () => {
    const shaped = shapeNormalizedOutput({
      scene_description: "家庭厨房场景，出现灶台、厨具与双手操作。",
      requirements: [
        { type: "hard", content: "必须出现双手操作过程", rationale: "用于手部完整度判定" },
        { type: "soft", content: "光线充足，画面清晰" },
      ],
      quality_notes: ["注意油污反光"],
    });
    expect(shaped.scene_description).toContain("厨房");
    expect(shaped.requirements).toHaveLength(2);
    expect(shaped.requirements[0]!).toEqual({
      type: "hard",
      content: "必须出现双手操作过程",
      rationale: "用于手部完整度判定",
    });
    expect(shaped.requirements[1]!.rationale).toBeUndefined();
    expect(shaped.quality_notes).toEqual(["注意油污反光"]);
  });

  it("tolerates malformed fields and drops empty entries", () => {
    const shaped = shapeNormalizedOutput({
      scene_description: 123,
      requirements: [
        { type: "maybe", content: "" },
        { content: "只有内容的条目" },
        "not-an-object",
        { type: "hard", content: " 有效要求 " },
      ],
      quality_notes: ["有效说明", "", 42],
    });
    expect(shaped.scene_description).toBe("（管理员未提供场景描述）");
    expect(shaped.requirements).toEqual([
      { type: "soft", content: "只有内容的条目" },
      { type: "hard", content: "有效要求" },
    ]);
    expect(shaped.quality_notes).toEqual(["有效说明"]);
  });

  it("caps the number of requirement items", () => {
    const shaped = shapeNormalizedOutput({
      scene_description: "x",
      requirements: Array.from({ length: 200 }, (_, index) => ({
        type: "soft",
        content: `要求 ${index}`,
      })),
    });
    expect(shaped.requirements).toHaveLength(100);
  });

  it("returns empty requirement list for a non-object root", () => {
    expect(shapeNormalizedOutput(null).requirements).toEqual([]);
    expect(shapeNormalizedOutput("string").requirements).toEqual([]);
  });
});

describe("numericOrNull", () => {
  it("converts numeric strings and nulls", () => {
    expect(numericOrNull("12.50")).toBe(12.5);
    expect(numericOrNull("0")).toBe(0);
    expect(numericOrNull(null)).toBeNull();
    expect(numericOrNull(undefined)).toBeNull();
    expect(numericOrNull("")).toBeNull();
    expect(numericOrNull("abc")).toBeNull();
  });
});

describe("assertTaskCanBeDeleted", () => {
  it("allows an unused draft task to be deleted", () => {
    expect(() =>
      assertTaskCanBeDeleted({ status: "draft" }, 0),
    ).not.toThrow();
  });

  it("keeps published tasks and linked data traceable", () => {
    expect(() =>
      assertTaskCanBeDeleted({ status: "published" }, 0),
    ).toThrowError(/只有尚未发布的草稿任务可以删除/u);
    expect(() =>
      assertTaskCanBeDeleted({ status: "draft" }, 1),
    ).toThrowError(/已有提交数据/u);
  });
});

describe("assertTaskReadyForPublication", () => {
  it("blocks publishing or resuming unconfirmed requirements", () => {
    expect(() =>
      assertTaskReadyForPublication({
        normalizationStatus: "pending",
        normalizedRequirements: null,
      }),
    ).toThrowError(/先完成 AI 要求规范化并确认/u);
  });

  it("accepts confirmed normalized requirements", () => {
    expect(() =>
      assertTaskReadyForPublication({
        normalizationStatus: "ready",
        normalizedRequirements: {
          scene_description: "通用采集",
          requirements: [{ type: "hard", content: "保持第一人称视角" }],
          quality_notes: [],
        },
      }),
    ).not.toThrow();
  });
});

describe("publicTask serializer", () => {
  it("serializes a draft task with nullable numeric price", () => {
    const task = new CollectionTaskEntity();
    Object.assign(task, {
      id: "TASK-abc123",
      title: "厨房数据采集",
      description: "说明",
      sceneName: "家庭厨房",
      sceneLabelId: null,
      rawRequirements: "原始要求",
      normalizedRequirements: null,
      normalizationStatus: "pending",
      pricePointsPerMinute: null,
      status: "draft",
      revision: 1,
      createdByAccountId: "u1",
      createdByName: "管理员",
      publishedAt: null,
      pausedAt: null,
      closedAt: null,
      createdAt: new Date("2026-08-24T00:00:00Z"),
      updatedAt: new Date("2026-08-24T00:00:00Z"),
    });
    const serialized = publicTask(task);
    expect(serialized.id).toBe("TASK-abc123");
    expect(serialized.pricePointsPerMinute).toBeNull();
    expect(serialized.normalizationStatus).toBe("pending");
    expect(serialized.status).toBe("draft");
    expect(serialized.publishedAt).toBeNull();
    expect(serialized.taskType).toBe("custom");
    expect(serialized.createdAt).toBe(
      new Date("2026-08-24T00:00:00Z").getTime(),
    );
  });

  it("serializes a published task with a numeric price", () => {
    const task = new CollectionTaskEntity();
    Object.assign(task, {
      id: "TASK-def456",
      title: "客厅数据采集",
      description: "",
      sceneName: "家庭客厅",
      sceneLabelId: "SCENE-002",
      rawRequirements: "原始要求",
      normalizedRequirements: {
        scene_description: "客厅场景",
        requirements: [{ type: "hard", content: "必须出现双手" }],
        quality_notes: [],
      },
      normalizationStatus: "ready",
      pricePointsPerMinute: "15.00",
      status: "published",
      revision: 1,
      createdByAccountId: "u1",
      createdByName: "管理员",
      publishedAt: new Date("2026-08-24T08:00:00Z"),
      pausedAt: null,
      closedAt: null,
      createdAt: new Date("2026-08-24T00:00:00Z"),
      updatedAt: new Date("2026-08-24T08:00:00Z"),
    });
    const serialized = publicTask(task);
    expect(serialized.pricePointsPerMinute).toBe(15);
    expect(serialized.status).toBe("published");
    expect(serialized.sceneLabelId).toBe("SCENE-002");
    expect(serialized.taskType).toBe("custom");
    expect(serialized.normalizedRequirements?.requirements).toHaveLength(1);
  });
});
