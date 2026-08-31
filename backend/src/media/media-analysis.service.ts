import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DataSource,
  Repository,
  type EntityManager,
  type QueryRunner,
} from "typeorm";

import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "../database/entities/media-segment.entity.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { SubmissionDuplicateCandidateEntity } from "../database/entities/submission-duplicate-candidate.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import {
  MEDIA_COMMAND_RUNNER,
  type MediaCommandRunnerProvider,
} from "./media.tokens.js";
import type { DetectedMediaSegment } from "./media-command-runner.js";
import { enqueueInitialAnnotationRun } from "../video-annotation/annotation-run.queue.js";

export class TerminalMediaError extends Error {}
export class RetryableMediaError extends Error {}
export type MediaProcessOutcome = "processed" | "skipped" | "lock_busy";

type PostgresSessionQueryRunner = QueryRunner & {
  releasePostgresConnection(error?: Error): Promise<void>;
};

async function releaseMediaLock(
  queryRunner: QueryRunner,
  submissionId: string,
): Promise<void> {
  try {
    const rows = (await queryRunner.query(
      "SELECT pg_advisory_unlock(hashtextextended('media:' || $1, 0)) AS unlocked",
      [submissionId],
    )) as Array<{ unlocked: boolean }>;
    if (rows[0]?.unlocked !== true) {
      throw new Error("Media advisory lock was not held by this session");
    }
  } catch (error) {
    // Never return a possibly locked PostgreSQL session to the shared pool.
    await (
      queryRunner as PostgresSessionQueryRunner
    ).releasePostgresConnection(
      error instanceof Error ? error : new Error("Media advisory unlock failed"),
    );
    return;
  }
  await queryRunner.release();
}

const MEDIA_DOWNSTREAM_STATUSES = new Set([
  "awaiting_ai",
  "ai_processing",
  "completed",
]);

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk as Buffer);
  }
  return digest.digest("hex");
}

function previewBaseKey(submissionId: string): string {
  return `derived/${submissionId}/preview`;
}

function coverTimestampSeconds(durationSeconds: number): number {
  return Math.max(0, Math.min(durationSeconds / 2, 3));
}

type ComparableMedia = {
  submissionId: string;
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
  sizeBytes: number;
};

function boundedRatio(left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
    return 0;
  }
  return Math.min(left, right) / Math.max(left, right);
}

function mediaSimilarity(
  current: ComparableMedia,
  candidate: ComparableMedia,
): { similarity: number; details: Record<string, unknown> } {
  const durationSimilarity = boundedRatio(
    current.durationSeconds,
    candidate.durationSeconds,
  );
  const sizeSimilarity = boundedRatio(current.sizeBytes, candidate.sizeBytes);
  const frameRateSimilarity = boundedRatio(
    current.frameRate,
    candidate.frameRate,
  );
  const currentPixels = current.width * current.height;
  const candidatePixels = candidate.width * candidate.height;
  const resolutionSimilarity =
    current.width === candidate.width && current.height === candidate.height
      ? 1
      : boundedRatio(currentPixels, candidatePixels) * 0.9;
  const similarity =
    Math.round(
      (durationSimilarity * 0.42 +
        sizeSimilarity * 0.24 +
        resolutionSimilarity * 0.24 +
        frameRateSimilarity * 0.1) *
        10_000,
    ) / 10_000;
  return {
    similarity,
    details: {
      durationSimilarity,
      sizeSimilarity,
      resolutionSimilarity,
      frameRateSimilarity,
      current: {
        durationSeconds: current.durationSeconds,
        width: current.width,
        height: current.height,
        frameRate: current.frameRate,
        sizeBytes: current.sizeBytes,
      },
      candidate: {
        durationSeconds: candidate.durationSeconds,
        width: candidate.width,
        height: candidate.height,
        frameRate: candidate.frameRate,
        sizeBytes: candidate.sizeBytes,
      },
    },
  };
}

