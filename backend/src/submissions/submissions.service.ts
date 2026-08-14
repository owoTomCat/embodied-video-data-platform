import { randomUUID } from "node:crypto";
import { extname } from "node:path";

import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import type { PublicUser } from "../auth/auth.types.js";
import { JobOutboxEntity } from "../database/entities/job-outbox.entity.js";
import { MediaMetadataEntity } from "../database/entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "../database/entities/media-segment.entity.js";
import { SubmissionEntity } from "../database/entities/submission.entity.js";
import { VideoQualityResultEntity } from "../database/entities/video-quality-result.entity.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../storage/object-storage.port.js";
import type {
  CompleteUploadDto,
  CreateUploadDto,
} from "./dto/upload.dto.js";
import { SubmissionFailure } from "./submission-failure.js";
import { SubmissionsPolicy } from "./submissions.policy.js";

export const UPLOAD_PART_SIZE_BYTES = 16 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

function publicSubmission(submission: SubmissionEntity) {
  const metadata = (
    submission as SubmissionEntity & {
      metadata?: MediaMetadataEntity | null;
      segments?: MediaSegmentEntity[];
    }
  ).metadata;
  const segments = (
    submission as SubmissionEntity & {
      segments?: MediaSegmentEntity[];
    }
  ).segments ?? [];
  const quality = (
    submission as SubmissionEntity & {
      quality?: VideoQualityResultEntity | null;
    }
  ).quality;
  return {
    id: submission.id,
    fileName: submission.originalFileName,
    ownerId: submission.ownerId,
    ownerName: submission.owner?.displayName ?? "",
    teamId: submission.teamId,
    teamName: submission.team?.name ?? "",
    sizeBytes: submission.expectedSizeBytes,
    uploadStatus: submission.uploadStatus,
    processingStatus: submission.processingStatus,
    failureCode: submission.failureCode ?? undefined,
    failureMessage: submission.failureMessage ?? undefined,
    isTestData: submission.isTestData,
    createdAt: submission.createdAt.getTime(),
    uploadedAt: submission.uploadedAt?.getTime(),
    media: metadata
      ? {
          durationSeconds: Number(metadata.durationSeconds),
          width: metadata.width,
          height: metadata.height,
          frameRate: Number(metadata.frameRate),
          codec: metadata.codec,
          bitrate: metadata.bitrate,
          sizeBytes: metadata.sizeBytes,
        }
      : undefined,
    segments: segments.map((segment) => ({
      id: segment.id,
      type: segment.type,
      startSeconds: Number(segment.startSeconds),
      endSeconds: Number(segment.endSeconds),
      invalid: segment.invalid,
    })),
    quality: quality
      ? {
          status: quality.status,
          attempts: quality.attempts,
          promptRevision: quality.promptRevision,
          promptContentSha256: quality.promptContentSha256,
          initialModel: quality.initialModel,
          reviewModel: quality.reviewModel,
          modelRuns: quality.modelRuns,
          finalScore:
            quality.finalScore === null ? null : Number(quality.finalScore),
          rawTotalScore:
            quality.rawTotalScore === null
              ? null
              : Number(quality.rawTotalScore),
          settlementRatio:
            quality.settlementRatio === null
              ? null
              : Number(quality.settlementRatio),
          invalidDurationMs:
            quality.invalidDurationMs === null
              ? null
              : Number(quality.invalidDurationMs),
          billableDurationMs:
            quality.billableDurationMs === null
              ? null
              : Number(quality.billableDurationMs),
          summary: quality.summary,
          recommendations: quality.recommendations,
          deductions: quality.deductions,
          reviewRequired: quality.reviewRequired,
          reviewReasons: quality.reviewReasons,
          lastError: quality.lastError ?? undefined,
          detectedTask:
            quality.normalizedResult &&
            typeof quality.normalizedResult.detectedTask === "object"
              ? quality.normalizedResult.detectedTask
              : undefined,
          dimensions:
            quality.normalizedResult &&
            typeof quality.normalizedResult.dimensions === "object"
              ? quality.normalizedResult.dimensions
              : undefined,
          qualityRawScore:
            quality.normalizedResult &&
            typeof quality.normalizedResult.qualityRawScore === "number"
              ? quality.normalizedResult.qualityRawScore
              : undefined,
          qualityScore:
            quality.normalizedResult &&
            typeof quality.normalizedResult.qualityScore === "number"
              ? quality.normalizedResult.qualityScore
              : undefined,
          demandCoefficient:
            quality.normalizedResult &&
            typeof quality.normalizedResult.demandCoefficient === "number"
              ? quality.normalizedResult.demandCoefficient
              : undefined,
          demandStatus:
            quality.normalizedResult &&
            typeof quality.normalizedResult.demandStatus === "string"
              ? quality.normalizedResult.demandStatus
              : undefined,
          ruleVersion:
            quality.normalizedResult &&
            typeof quality.normalizedResult.ruleVersion === "string"
              ? quality.normalizedResult.ruleVersion
              : undefined,
          invalidSegments:
            quality.normalizedResult &&
            Array.isArray(quality.normalizedResult.invalidSegments)
              ? quality.normalizedResult.invalidSegments
              : [],
          startedAt: quality.startedAt?.getTime(),
          completedAt: quality.completedAt?.getTime(),
        }
      : undefined,
  };
}

