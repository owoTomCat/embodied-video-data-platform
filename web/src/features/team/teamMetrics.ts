import type { Submission } from "../../domain/types";
import { effectiveDuration } from "../../domain/calculations";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

export type ContributionMetrics = {
  uploads: number;
  totalSeconds: number;
  effectiveSeconds: number;
  reviewed: number;
  passed: number;
  failed: number;
  averageScore: number | null;
  passRate: number | null;
  highScoreEffectiveSeconds: number;
};

export type DailyContribution = {
  date: string;
  uploads: number;
  effectiveSeconds: number;
};

export function submissionTimestamp(submission: Submission): number | null {
  const normalized = submission.createdAt
    .replaceAll("/", "-")
    .replace(/\s+/u, "T");
  const timestamp = Date.parse(
    /(?:Z|[+-]\d\d:\d\d)$/u.test(normalized)
      ? normalized
      : `${normalized}+08:00`,
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function shanghaiDateKey(timestamp: number): string {
  return new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0 分钟";
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  if (seconds < 60 * 60) return `${Math.round(seconds / 60)} 分钟`;
  return `${(seconds / 60 / 60).toFixed(1)} 小时`;
}

export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${rate.toFixed(1)}%`;
}

export function contributionMetrics(
  submissions: Submission[],
): ContributionMetrics {
  const reviewed = submissions.filter(
    (submission) => submission.qualityStatus !== "pending",
  );
  const passed = reviewed.filter(
    (submission) => submission.qualityStatus === "passed",
  );
  const scores = reviewed.map((submission) => submission.finalScore);
  return {
    uploads: submissions.length,
    totalSeconds: submissions.reduce(
      (total, submission) => total + submission.durationSeconds,
      0,
    ),
    effectiveSeconds: submissions.reduce(
      (total, submission) =>
        total + effectiveDuration(
          submission.durationSeconds,
          submission.invalidSeconds,
        ),
      0,
    ),
    reviewed: reviewed.length,
    passed: passed.length,
    failed: reviewed.length - passed.length,
    averageScore:
      scores.length === 0
        ? null
        : scores.reduce((total, score) => total + score, 0) / scores.length,
    passRate:
      reviewed.length === 0 ? null : (passed.length / reviewed.length) * 100,
    highScoreEffectiveSeconds: passed
      .filter((submission) => submission.finalScore >= 80)
      .reduce(
        (total, submission) =>
          total + effectiveDuration(
            submission.durationSeconds,
            submission.invalidSeconds,
          ),
        0,
      ),
  };
}

export function submissionsSince(
  submissions: Submission[],
  days: number,
  now = Date.now(),
): Submission[] {
  const todayStart = Date.parse(`${shanghaiDateKey(now)}T00:00:00+08:00`);
  const start = todayStart - (days - 1) * 24 * 60 * 60 * 1_000;
  return submissions.filter((submission) => {
    const timestamp = submissionTimestamp(submission);
    return timestamp !== null && timestamp >= start && timestamp <= now;
  });
}

export function dailyContributions(
  submissions: Submission[],
  days: number,
  now = Date.now(),
): DailyContribution[] {
  const todayStart = Date.parse(`${shanghaiDateKey(now)}T00:00:00+08:00`);
  const records = Array.from({ length: days }, (_, index) => {
    const timestamp = todayStart - (days - 1 - index) * 24 * 60 * 60 * 1_000;
    return {
      date: shanghaiDateKey(timestamp),
      uploads: 0,
      effectiveSeconds: 0,
    };
  });
  const byDate = new Map(records.map((record) => [record.date, record]));
  for (const submission of submissions) {
    const timestamp = submissionTimestamp(submission);
    if (timestamp === null) continue;
    const record = byDate.get(shanghaiDateKey(timestamp));
    if (!record) continue;
    record.uploads += 1;
    record.effectiveSeconds += effectiveDuration(
      submission.durationSeconds,
      submission.invalidSeconds,
    );
  }
  return records;
}

export function sceneContributions(submissions: Submission[]) {
  const secondsByScene = new Map<string, number>();
  for (const submission of submissions) {
    if (submission.qualityStatus !== "passed") continue;
    const scene = submission.scene || "未识别场景";
    secondsByScene.set(
      scene,
      (secondsByScene.get(scene) ?? 0) +
        effectiveDuration(
          submission.durationSeconds,
          submission.invalidSeconds,
        ),
    );
  }
  const total = [...secondsByScene.values()].reduce(
    (sum, seconds) => sum + seconds,
    0,
  );
  return [...secondsByScene.entries()]
    .map(([scene, seconds]) => ({
      scene,
      seconds,
      percentage: total === 0 ? 0 : (seconds / total) * 100,
    }))
    .sort((left, right) => right.seconds - left.seconds);
}

/** 任务维度分布：按提交所属任务汇总（含未关联任务），用于团队分析的任务维度呈现 */
export function taskContributions(submissions: Submission[]) {
  const byTask = new Map<
    string,
    {
      taskId: string | null;
      title: string;
      sceneName: string;
      taskType: "generic" | "preset" | "custom";
      uploads: number;
      effectiveSeconds: number;
      reviewed: number;
      passed: number;
    }
  >();
  for (const submission of submissions) {
    const key = submission.task?.taskId ?? "__none__";
    const entry = byTask.get(key) ?? {
      taskId: submission.task?.taskId ?? null,
      title: submission.task?.title ?? "未关联任务",
      sceneName: submission.task?.sceneName ?? "",
      taskType: submission.task?.taskType ?? "custom",
      uploads: 0,
      effectiveSeconds: 0,
      reviewed: 0,
      passed: 0,
    };
    entry.uploads += 1;
    entry.effectiveSeconds += effectiveDuration(
      submission.durationSeconds,
      submission.invalidSeconds,
    );
    if (submission.qualityStatus !== "pending") {
      entry.reviewed += 1;
      if (submission.qualityStatus === "passed") entry.passed += 1;
    }
    byTask.set(key, entry);
  }
  return [...byTask.values()].sort(
    (left, right) =>
      right.uploads - left.uploads || right.effectiveSeconds - left.effectiveSeconds,
  );
}
