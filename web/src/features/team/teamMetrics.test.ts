import { describe, expect, it } from "vitest";
import type { Submission } from "../../domain/types";
import {
  contributionMetrics,
  dailyContributions,
  sceneContributions,
  submissionsSince,
  taskContributions,
} from "./teamMetrics";

function submission(
  id: string,
  createdAt: string,
  qualityStatus: Submission["qualityStatus"],
  score: number,
  ownerId = "U-01",
  scene = "厨房",
): Submission {
  return {
    id,
    fileName: `${id}.mp4`,
    ownerId,
    ownerName: ownerId,
    teamId: "TEAM-01",
    teamName: "测试团队",
    scene,
    action: "测试",
    object: "测试",
    durationSeconds: 120,
    invalidSeconds: 20,
    sizeMb: 1,
    resolution: "1920×1080",
    processingStatus: qualityStatus === "pending" ? "processing" : "completed",
    qualityStatus,
    aiScore: score,
    finalScore: score,
    settlementStatus: "unsettled",
    createdAt,
    tags: [],
    issues: [],
    invalidIssues: [],
    audit: [],
  };
}

describe("team metrics", () => {
  it("calculates uploads, effective duration and reviewed pass rate", () => {
    const metrics = contributionMetrics([
      submission("A", "2026-08-13 09:00", "passed", 88),
      submission("B", "2026-08-13 10:00", "failed", 40),
      submission("C", "2026-08-13 11:00", "pending", 0),
    ]);
    expect(metrics).toMatchObject({
      uploads: 3,
      totalSeconds: 360,
      effectiveSeconds: 300,
      reviewed: 2,
      passed: 1,
      failed: 1,
      passRate: 50,
      averageScore: 64,
      highScoreEffectiveSeconds: 100,
    });
  });

  it("uses Shanghai natural days for current windows and daily charts", () => {
    const now = Date.parse("2026-08-13T12:00:00+08:00");
    const items = [
      submission("A", "2026-08-13 00:01", "passed", 88),
      submission("B", "2026-08-12 23:59", "passed", 70),
      submission("C", "2026-08-06 23:59", "passed", 70),
    ];
    expect(submissionsSince(items, 1, now).map((item) => item.id)).toEqual(["A"]);
    expect(dailyContributions(items, 2, now).map((item) => item.uploads)).toEqual([1, 1]);
  });

  it("groups passed effective duration by real scene", () => {
    const scenes = sceneContributions([
      submission("A", "2026-08-13 09:00", "passed", 88, "U-01", "厨房"),
      submission("B", "2026-08-13 10:00", "passed", 70, "U-02", "工作台"),
      submission("C", "2026-08-13 11:00", "failed", 40, "U-03", "仓库"),
    ]);
    expect(scenes.map((item) => item.scene)).toEqual(["厨房", "工作台"]);
    expect(scenes[0]?.percentage).toBe(50);
  });

  it("groups submissions by task dimension with pass rate", () => {
    const withTask = (
      id: string,
      status: Submission["qualityStatus"],
      score: number,
      taskId: string,
      title: string,
      taskType: "generic" | "preset" | "custom",
    ): Submission => ({
      ...submission(id, "2026-08-13 09:00", status, score),
      task: { taskId, title, revision: 1, sceneName: "家庭-厨房", taskType, pricePointsPerMinute: 12 },
    });
    const tasks = taskContributions([
      withTask("A", "passed", 88, "TASK-1", "厨房任务", "preset"),
      withTask("B", "failed", 40, "TASK-1", "厨房任务", "preset"),
      withTask("C", "passed", 76, "TASK-2", "通用采集", "generic"),
      submission("D", "2026-08-13 09:00", "passed", 88),
    ]);
    expect(tasks).toHaveLength(3);
    const kitchen = tasks.find((task) => task.taskId === "TASK-1");
    expect(kitchen).toMatchObject({
      title: "厨房任务",
      taskType: "preset",
      uploads: 2,
      reviewed: 2,
      passed: 1,
    });
    expect(kitchen?.effectiveSeconds).toBe(200);
    const legacy = tasks.find((task) => task.taskId === null);
    expect(legacy?.title).toBe("未关联任务");
    expect(legacy?.uploads).toBe(1);
  });
});
