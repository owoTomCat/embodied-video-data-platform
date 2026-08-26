"use client";

import { useEffect, useState } from "react";

import type { TeamPublic } from "../../auth/contracts";
import { effectiveDuration, estimatePoints } from "../../domain/calculations";
import type { Submission } from "../../domain/types";
import { getPointRule } from "../../points/client/pointCycleApi";
import type { BackendPointRule } from "../../points/contracts";
import { loadAllSubmissions } from "../../submissions/client/submissionApi";
import { backendSubmissionToDomain } from "../../submissions/submissionMapper";

/** 单个成员/团队的结算统计 */
export type MemberSettlement = {
  videoCount: number;
  effectiveSeconds: number;
  avgScore: number | null;
  points: number;
  reviewedCount: number;
};

export type SettlementStats = {
  byOwner: Record<string, MemberSettlement>;
  byTeam: Record<string, MemberSettlement>;
  overall: MemberSettlement;
};

type Accumulator = {
  videoCount: number;
  effectiveSeconds: number;
  scoreSum: number;
  scoreCount: number;
  points: number;
  reviewedCount: number;
};

function emptyAccumulator(): Accumulator {
  return {
    videoCount: 0,
    effectiveSeconds: 0,
    scoreSum: 0,
    scoreCount: 0,
    points: 0,
    reviewedCount: 0,
  };
}

function toMemberSettlement(acc: Accumulator): MemberSettlement {
  return {
    videoCount: acc.videoCount,
    effectiveSeconds: acc.effectiveSeconds,
    avgScore:
      acc.scoreCount === 0 ? null : Math.round((acc.scoreSum / acc.scoreCount) * 10) / 10,
    points: Math.round(acc.points * 100) / 100,
    reviewedCount: acc.reviewedCount,
  };
}

export function computeSettlementStats(
  submissions: Submission[],
  pointRule: BackendPointRule,
  teams: TeamPublic[],
): SettlementStats {
  const teamPrice = new Map(
    teams.map((team) => [team.id, team.unitPricePerMinute]),
  );
  const defaultPrice = Number(pointRule.defaultPointsPerMinute);
  const bands = pointRule.coefficientBands;

  const byOwner: Record<string, Accumulator> = {};
  const byTeam: Record<string, Accumulator> = {};
  const overall = emptyAccumulator();

  const accFor = (
    map: Record<string, Accumulator>,
    key: string,
  ): Accumulator => (map[key] ??= emptyAccumulator());

  for (const submission of submissions) {
    const price = teamPrice.get(submission.teamId) || defaultPrice;
    const points = estimatePoints(
      price,
      submission.durationSeconds,
      submission.invalidSeconds,
      submission.finalScore,
      bands,
    );
    const effective = effectiveDuration(
      submission.durationSeconds,
      submission.invalidSeconds,
    );
    const hasScore = submission.qualityStatus !== "pending";
    const score = hasScore ? submission.finalScore : 0;

    for (const target of [
      accFor(byOwner, submission.ownerId),
      accFor(byTeam, submission.teamId),
      overall,
    ]) {
      target.videoCount += 1;
      target.effectiveSeconds += effective;
      target.points += points;
      if (hasScore) {
        target.reviewedCount += 1;
        target.scoreSum += score;
        target.scoreCount += 1;
      }
    }
  }

  return {
    byOwner: Object.fromEntries(
      Object.entries(byOwner).map(([key, acc]) => [key, toMemberSettlement(acc)]),
    ),
    byTeam: Object.fromEntries(
      Object.entries(byTeam).map(([key, acc]) => [key, toMemberSettlement(acc)]),
    ),
    overall: toMemberSettlement(overall),
  };
}

export function useMemberSettlementStats(teams: TeamPublic[]): {
  stats: SettlementStats | null;
  loading: boolean;
  unavailable: boolean;
} {
  const [stats, setStats] = useState<SettlementStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadAllSubmissions({ status: "all" }), getPointRule()])
      .then(([submissions, pointRule]) => {
        if (!active) return;
        setUnavailable(false);
        setStats(
          computeSettlementStats(
            submissions.map(backendSubmissionToDomain),
            pointRule,
            teams,
          ),
        );
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setUnavailable(true);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [teams]);

  return { stats, loading, unavailable };
}