@Injectable()
export class SubmissionsService {
  constructor(
    @InjectRepository(SubmissionEntity)
    private readonly submissions: Repository<SubmissionEntity>,
    private readonly dataSource: DataSource,
    private readonly policy: SubmissionsPolicy,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
  ) {}

  async createUpload(actor: PublicUser, input: CreateUploadDto) {
    this.policy.requireCreate(actor);
    const extension = extname(input.fileName).toLocaleLowerCase("en-US");
    const expectedExtension =
      input.contentType === "video/mp4" ? ".mp4" : ".mov";
    if (extension !== expectedExtension) {
      throw new SubmissionFailure(
        "INVALID_FILE_TYPE",
        "文件扩展名与视频格式不一致",
        400,
      );
    }

    const id = `SUB-${randomUUID()}`;
    const objectKey = `uploads/${actor.teamId}/${actor.id}/${id}/original${extension}`;
    const { uploadId } = await this.storage.createMultipartUpload({
      objectKey,
      contentType: input.contentType,
      checksumSha256: input.checksumSha256,
    });
    try {
      const submission = await this.submissions.save(
        this.submissions.create({
          id,
          ownerId: actor.id,
          teamId: actor.teamId,
          originalFileName: input.fileName,
          contentType: input.contentType,
          expectedSizeBytes: String(input.sizeBytes),
          checksumSha256: input.checksumSha256,
          objectKey,
          multipartUploadId: uploadId,
          uploadStatus: "uploading",
          processingStatus: "uploading",
          isTestData: false,
        }),
      );
      return {
        submission: publicSubmission(submission),
        upload: {
          uploadId,
          partSizeBytes: UPLOAD_PART_SIZE_BYTES,
          partCount: Math.ceil(input.sizeBytes / UPLOAD_PART_SIZE_BYTES),
          expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
        },
      };
    } catch (error) {
      await this.storage.abortMultipartUpload({ objectKey, uploadId });
      throw error;
    }
  }

  async presignParts(
    actor: PublicUser,
    id: string,
    partNumbers: number[],
  ) {
    const submission = await this.findEntity(id);
    this.policy.requireUploadControl(actor, submission);
    this.requireUploading(submission);
    const uploadId = submission.multipartUploadId!;
    const partCount = Math.ceil(
      Number(submission.expectedSizeBytes) / UPLOAD_PART_SIZE_BYTES,
    );
    const uniqueParts = [...new Set(partNumbers)].sort((a, b) => a - b);
    if (
      uniqueParts.length !== partNumbers.length ||
      uniqueParts.some((partNumber) => partNumber > partCount)
    ) {
      throw new SubmissionFailure(
        "INVALID_PARTS",
        "分片编号无效或重复",
        400,
      );
    }
    return {
      parts: await Promise.all(
        uniqueParts.map((partNumber) =>
          this.storage.presignUploadPart({
            objectKey: submission.objectKey,
            uploadId,
            partNumber,
            expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
          }),
        ),
      ),
    };
  }