@Injectable()
export class MediaAnalysisService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SubmissionEntity)
    private readonly submissions: Repository<SubmissionEntity>,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    @Inject(MEDIA_COMMAND_RUNNER)
    private readonly runner: MediaCommandRunnerProvider,
  ) {}

  async process(input: {
    submissionId: string;
  }): Promise<MediaProcessOutcome> {
    const lockRunner = this.dataSource.createQueryRunner();
    await lockRunner.connect();
    let acquired = false;
    try {
      const rows = (await lockRunner.query(
        "SELECT pg_try_advisory_lock(hashtextextended('media:' || $1, 0)) AS acquired",
        [input.submissionId],
      )) as Array<{ acquired: boolean }>;
      acquired = rows[0]?.acquired === true;
      if (!acquired) return "lock_busy";
      return await this.processLocked(input.submissionId);
    } finally {
      if (acquired) {
        await releaseMediaLock(lockRunner, input.submissionId);
      } else {
        await lockRunner.release();
      }
    }
  }

  private async processLocked(
    submissionId: string,
  ): Promise<Exclude<MediaProcessOutcome, "lock_busy">> {
    const submission = await this.claimSubmission(submissionId);
    if (!submission) return "skipped";

    let directory: string | null = null;
    try {
      directory = await mkdtemp(join(tmpdir(), "evdp-media-"));
      const mediaPath = join(
        directory,
        `original${extname(submission.originalFileName).toLowerCase()}`,
      );
      await this.storage.downloadObject({
        objectKey: submission.objectKey,
        destinationPath: mediaPath,
      });
      const checksum = await sha256File(mediaPath);
      if (checksum !== submission.checksumSha256) {
        throw new TerminalMediaError("视频 SHA-256 校验失败");
      }
      const result = await this.runner.analyze(mediaPath);
      if (
        String(result.metadata.sizeBytes) !== submission.expectedSizeBytes
      ) {
        throw new TerminalMediaError("媒体文件大小与上传记录不一致");
      }
      const previewAssets = await this.createPreviewAssets(
        submission.id,
        mediaPath,
        result.metadata.durationSeconds,
        result.segments,
        directory,
      );

      const committed = await this.dataSource.transaction(async (manager) => {
        const currentSubmission = await manager
          .getRepository(SubmissionEntity)
          .findOne({
            where: { id: submission.id },
            lock: { mode: "pessimistic_write" },
          });
        if (!currentSubmission) {
          throw new TerminalMediaError("视频提交不存在");
        }
        // A timeout reclaimer may have superseded this run while external
        // commands were executing. Do not let the stale run overwrite it.
        if (currentSubmission.processingStatus !== "probing") return false;

        await manager.getRepository(MediaMetadataEntity).save({
          submissionId: submission.id,
          durationSeconds: result.metadata.durationSeconds.toFixed(3),
          width: result.metadata.width,
          height: result.metadata.height,
          frameRate: result.metadata.frameRate.toFixed(3),
          codec: result.metadata.codec,
          bitrate:
            result.metadata.bitrate === null
              ? null
              : String(result.metadata.bitrate),
          sizeBytes: String(result.metadata.sizeBytes),
          rawProbe: result.metadata.rawProbe,
          thumbnailObjectKey: previewAssets.thumbnailObjectKey,
          previewObjectKey: previewAssets.previewObjectKey,
          hlsMasterObjectKey: previewAssets.hlsMasterObjectKey,
          hlsBaseObjectKey: previewAssets.hlsBaseObjectKey,
          hlsQualities: previewAssets.hlsQualities,
          hlsObjectKeys: previewAssets.hlsObjectKeys,
        });
        const segments = manager.getRepository(MediaSegmentEntity);
        await segments.delete({ submissionId: submission.id });
        if (result.segments.length > 0) {
          await segments.save(
            result.segments.map((segment, index) => ({
              id: `SEG-${randomUUID()}`,
              submissionId: submission.id,
              type: segment.type,
              startSeconds: segment.startSeconds.toFixed(3),
              endSeconds: segment.endSeconds.toFixed(3),
              invalid: true,
              details: { source: "ffmpeg" },
              evidenceObjectKey:
                previewAssets.segmentEvidenceObjectKeys[index] ?? null,
            })),
          );
        }
        await this.refreshDuplicateCandidates(manager, currentSubmission, {
          submissionId: submission.id,
          durationSeconds: result.metadata.durationSeconds,
          width: result.metadata.width,
          height: result.metadata.height,
          frameRate: result.metadata.frameRate,
          sizeBytes: result.metadata.sizeBytes,
        });
        currentSubmission.processingStatus = "awaiting_ai";
        currentSubmission.failureCode = null;
        currentSubmission.failureMessage = null;
        await manager
          .getRepository(SubmissionEntity)
          .save(currentSubmission);
        await this.enqueueAiQuality(manager, submission.id);
        await enqueueInitialAnnotationRun(manager, submission.id);
        return true;
      });
      return committed ? "processed" : "skipped";
    } catch (error) {
      const failureMessage = (
        error instanceof Error ? error.message : "媒体处理失败"
      ).slice(0, 2_000);
      await this.markFailure(
        submission.id,
        error instanceof TerminalMediaError
          ? "MEDIA_VALIDATION_FAILED"
          : "MEDIA_PROCESSING_FAILED",
        failureMessage,
      );
      if (error instanceof TerminalMediaError) throw error;
      throw new RetryableMediaError(failureMessage);
    } finally {
      if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }

  private async claimSubmission(
    submissionId: string,
  ): Promise<SubmissionEntity | null> {
    return this.dataSource.transaction(async (manager) => {
      const submission = await manager
        .getRepository(SubmissionEntity)
        .findOne({
          where: { id: submissionId },
          lock: { mode: "pessimistic_write" },
        });
      if (!submission) {
        throw new TerminalMediaError("视频提交不存在");
      }
      if (submission.uploadStatus !== "uploaded") {
        throw new TerminalMediaError("视频对象尚未完成上传");
      }
      if (MEDIA_DOWNSTREAM_STATUSES.has(submission.processingStatus)) {
        return null;
      }
      if (
        submission.processingStatus === "system_failed" &&
        submission.failureCode !== "MEDIA_PROCESSING_FAILED"
      ) {
        return null;
      }
      if (
        submission.processingStatus !== "queued" &&
        submission.processingStatus !== "probing" &&
        submission.processingStatus !== "system_failed"
      ) {
        throw new TerminalMediaError("视频媒体任务状态不允许处理");
      }

      submission.processingStatus = "probing";
      submission.failureCode = null;
      submission.failureMessage = null;
      return manager.getRepository(SubmissionEntity).save(submission);
    });
  }

  private async markFailure(
    submissionId: string,
    failureCode: string,
    failureMessage: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const submission = await manager
        .getRepository(SubmissionEntity)
        .findOne({
          where: { id: submissionId },
          lock: { mode: "pessimistic_write" },
        });
      if (!submission || submission.processingStatus !== "probing") return;
      submission.processingStatus = "system_failed";
      submission.failureCode = failureCode;
      submission.failureMessage = failureMessage;
      await manager.getRepository(SubmissionEntity).save(submission);
    });
  }

  private async enqueueAiQuality(
    manager: EntityManager,
    submissionId: string,
  ): Promise<void> {
    const repository = manager.getRepository(JobOutboxEntity);
    const existing = await repository.findOne({
      where: { aggregateId: submissionId, eventType: "ai.quality.v1" },
      lock: { mode: "pessimistic_write" },
    });
    if (existing) {
      existing.payload = { submissionId };
      existing.status = "pending";
      existing.attempts = 0;
      existing.availableAt = new Date();
      existing.publishedAt = null;
      existing.lastError = null;
      await repository.save(existing);
      return;
    }
    await repository.save({
      id: `JOB-${randomUUID()}`,
      aggregateType: "submission",
      aggregateId: submissionId,
      eventType: "ai.quality.v1",
      payload: { submissionId },
      status: "pending",
      attempts: 0,
      availableAt: new Date(),
    });
  }

  private async createPreviewAssets(
    submissionId: string,
    mediaPath: string,
    durationSeconds: number,
    segments: DetectedMediaSegment[],
    directory: string,
  ): Promise<{
    thumbnailObjectKey: string | null;
    previewObjectKey: string | null;
    segmentEvidenceObjectKeys: Array<string | null>;
    hlsMasterObjectKey: string | null;
    hlsBaseObjectKey: string | null;
    hlsQualities: Array<{ quality: string; width: number; height: number }>;
    hlsObjectKeys: string[];
  }> {
    const baseKey = previewBaseKey(submissionId);
    let thumbnailObjectKey: string | null = null;
    let previewObjectKey: string | null = null;
    let hlsMasterObjectKey: string | null = null;
    let hlsBaseObjectKey: string | null = null;
    let hlsQualities: Array<{ quality: string; width: number; height: number }> =
      [];
    let hlsObjectKeys: string[] = [];
    try {
      const thumbnailPath = join(directory, "thumbnail.jpg");
      await this.runner.captureFrame({
        filePath: mediaPath,
        timestampSeconds: coverTimestampSeconds(durationSeconds),
        outputPath: thumbnailPath,
      });
      thumbnailObjectKey = `${baseKey}/thumbnail.jpg`;
      await this.storage.uploadObject({
        objectKey: thumbnailObjectKey,
        sourcePath: thumbnailPath,
        contentType: "image/jpeg",
      });
    } catch {
      thumbnailObjectKey = null;
    }

    try {
      const previewPath = join(directory, "preview.mp4");
      await this.runner.transcodePreview({
        filePath: mediaPath,
        outputPath: previewPath,
      });
      previewObjectKey = `${baseKey}/preview.mp4`;
      await this.storage.uploadObject({
        objectKey: previewObjectKey,
        sourcePath: previewPath,
        contentType: "video/mp4",
      });
    } catch {
      previewObjectKey = null;
    }

    try {
      const hlsDirectory = join(directory, "hls");
      await mkdir(hlsDirectory, { recursive: true });
      hlsQualities = await this.runner.transcodeHls({
        filePath: mediaPath,
        outputDirectory: hlsDirectory,
      });
      hlsBaseObjectKey = `${baseKey}/hls`;
      for (const fileName of await readdir(hlsDirectory)) {
        if (!/^[A-Za-z0-9._-]+\.(?:m3u8|ts)$/u.test(fileName)) continue;
        const objectKey = `${hlsBaseObjectKey}/${fileName}`;
        await this.storage.uploadObject({
          objectKey,
          sourcePath: join(hlsDirectory, fileName),
          contentType: fileName.endsWith(".m3u8")
            ? "application/vnd.apple.mpegurl"
            : "video/mp2t",
        });
        hlsObjectKeys.push(objectKey);
        if (fileName === "master.m3u8") hlsMasterObjectKey = objectKey;
      }
      if (!hlsMasterObjectKey) {
        hlsBaseObjectKey = null;
        hlsQualities = [];
        hlsObjectKeys = [];
      }
    } catch {
      hlsMasterObjectKey = null;
      hlsBaseObjectKey = null;
      hlsQualities = [];
      hlsObjectKeys = [];
    }

    const segmentEvidenceObjectKeys: Array<string | null> = [];
    for (const [index, segment] of segments.entries()) {
      try {
        const evidencePath = join(directory, `evidence-${index}.jpg`);
        await this.runner.captureFrame({
          filePath: mediaPath,
          timestampSeconds: (segment.startSeconds + segment.endSeconds) / 2,
          outputPath: evidencePath,
        });
        const objectKey = `${baseKey}/segments/${index + 1}-${segment.type}.jpg`;
        await this.storage.uploadObject({
          objectKey,
          sourcePath: evidencePath,
          contentType: "image/jpeg",
        });
        segmentEvidenceObjectKeys.push(objectKey);
      } catch {
        segmentEvidenceObjectKeys.push(null);
      }
    }
    return {
      thumbnailObjectKey,
      previewObjectKey,
      segmentEvidenceObjectKeys,
      hlsMasterObjectKey,
      hlsBaseObjectKey,
      hlsQualities,
      hlsObjectKeys,
    };
  }

  private async refreshDuplicateCandidates(
    manager: EntityManager,
    submission: SubmissionEntity,
    current: ComparableMedia,
  ): Promise<void> {
    const repository = manager.getRepository(SubmissionDuplicateCandidateEntity);
    await repository.delete({
      submissionId: submission.id,
      status: "candidate",
    });
    const clearedCandidateIds = new Set(
      (
        await repository.find({
          where: { submissionId: submission.id, status: "cleared" },
          select: { candidateSubmissionId: true },
        })
      ).map((candidate) => candidate.candidateSubmissionId),
    );
    const existing = await manager
      .getRepository(MediaMetadataEntity)
      .createQueryBuilder("metadata")
      .innerJoin(
        SubmissionEntity,
        "submission",
        "submission.id = metadata.submissionId",
      )
      .where("metadata.submissionId <> :submissionId", {
        submissionId: submission.id,
      })
      .andWhere("submission.uploadStatus = :uploaded", {
        uploaded: "uploaded",
      })
      .andWhere("submission.storageStatus = :available", {
        available: "available",
      })
      .andWhere("submission.assetStatus = :active", { active: "active" })
      .andWhere("metadata.durationSeconds BETWEEN :minDuration AND :maxDuration", {
        minDuration: Math.max(0.001, current.durationSeconds * 0.92),
        maxDuration: current.durationSeconds * 1.08,
      })
      .andWhere("metadata.sizeBytes BETWEEN :minSize AND :maxSize", {
        minSize: Math.floor(current.sizeBytes * 0.88),
        maxSize: Math.ceil(current.sizeBytes * 1.12),
      })
      .orderBy("metadata.createdAt", "ASC")
      .getMany();
    const candidates = existing
      .filter((metadata) => !clearedCandidateIds.has(metadata.submissionId))
      .map((metadata) => {
        const { similarity, details } = mediaSimilarity(current, {
          submissionId: metadata.submissionId,
          durationSeconds: Number(metadata.durationSeconds),
          width: metadata.width,
          height: metadata.height,
          frameRate: Number(metadata.frameRate),
          sizeBytes: Number(metadata.sizeBytes),
        });
        return { metadata, similarity, details };
      })
      .filter((candidate) => candidate.similarity >= 0.94)
      .sort((left, right) => right.similarity - left.similarity)
      .slice(0, 10);
    if (candidates.length === 0) return;
    await repository.save(
      candidates.map((candidate) => ({
        id: `DUP-${randomUUID()}`,
        submissionId: submission.id,
        candidateSubmissionId: candidate.metadata.submissionId,
        similarity: candidate.similarity.toFixed(4),
        status: "candidate",
        details: candidate.details,
      })),
    );
  }
}
