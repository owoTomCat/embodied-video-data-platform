import { z } from "zod";

import type { VideoAnnotationCandidateSuccess } from "./video-annotation.js";

const referenceTaskSchema = z
  .object({
    start_ms: z.number().finite().nonnegative(),
    end_ms: z.number().finite().positive(),
    task_verb: z.string().min(1),
    execution_pattern: z.string().min(1).optional(),
    completion: z.string().min(1).optional(),
    result_status: z.string().min(1).optional(),
    failure_recovery: z.string().min(1).optional(),
    complexity_signals: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .refine((task) => task.end_ms > task.start_ms, {
    message: "任务结束时间必须晚于开始时间",
  });

export const videoAnnotationReferenceSchema = z
  .object({
    schema_version: z.literal("ego_video_annotation_reference_v1"),
    video_id: z.string().min(1),
    tasks: z.array(referenceTaskSchema),
    coverage: z.array(
      z
        .object({
          timestamp_ms: z.number().finite().nonnegative(),
          segment_type: z.enum(["task", "transition", "unclear"]),
        })
        .strict(),
    ),
  })
  .strict();

export type VideoAnnotationReference = z.infer<
  typeof videoAnnotationReferenceSchema
>;

type EvaluableTask = {
  start_ms: number;
  end_ms: number;
  task_verb: string;
  execution_pattern?: string;
  completion?: string;
  result_status?: string;
  failure_recovery?: string;
  complexity_signals?: string[];
};

export type EvaluableVideoAnnotation = {
  videoId: string;
  tasks: EvaluableTask[];
  coverage: Array<{
    timestamp_ms: number;
    segment_type: "task" | "transition" | "unclear";
  }>;
};

export type AnnotationEvaluationMetrics = {
  sampleCount: number;
  taskDetection: {
    truePositive: number;
    falsePositive: number;
    falseNegative: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  };
  meanTaskTemporalIou: number | null;
  taskVerbAccuracy: number | null;
  executionPatternAccuracy: number | null;
  completionAccuracy: number | null;
  resultStatusAccuracy: number | null;
  failureRecoveryAccuracy: number | null;
  complexitySignalF1: number | null;
  taskCoverage: {
    evaluatedTimestamps: number;
    precision: number | null;
    recall: number | null;
    f1: number | null;
  };
};

type Pair = {
  candidate: EvaluableVideoAnnotation;
  reference: VideoAnnotationReference;
};

type Match = {
  candidateIndex: number;
  referenceIndex: number;
  temporalIou: number;
};

function temporalIou(left: EvaluableTask, right: EvaluableTask): number {
  const intersection = Math.max(
    0,
    Math.min(left.end_ms, right.end_ms) -
      Math.max(left.start_ms, right.start_ms),
  );
  const union =
    Math.max(left.end_ms, right.end_ms) -
    Math.min(left.start_ms, right.start_ms);
  return union > 0 ? intersection / union : 0;
}

function matchTasks(
  candidate: EvaluableTask[],
  reference: EvaluableTask[],
  minimumTemporalIou: number,
): Match[] {
  const pairs = candidate.flatMap((candidateTask, candidateIndex) =>
    reference.map((referenceTask, referenceIndex) => ({
      candidateIndex,
      referenceIndex,
      temporalIou: temporalIou(candidateTask, referenceTask),
    })),
  );
  pairs.sort((left, right) => right.temporalIou - left.temporalIou);
  const usedCandidates = new Set<number>();
  const usedReferences = new Set<number>();
  const matches: Match[] = [];
  for (const pair of pairs) {
    if (pair.temporalIou < minimumTemporalIou) break;
    if (
      usedCandidates.has(pair.candidateIndex) ||
      usedReferences.has(pair.referenceIndex)
    ) {
      continue;
    }
    usedCandidates.add(pair.candidateIndex);
    usedReferences.add(pair.referenceIndex);
    matches.push(pair);
  }
  return matches;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function f1(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) return null;
  return precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;
}

function candidateFromArtifact(
  candidate: VideoAnnotationCandidateSuccess,
): EvaluableVideoAnnotation {
  return {
    videoId: candidate.effective.video_id,
    tasks: candidate.effective.tasks.map((task) => ({
      start_ms: task.start_ms,
      end_ms: task.end_ms,
      task_verb: task.task_verb,
      execution_pattern: task.execution_pattern,
      completion: task.effective_completion,
      result_status: task.effective_result_status,
      failure_recovery: task.effective_failure_recovery,
      complexity_signals: task.effective_complexity_signals,
    })),
    coverage: candidate.effective.coverage_segments.flatMap((segment) =>
      segment.evidence_timestamps_ms.map((timestamp_ms) => ({
        timestamp_ms,
        segment_type: segment.segment_type,
      })),
    ),
  };
}

export function evaluateVideoAnnotationDataset(input: {
  pairs: Pair[];
  minimumTemporalIou?: number;
}): AnnotationEvaluationMetrics {
  const minimumTemporalIou = input.minimumTemporalIou ?? 0.3;
  if (
    !Number.isFinite(minimumTemporalIou) ||
    minimumTemporalIou <= 0 ||
    minimumTemporalIou > 1
  ) {
    throw new Error("minimumTemporalIou 必须在 (0, 1] 范围内");
  }

  let taskTruePositive = 0;
  let taskFalsePositive = 0;
  let taskFalseNegative = 0;
  let temporalIouTotal = 0;
  let verbCorrect = 0;
  let patternCorrect = 0;
  let patternTotal = 0;
  let completionCorrect = 0;
  let completionTotal = 0;
  let resultCorrect = 0;
  let resultTotal = 0;
  let recoveryCorrect = 0;
  let recoveryTotal = 0;
  let complexityTruePositive = 0;
  let complexityFalsePositive = 0;
  let complexityFalseNegative = 0;
  let complexityTotal = 0;
  let coverageTruePositive = 0;
  let coverageFalsePositive = 0;
  let coverageFalseNegative = 0;
  let coverageTotal = 0;

  for (const { candidate, reference } of input.pairs) {
    const parsedReference = videoAnnotationReferenceSchema.parse(reference);
    if (candidate.videoId !== parsedReference.video_id) {
      throw new Error(
        `候选与标准集 video_id 不一致：${candidate.videoId} != ${parsedReference.video_id}`,
      );
    }
    const matches = matchTasks(
      candidate.tasks,
      parsedReference.tasks,
      minimumTemporalIou,
    );
    taskTruePositive += matches.length;
    taskFalsePositive += candidate.tasks.length - matches.length;
    taskFalseNegative += parsedReference.tasks.length - matches.length;
    for (const match of matches) {
      const candidateTask = candidate.tasks[match.candidateIndex]!;
      const referenceTask = parsedReference.tasks[match.referenceIndex]!;
      temporalIouTotal += match.temporalIou;
      if (candidateTask.task_verb === referenceTask.task_verb) verbCorrect += 1;
      if (referenceTask.execution_pattern !== undefined) {
        patternTotal += 1;
        if (candidateTask.execution_pattern === referenceTask.execution_pattern) {
          patternCorrect += 1;
        }
      }
      if (referenceTask.completion !== undefined) {
        completionTotal += 1;
        if (candidateTask.completion === referenceTask.completion) {
          completionCorrect += 1;
        }
      }
      if (referenceTask.result_status !== undefined) {
        resultTotal += 1;
        if (candidateTask.result_status === referenceTask.result_status) {
          resultCorrect += 1;
        }
      }
      if (referenceTask.failure_recovery !== undefined) {
        recoveryTotal += 1;
        if (candidateTask.failure_recovery === referenceTask.failure_recovery) {
          recoveryCorrect += 1;
        }
      }
      if (referenceTask.complexity_signals !== undefined) {
        complexityTotal += 1;
        const expected = new Set(referenceTask.complexity_signals);
        const actual = new Set(candidateTask.complexity_signals ?? []);
        for (const signal of actual) {
          if (expected.has(signal)) complexityTruePositive += 1;
          else complexityFalsePositive += 1;
        }
        for (const signal of expected) {
          if (!actual.has(signal)) complexityFalseNegative += 1;
        }
      }
    }

    const candidateCoverage = new Map(
      candidate.coverage.map((item) => [item.timestamp_ms, item.segment_type]),
    );
    for (const expected of parsedReference.coverage) {
      coverageTotal += 1;
      const expectedTask = expected.segment_type === "task";
      const actualTask = candidateCoverage.get(expected.timestamp_ms) === "task";
      if (actualTask && expectedTask) coverageTruePositive += 1;
      else if (actualTask) coverageFalsePositive += 1;
      else if (expectedTask) coverageFalseNegative += 1;
    }
  }

  const taskPrecision = ratio(
    taskTruePositive,
    taskTruePositive + taskFalsePositive,
  );
  const taskRecall = ratio(
    taskTruePositive,
    taskTruePositive + taskFalseNegative,
  );
  const coveragePrecision = ratio(
    coverageTruePositive,
    coverageTruePositive + coverageFalsePositive,
  );
  const coverageRecall = ratio(
    coverageTruePositive,
    coverageTruePositive + coverageFalseNegative,
  );
  const complexityPrecision = ratio(
    complexityTruePositive,
    complexityTruePositive + complexityFalsePositive,
  );
  const complexityRecall = ratio(
    complexityTruePositive,
    complexityTruePositive + complexityFalseNegative,
  );

  return {
    sampleCount: input.pairs.length,
    taskDetection: {
      truePositive: taskTruePositive,
      falsePositive: taskFalsePositive,
      falseNegative: taskFalseNegative,
      precision: taskPrecision,
      recall: taskRecall,
      f1: f1(taskPrecision, taskRecall),
    },
    meanTaskTemporalIou: ratio(temporalIouTotal, taskTruePositive),
    taskVerbAccuracy: ratio(verbCorrect, taskTruePositive),
    executionPatternAccuracy: ratio(patternCorrect, patternTotal),
    completionAccuracy: ratio(completionCorrect, completionTotal),
    resultStatusAccuracy: ratio(resultCorrect, resultTotal),
    failureRecoveryAccuracy: ratio(recoveryCorrect, recoveryTotal),
    complexitySignalF1:
      complexityTotal > 0 ? f1(complexityPrecision, complexityRecall) : null,
    taskCoverage: {
      evaluatedTimestamps: coverageTotal,
      precision: coveragePrecision,
      recall: coverageRecall,
      f1: f1(coveragePrecision, coverageRecall),
    },
  };
}

export function evaluateCandidateAnnotations(input: {
  pairs: Array<{
    candidate: VideoAnnotationCandidateSuccess;
    reference: VideoAnnotationReference;
  }>;
  minimumTemporalIou?: number;
}): AnnotationEvaluationMetrics {
  return evaluateVideoAnnotationDataset({
    pairs: input.pairs.map((pair) => ({
      candidate: candidateFromArtifact(pair.candidate),
      reference: pair.reference,
    })),
    ...(input.minimumTemporalIou !== undefined
      ? { minimumTemporalIou: input.minimumTemporalIou }
      : {}),
  });
}
