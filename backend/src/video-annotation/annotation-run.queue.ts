import { randomUUID } from "node:crypto";

import type { EntityManager } from "typeorm";

import { aiAnnotationSampleRate, aiAnnotationShadowEnabled } from "../ai-quality/ai-quality.config.js";
import { AnnotationRunEntity } from "../database/entities/annotation-run.entity.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { AI_ANNOTATION_ROUTING_KEY } from "../messaging/rabbitmq-topology.js";
import {
  VIDEO_ANNOTATION_POLICY_VERSION,
  VIDEO_ANNOTATION_SCHEMA_VERSION,
} from "./video-annotation.js";

export const VIDEO_ANNOTATION_PIPELINE_VERSION =
  "ego_video_annotation_pipeline_v2";

export function annotationSampleSelected(
  submissionId: string,
  sampleRate: number,
): boolean {
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;
  let hash = 2_166_136_261;
  for (const character of submissionId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296 < sampleRate;
}

export async function enqueueAnnotationRun(
  manager: EntityManager,
  run: AnnotationRunEntity,
): Promise<void> {
  const jobs = manager.getRepository(JobOutboxEntity);
  const existing = await jobs.findOne({
    where: { aggregateId: run.id, eventType: AI_ANNOTATION_ROUTING_KEY },
    lock: { mode: "pessimistic_write" },
  });
  if (existing) {
    existing.payload = { runId: run.id, submissionId: run.submissionId };
    existing.status = "pending";
    existing.attempts = 0;
    existing.availableAt = new Date();
    existing.publishedAt = null;
    existing.lastError = null;
    await jobs.save(existing);
    return;
  }
  await jobs.save({
    id: `JOB-${randomUUID()}`,
    aggregateType: "annotation_run",
    aggregateId: run.id,
    eventType: AI_ANNOTATION_ROUTING_KEY,
    payload: { runId: run.id, submissionId: run.submissionId },
    status: "pending",
    attempts: 0,
    availableAt: new Date(),
  });
}

export async function createQueuedAnnotationRun(
  manager: EntityManager,
  submissionId: string,
  trigger: "initial" | "manual",
): Promise<AnnotationRunEntity> {
  const now = new Date();
  const run = manager.getRepository(AnnotationRunEntity).create({
    id: `ANR-${randomUUID()}`,
    submissionId,
    trigger,
    pipelineVersion: VIDEO_ANNOTATION_PIPELINE_VERSION,
    schemaVersion: VIDEO_ANNOTATION_SCHEMA_VERSION,
    evidencePolicyVersion: VIDEO_ANNOTATION_POLICY_VERSION,
    executionStatus: "queued",
    reviewStatus: "pending",
    publicationStatus: "candidate_only",
    queuedAt: now,
  });
  await manager.getRepository(AnnotationRunEntity).save(run);
  await enqueueAnnotationRun(manager, run);
  return run;
}

export async function enqueueInitialAnnotationRun(
  manager: EntityManager,
  submissionId: string,
): Promise<AnnotationRunEntity | null> {
  if (
    !aiAnnotationShadowEnabled(process.env.AI_ANNOTATION_SHADOW_ENABLED) ||
    !annotationSampleSelected(
      submissionId,
      aiAnnotationSampleRate(process.env.AI_ANNOTATION_SAMPLE_RATE),
    )
  ) {
    return null;
  }
  const submission = await manager.getRepository(SubmissionEntity).findOneBy({
    id: submissionId,
  });
  if (
    !submission ||
    submission.uploadStatus !== "uploaded" ||
    submission.storageStatus !== "available" ||
    submission.assetStatus !== "active" ||
    submission.isTestData
  ) {
    return null;
  }
  if (
    !(await manager.getRepository(MediaMetadataEntity).existsBy({
      submissionId,
    }))
  ) {
    return null;
  }
  const repository = manager.getRepository(AnnotationRunEntity);
  const existing = await repository.findOne({
    where: { submissionId, trigger: "initial" },
    lock: { mode: "pessimistic_write" },
  });
  return existing ?? createQueuedAnnotationRun(manager, submissionId, "initial");
}
