import { describe, expect, it } from "vitest";

import type { TeamPublic } from "../../auth/contracts";
import type { Submission } from "../../domain/types";
import type { BackendPointRule } from "../../points/contracts";
import { computeSettlementStats } from "./useMemberSettlementStats";

function submission(overrides: Partial<Submission>): Submission {
  return {
    id: "SUB-000",
    fileName: "task.mp4",
    ownerId: "U-COL-01",
    ownerName: "测试人员1",
    teamId: "TEAM-01",
    teamName: "星火一队",
    scene: "家庭厨房",
    action: "抓取",
    object: "手持工具",
    durationSeconds: 60,
    invalidSeconds: 6,
    sizeMb: 10,
    resolution: "1920×1080",
    processingStatus: "completed",
    qualityStatus: "passed",
    aiScore: 85,
    finalScore: 80,
    settlementStatus: "unsettled",
    createdAt: "2026-08-01 12:00",
    tags: [],
    issues: [],
    invalidIssues: [],
    audit: [],
    ...overrides,
  };
}

const teams: TeamPublic[] = [
  {
    id: "TEAM-01",
    name: "星火一队",
    status: "active",
    unitPricePerMinute: 12,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "TEAM-02",
    name: "远山二队",
    status: "active",
    unitPricePerMinute: 20,
    createdAt: 1,
    updatedAt: 1,
  },
];

const pointRule: BackendPointRule = {
  id: "PRV-1",
  revision: 1,
  version: "POINTS-1",
  defaultPointsPerMinute: 12,
  coefficientBands: [
    { minScore: 80, maxScore: 100, ratio: 1, label: "优质" },
    { minScore: 70, maxScore: 79, ratio: 0.85, label: "合格" },
    { minScore: 60, maxScore: 69, ratio: 0.7, label: "基础" },
    { minScore: 0, maxScore: 59, ratio: 0, label: "不计分" },
  ],
  description: "",
  active: true,
  createdByAccountId: "U-ADMIN-01",
  createdByName: "管理员",
  createdAt: 1,
};

describe("computeSettlementStats", () => {
  it("aggregates points, duration, video count and average score per owner and team", () => {
    const stats = computeSettlementStats(
      [
        submission({
          id: "SUB-1",
          ownerId: "U-COL-01",
          teamId: "TEAM-01",
          durationSeconds: 60,
          invalidSeconds: 6,
          finalScore: 80, // 优质 1.0
        }),
        submission({
          id: "SUB-2",
          ownerId: "U-COL-01",
          teamId: "TEAM-01",
          durationSeconds: 120,
          invalidSeconds: 0,
          finalScore: 75, // 合格 0.85
        }),
        submission({
          id: "SUB-3",
          ownerId: "U-COL-02",
          teamId: "TEAM-02",
          durationSeconds: 60,
          invalidSeconds: 0,
          finalScore: 60, // 基础 0.7, team price 20
        }),
      ],
      pointRule,
      teams,
    );

    // U-COL-01: 2 videos, effective (54 + 120) = 174s, avg (80+75)/2 = 77.5
    expect(stats.byOwner["U-COL-01"]).toMatchObject({
      videoCount: 2,
      effectiveSeconds: 174,
      avgScore: 77.5,
      reviewedCount: 2,
    });
    // points = 12 * (54/60) * 1 + 12 * (120/60) * 0.85
    expect(stats.byOwner["U-COL-01"]!.points).toBeCloseTo(12 * 0.9 + 12 * 2 * 0.85, 2);

    // U-COL-02: 1 video, 60s, avg 60, points = 20 * (60/60) * 0.7
    expect(stats.byOwner["U-COL-02"]).toMatchObject({
      videoCount: 1,
      effectiveSeconds: 60,
      avgScore: 60,
      reviewedCount: 1,
    });
    expect(stats.byOwner["U-COL-02"]!.points).toBeCloseTo(20 * 0.7, 2);

    // TEAM-01 aggregates both U-COL-01 videos
    expect(stats.byTeam["TEAM-01"]).toMatchObject({
      videoCount: 2,
      effectiveSeconds: 174,
      avgScore: 77.5,
    });
    // TEAM-02 aggregates U-COL-02
    expect(stats.byTeam["TEAM-02"]).toMatchObject({
      videoCount: 1,
      effectiveSeconds: 60,
      avgScore: 60,
    });

    // overall: 3 videos, 234s, avg (80+75+60)/3 = 71.7
    expect(stats.overall).toMatchObject({
      videoCount: 3,
      effectiveSeconds: 234,
      avgScore: 71.7,
      reviewedCount: 3,
    });
  });

  it("uses the team unit price for points and falls back to the rule default", () => {
    const stats = computeSettlementStats(
      [
        submission({
          ownerId: "U-COL-01",
          teamId: "TEAM-01",
          durationSeconds: 60,
          invalidSeconds: 0,
          finalScore: 80,
        }),
        submission({
          id: "SUB-NOTEAM",
          ownerId: "U-COL-03",
          teamId: "TEAM-UNKNOWN",
          durationSeconds: 60,
          invalidSeconds: 0,
          finalScore: 80,
        }),
      ],
      pointRule,
      teams,
    );

    // TEAM-01 unit price 12, rule default also 12 -> same
    expect(stats.byOwner["U-COL-01"]!.points).toBeCloseTo(12 * 1, 2);
    // Unknown team falls back to rule default 12
    expect(stats.byOwner["U-COL-03"]!.points).toBeCloseTo(12 * 1, 2);
  });

  it("excludes pending submissions from score and review counts", () => {
    const stats = computeSettlementStats(
      [
        submission({
          ownerId: "U-COL-01",
          finalScore: 0,
          qualityStatus: "pending",
        }),
      ],
      pointRule,
      teams,
    );
    expect(stats.byOwner["U-COL-01"]).toMatchObject({
      videoCount: 1,
      reviewedCount: 0,
      avgScore: null,
    });
  });
});