  async completeUpload(
    actor: PublicUser,
    id: string,
    input: CompleteUploadDto,
  ) {
    const submission = await this.findEntity(id);
    this.policy.requireUploadControl(actor, submission);
    this.requireUploading(submission);
    const uploadId = submission.multipartUploadId!;
    const expectedPartCount = Math.ceil(
      Number(submission.expectedSizeBytes) / UPLOAD_PART_SIZE_BYTES,
    );
    const parts = [...input.parts].sort(
      (left, right) => left.partNumber - right.partNumber,
    );
    if (
      parts.length !== expectedPartCount ||
      parts.some((part, index) => part.partNumber !== index + 1)
    ) {
      throw new SubmissionFailure(
        "INVALID_PARTS",
        "必须提交完整且连续的分片列表",
        400,
      );
    }
    await this.storage.completeMultipartUpload({
      objectKey: submission.objectKey,
      uploadId,
      parts,
    });
    const object = await this.storage.headObject({
      objectKey: submission.objectKey,
    });
    if (object.sizeBytes !== submission.expectedSizeBytes) {
      submission.uploadStatus = "uploaded";
      submission.processingStatus = "system_failed";
      submission.failureCode = "OBJECT_SIZE_MISMATCH";
      submission.failureMessage = "上传对象大小与创建上传时声明的不一致";
      submission.uploadedAt = new Date();
      await this.submissions.save(submission);
      throw new SubmissionFailure(
        "OBJECT_SIZE_MISMATCH",
        "上传文件大小校验失败，请重新上传",
        422,
      );
    }

    await this.dataSource.transaction(async (manager) => {
      submission.uploadStatus = "uploaded";
      submission.processingStatus = "queued";
      submission.failureCode = null;
      submission.failureMessage = null;
      submission.uploadedAt = new Date();
      await manager.getRepository(SubmissionEntity).save(submission);
      await manager.getRepository(JobOutboxEntity).save({
        id: `JOB-${randomUUID()}`,
        aggregateType: "submission",
        aggregateId: submission.id,
        eventType: "media.probe.v1",
        payload: {
          submissionId: submission.id,
          objectKey: submission.objectKey,
          expectedSizeBytes: submission.expectedSizeBytes,
          checksumSha256: submission.checksumSha256,
        },
        status: "pending",
        attempts: 0,
        availableAt: new Date(),
      });
    });
    return { submission: publicSubmission(submission) };
  }

  async abortUpload(actor: PublicUser, id: string): Promise<void> {
    const submission = await this.findEntity(id);
    this.policy.requireUploadControl(actor, submission);
    this.requireUploading(submission);
    await this.storage.abortMultipartUpload({
      objectKey: submission.objectKey,
      uploadId: submission.multipartUploadId!,
    });
    submission.uploadStatus = "aborted";
    submission.processingStatus = "system_failed";
    submission.failureCode = "UPLOAD_ABORTED";
    submission.failureMessage = "上传已取消";
    submission.multipartUploadId = null;
    await this.submissions.save(submission);
  }

  async list(actor: PublicUser) {
    const query = this.submissions
      .createQueryBuilder("submission")
      .leftJoinAndSelect("submission.owner", "owner")
      .leftJoinAndSelect("submission.team", "team")
      .leftJoinAndMapOne(
        "submission.metadata",
        MediaMetadataEntity,
        "metadata",
        "metadata.submissionId = submission.id",
      )
      .leftJoinAndMapMany(
        "submission.segments",
        MediaSegmentEntity,
        "segment",
        "segment.submissionId = submission.id",
      )
      .leftJoinAndMapOne(
        "submission.quality",
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .orderBy("submission.createdAt", "DESC")
      .addOrderBy("segment.startSeconds", "ASC");
    if (actor.role === "leader") {
      query.andWhere("submission.teamId = :teamId", {
        teamId: actor.teamId,
      });
    } else if (actor.role === "collector") {
      query.andWhere("submission.ownerId = :ownerId", {
        ownerId: actor.id,
      });
    }
    return (await query.getMany()).map(publicSubmission);
  }

  async get(actor: PublicUser, id: string) {
    const submission = await this.submissions
      .createQueryBuilder("submission")
      .leftJoinAndSelect("submission.owner", "owner")
      .leftJoinAndSelect("submission.team", "team")
      .leftJoinAndMapOne(
        "submission.metadata",
        MediaMetadataEntity,
        "metadata",
        "metadata.submissionId = submission.id",
      )
      .leftJoinAndMapMany(
        "submission.segments",
        MediaSegmentEntity,
        "segment",
        "segment.submissionId = submission.id",
      )
      .leftJoinAndMapOne(
        "submission.quality",
        VideoQualityResultEntity,
        "quality",
        "quality.submissionId = submission.id",
      )
      .where("submission.id = :id", { id })
      .orderBy("segment.startSeconds", "ASC")
      .getOne();
    if (!submission) {
      throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
    }
    this.policy.requireRead(actor, submission);
    return publicSubmission(submission);
  }

  private async findEntity(id: string): Promise<SubmissionEntity> {
    const submission = await this.submissions.findOneBy({ id });
    if (!submission) {
      throw new SubmissionFailure("NOT_FOUND", "视频不存在", 404);
    }
    return submission;
  }

  private requireUploading(submission: SubmissionEntity): void {
    if (
      submission.uploadStatus !== "uploading" ||
      !submission.multipartUploadId
    ) {
      throw new SubmissionFailure(
        "UPLOAD_NOT_ACTIVE",
        "该视频当前没有可操作的上传任务",
        409,
      );
    }
  }
}
