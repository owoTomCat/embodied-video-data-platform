import type { INestApplication } from "@nestjs/common";
import { Readable } from "node:stream";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import request from "supertest";
import type { DataSource } from "typeorm";

import { AuthModule } from "../src/auth/auth.module.js";
import {
  createDataSource,
  identityEntities,
} from "../src/database/data-source.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { CollectionTaskEntity } from "../src/database/entities/collection-task.entity.js";
import { JobOutboxEntity } from "../src/database/entities/job-outbox.entity.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { MediaSegmentEntity } from "../src/database/entities/media-segment.entity.js";
import { PointCycleEntity } from "../src/database/entities/point-cycle.entity.js";
import { PointCycleItemEntity } from "../src/database/entities/point-cycle-item.entity.js";
import { PointRuleVersionEntity } from "../src/database/entities/point-rule-version.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { VideoQualityPromptVersionEntity } from "../src/database/entities/video-quality-prompt-version.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";
import { configureApplication } from "../src/http/configure-application.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../src/storage/object-storage.port.js";
import { SubmissionsModule } from "../src/submissions/submissions.module.js";
import { SubmissionsService } from "../src/submissions/submissions.service.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Submission-upload-password-2026";

class RecordingObjectStorage implements ObjectStoragePort {
  uploads = new Map<string, { objectKey: string; sizeBytes: string }>();
  completed: Array<{ uploadId: string; parts: number[] }> = [];
  aborted: string[] = [];
  deleted: string[] = [];
  reportedSizeBytes = "33554432";
  deleteFailuresRemaining = 0;
  completedObjectKeys = new Set<string>();

  async downloadObject() {
    throw new Error("not used");
  }

  async readObject(input: { objectKey: string }) {
    return Readable.from([Buffer.from(`object:${input.objectKey}`, "utf8")]);
  }

  async uploadObject() {
    throw new Error("not used");
  }

  async createMultipartUpload(input: {
    objectKey: string;
    contentType: string;
    checksumSha256: string;
  }) {
    const uploadId = `UPLOAD-${this.uploads.size + 1}`;
    this.uploads.set(uploadId, {
      objectKey: input.objectKey,
      sizeBytes: this.reportedSizeBytes,
    });
    return { uploadId };
  }

  async presignUploadPart(input: {
    objectKey: string;
    uploadId: string;
    partNumber: number;
    expiresInSeconds: number;
  }) {
    return {
      partNumber: input.partNumber,
      url: `http://minio.local/${input.objectKey}?uploadId=${input.uploadId}&partNumber=${input.partNumber}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000),
    };
  }

  async presignDownloadObject(input: {
    objectKey: string;
    expiresInSeconds: number;
  }) {
    return {
      url: `http://minio.local/${input.objectKey}?download=1`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000),
    };
  }

  async deleteObject(input: { objectKey: string }) {
    if (this.deleteFailuresRemaining > 0) {
      this.deleteFailuresRemaining -= 1;
      throw new Error("simulated object deletion failure");
    }
    this.deleted.push(input.objectKey);
  }

  async completeMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) {
    this.completedObjectKeys.add(input.objectKey);
    this.completed.push({
      uploadId: input.uploadId,
      parts: input.parts.map((part) => part.partNumber),
    });
    return { etag: "completed-etag" };
  }

  async headObject(input: { objectKey: string }) {
    if (!this.completedObjectKeys.has(input.objectKey)) {
      throw new Error("object missing");
    }
    const upload = [...this.uploads.values()].find(
      (item) => item.objectKey === input.objectKey,
    );
    if (!upload) throw new Error("object missing");
    return {
      sizeBytes: upload.sizeBytes,
      etag: "completed-etag",
      contentType: "video/mp4",
    };
  }

  async abortMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
  }) {
    void input.objectKey;
    this.aborted.push(input.uploadId);
  }
}

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("submission multipart upload API", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let storage: RecordingObjectStorage;
  let completedSubmissionId = "";

  async function login(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ username, password: TEST_PASSWORD })
      .expect(200);
    return cookieFrom(response);
  }

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    const passwordHash = await argon2.hash(TEST_PASSWORD, {
      type: argon2.argon2id,
    });
    await dataSource.getRepository(TeamEntity).save([
      { id: "TEAM-UPLOAD-01", name: "上传测试一队" },
      { id: "TEAM-UPLOAD-02", name: "上传测试二队" },
    ]);
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-UPLOAD-ADMIN",
        displayName: "上传管理员",
        username: "upload-admin",
        usernameNormalized: "upload-admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-UPLOAD-LEADER",
        displayName: "上传团长",
        username: "upload-leader",
        usernameNormalized: "upload-leader",
        passwordHash,
        role: "leader",
        teamId: "TEAM-UPLOAD-01",
        status: "active",
      },
      {
        id: "U-UPLOAD-COLLECTOR",
        displayName: "上传数采",
        username: "upload-collector",
        usernameNormalized: "upload-collector",
        passwordHash,
        role: "collector",
        teamId: "TEAM-UPLOAD-01",
        status: "active",
      },
      {
        id: "U-UPLOAD-OTHER",
        displayName: "其他数采",
        username: "upload-other",
        usernameNormalized: "upload-other",
        passwordHash,
        role: "collector",
        teamId: "TEAM-UPLOAD-02",
        status: "active",
      },
    ]);
    await dataSource.getRepository(CollectionTaskEntity).save([
      {
        id: "TASK-UPLOAD-01",
        title: "上传测试任务",
        description: "上传链路测试任务",
        sceneName: "测试场景",
        sceneLabelId: null,
        rawRequirements: "第一人称拍摄",
        normalizedRequirements: {
          scene_description: "测试场景",
          requirements: [{ type: "hard", content: "必须第一人称拍摄" }],
          quality_notes: [],
        },
        normalizationStatus: "ready",
        pricePointsPerMinute: "15.00",
        status: "published",
        revision: 1,
        createdByAccountId: "U-UPLOAD-ADMIN",
        createdByName: "上传管理员",
        publishedAt: new Date(),
      },
    ]);

    storage = new RecordingObjectStorage();
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          url: TEST_DATABASE_URL,
          entities: identityEntities,
          synchronize: false,
        }),
        AuthModule,
        SubmissionsModule,
      ],
    })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app, WEB_ORIGIN);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("creates, presigns, and completes a collector multipart upload", async () => {
    const cookie = await login("upload-collector");
    const created = await request(app.getHttpServer())
      .post("/api/v1/submissions/uploads")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        fileName: "first-person-task.mp4",
        contentType: "video/mp4",
        sizeBytes: 33_554_432,
        checksumSha256: "a".repeat(64),
        dataUsageAuthorized: true,
        privacyConfirmed: true,
        sensitiveContentConfirmed: true,
        taskId: "TASK-UPLOAD-01",
        taskRequirementsConfirmed: true,
      })
      .expect(201);

    expect(created.body).toMatchObject({
      submission: {
        ownerId: "U-UPLOAD-COLLECTOR",
        teamId: "TEAM-UPLOAD-01",
        fileName: "first-person-task.mp4",
        uploadStatus: "uploading",
        processingStatus: "uploading",
      },
      upload: {
        partSizeBytes: 16_777_216,
        partCount: 2,
      },
    });
    const id = created.body.submission.id as string;
    completedSubmissionId = id;

    const parts = await request(app.getHttpServer())
      .post(`/api/v1/submissions/${id}/uploads/parts`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({ partNumbers: [1, 2] })
      .expect(201);
    expect(parts.body.parts).toHaveLength(2);
    expect(parts.body.parts[0].url).toContain("partNumber=1");

    await request(app.getHttpServer())
      .post(`/api/v1/submissions/${id}/uploads/complete`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        parts: [
          { partNumber: 1, etag: "etag-one" },
          { partNumber: 2, etag: "etag-two" },
        ],
      })
      .expect(201);

    expect(
      await dataSource.getRepository(SubmissionEntity).findOneByOrFail({ id }),
    ).toMatchObject({
      uploadStatus: "uploaded",
      processingStatus: "queued",
    });
    const duplicate = await request(app.getHttpServer())
      .post("/api/v1/submissions/uploads")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        fileName: "first-person-task.mp4",
        contentType: "video/mp4",
        sizeBytes: 33_554_432,
        checksumSha256: "a".repeat(64),
        dataUsageAuthorized: true,
        privacyConfirmed: true,
        sensitiveContentConfirmed: true,
        taskId: "TASK-UPLOAD-01",
        taskRequirementsConfirmed: true,
      })
      .expect(409);
    expect(duplicate.body).toMatchObject({
      code: "DUPLICATE_VIDEO",
      error: expect.stringContaining(id),
    });
    expect(
      await dataSource.getRepository(JobOutboxEntity).countBy({
        aggregateId: id,
        eventType: "media.probe.v1",
      }),
    ).toBe(1);
  });

  it("requires upload authorization confirmations before creating tasks", async () => {
    const cookie = await login("upload-collector");
    const response = await request(app.getHttpServer())
      .post("/api/v1/submissions/uploads")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        fileName: "unauthorized-task.mp4",
        contentType: "video/mp4",
        sizeBytes: 1024,
        checksumSha256: "f".repeat(64),
        dataUsageAuthorized: true,
        privacyConfirmed: false,
        sensitiveContentConfirmed: true,
        taskId: "TASK-UPLOAD-01",
        taskRequirementsConfirmed: true,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      code: "UPLOAD_AUTHORIZATION_REQUIRED",
      error: "上传前必须确认数据授权、隐私规范和敏感内容处理要求",
    });
  });

  it("returns an actionable validation error for videos above 2 GiB", async () => {
    const cookie = await login("upload-collector");
    const response = await request(app.getHttpServer())
      .post("/api/v1/submissions/uploads")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        fileName: "oversized-task.mp4",
        contentType: "video/mp4",
        sizeBytes: 2 * 1024 ** 3 + 1,
        checksumSha256: "e".repeat(64),
        dataUsageAuthorized: true,
        privacyConfirmed: true,
        sensitiveContentConfirmed: true,
        taskId: "TASK-UPLOAD-01",
        taskRequirementsConfirmed: true,
      })
      .expect(400);

    expect(response.body).toMatchObject({
      error: "Bad Request",
      message: expect.arrayContaining(["单个视频不能超过 2 GiB"]),
    });
  });

  it("serializes concurrent upload registration for the same checksum", async () => {
    const cookie = await login("upload-collector");
    const uploadsBefore = storage.uploads.size;
    const payload = {
      fileName: "concurrent-duplicate.mp4",
      contentType: "video/mp4",
      sizeBytes: 1_024,
      checksumSha256: "d".repeat(64),
      dataUsageAuthorized: true,
      privacyConfirmed: true,
      sensitiveContentConfirmed: true,
      taskId: "TASK-UPLOAD-01",
      taskRequirementsConfirmed: true,
    };
    const responses = await Promise.all([
      request(app.getHttpServer())
        .post("/api/v1/submissions/uploads")
        .set("Origin", WEB_ORIGIN)
        .set("Cookie", cookie)
        .send(payload),
      request(app.getHttpServer())
        .post("/api/v1/submissions/uploads")
        .set("Origin", WEB_ORIGIN)
        .set("Cookie", cookie)
        .send(payload),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201,
      409,
    ]);
    expect(
      responses.find((response) => response.status === 409)?.body,
    ).toMatchObject({ code: "DUPLICATE_VIDEO" });
    expect(
      await dataSource.getRepository(SubmissionEntity).countBy({
        checksumSha256: payload.checksumSha256,
      }),
    ).toBe(1);
    expect(storage.uploads.size).toBe(uploadsBefore + 1);
    const created = responses.find((response) => response.status === 201);
    const createdId = created?.body.submission.id as string | undefined;
    const createdUploadId = created?.body.upload.uploadId as string | undefined;
    if (createdId) {
      await dataSource.getRepository(SubmissionEntity).delete({ id: createdId });
    }
    if (createdUploadId) storage.uploads.delete(createdUploadId);
  });

  it("enforces self, own-team, and administrator visibility", async () => {
    await dataSource.getRepository(SubmissionEntity).update(
      { id: completedSubmissionId },
      { processingStatus: "completed" },
    );
    const prompt = await dataSource
      .getRepository(VideoQualityPromptVersionEntity)
      .save({
        id: "VQP-UPLOAD-01",
        revision: 1,
        systemPrompt: "test prompt",
        contentSha256: "c".repeat(64),
        promptVersion: "qwen_video_qc_prompt_v1",
        ruleVersion: "video_qc_v2",
        outputSchema: "video_qc_result_v1",
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        active: true,
        createdByAccountId: "U-UPLOAD-ADMIN",
        createdByName: "上传管理员",
      });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: completedSubmissionId,
      durationSeconds: "10.000",
      width: 1920,
      height: 1080,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: "33554432",
      rawProbe: {},
      thumbnailObjectKey: `derived/${completedSubmissionId}/preview/thumbnail.jpg`,
      previewObjectKey: `derived/${completedSubmissionId}/preview/preview.mp4`,
      hlsMasterObjectKey: `derived/${completedSubmissionId}/preview/hls/master.m3u8`,
      hlsBaseObjectKey: `derived/${completedSubmissionId}/preview/hls`,
      hlsQualities: [{ quality: "720p", width: 1280, height: 720 }],
      hlsObjectKeys: [
        `derived/${completedSubmissionId}/preview/hls/master.m3u8`,
        `derived/${completedSubmissionId}/preview/hls/720p.m3u8`,
        `derived/${completedSubmissionId}/preview/hls/720p-000.ts`,
      ],
    });
    await dataSource.getRepository(MediaSegmentEntity).save({
      id: "SEG-UPLOAD-PREVIEW-01",
      submissionId: completedSubmissionId,
      type: "black",
      startSeconds: "1.000",
      endSeconds: "2.000",
      invalid: true,
      details: { source: "ffmpeg" },
      evidenceObjectKey: `derived/${completedSubmissionId}/preview/segments/1-black.jpg`,
    });
    await dataSource.getRepository(VideoQualityResultEntity).save({
      submissionId: completedSubmissionId,
      status: "scored",
      attempts: 1,
      promptVersionId: prompt.id,
      promptRevision: prompt.revision,
      promptContentSha256: prompt.contentSha256,
      systemPromptSnapshot: prompt.systemPrompt,
      initialModel: prompt.initialModel,
      reviewModel: prompt.reviewModel,
      modelRuns: [
        { stage: "initial", model: "qwen3.7-plus", requestId: "req-1" },
      ],
      finalScore: "88.0",
      rawTotalScore: "90.0",
      settlementRatio: "0.9000",
      invalidDurationMs: "1000",
      billableDurationMs: "9000",
      summary: "正式 AI 质检通过",
      recommendations: ["继续保持"],
      deductions: [],
      reviewRequired: false,
      reviewReasons: [],
      normalizedResult: {
        detectedTask: {
          scene_id: "kitchen",
          task_id: "tidy",
          variant_id: "v1",
          task_summary: "整理厨房台面",
          confidence: 0.98,
        },
        invalidSegments: [],
        candidateAnnotation: {
          status: "candidate",
          schemaVersion: "ego_video_annotation_v1",
          policyVersion: "ego_annotation_evidence_policy_v1",
          promptVersion: "ego_video_annotation_prompt_v1",
          promptContentSha256: "a".repeat(64),
          effective: { video_summary: "整理厨房台面", tasks: [] },
          validation: { errors: [], warnings: [] },
        },
      },
      rawModelResult: {},
      startedAt: new Date(),
      completedAt: new Date(),
    });
    const collectorCookie = await login("upload-collector");
    const own = await request(app.getHttpServer())
      .get("/api/v1/submissions")
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(own.body.submissions).toHaveLength(1);
    expect(own.body.submissions[0].quality).toMatchObject({
      status: "scored",
      finalScore: 88,
      settlementRatio: 0.9,
      summary: "正式 AI 质检通过",
      promptRevision: 1,
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
    });

    const otherCookie = await login("upload-other");
    const other = await request(app.getHttpServer())
      .get("/api/v1/submissions")
      .set("Cookie", otherCookie)
      .expect(200);
    expect(other.body.submissions).toHaveLength(0);

    const leaderCookie = await login("upload-leader");
    const team = await request(app.getHttpServer())
      .get("/api/v1/submissions")
      .set("Cookie", leaderCookie)
      .expect(200);
    expect(team.body.submissions).toHaveLength(1);

    const adminCookie = await login("upload-admin");
    const all = await request(app.getHttpServer())
      .get("/api/v1/submissions")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(all.body.submissions).toHaveLength(1);
    expect(all.body.pagination).toEqual({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });

    const searched = await request(app.getHttpServer())
      .get("/api/v1/submissions")
      .query({
        q: "first-person",
        status: "passed",
        page: 1,
        pageSize: 10,
      })
      .set("Cookie", adminCookie)
      .expect(200);
    expect(searched.body.pagination).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    expect(searched.body.submissions[0]).toMatchObject({
      id: completedSubmissionId,
      fileName: "first-person-task.mp4",
      settlementStatus: "unsettled",
    });
    const reviewed = await request(app.getHttpServer())
      .get("/api/v1/submissions")
      .query({
        status: "reviewed",
        page: 1,
        pageSize: 10,
      })
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(reviewed.body.pagination).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
      totalPages: 1,
    });
    expect(reviewed.body.submissions[0]).toMatchObject({
      id: completedSubmissionId,
      quality: {
        status: "scored",
      },
    });
    await dataSource.getRepository(SubmissionEntity).save({
      id: "SUB-UPLOAD-FAILED-QUALITY",
      ownerId: "U-UPLOAD-COLLECTOR",
      teamId: "TEAM-UPLOAD-01",
      originalFileName: "failed-quality.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "1024",
      checksumSha256: "7".repeat(64),
      objectKey: "uploads/failed-quality/original.mp4",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      uploadedAt: new Date("2026-08-12T01:00:00.000Z"),
      createdAt: new Date("2026-08-12T01:00:00.000Z"),
    });
    await dataSource.getRepository(VideoQualityResultEntity).save({
      submissionId: "SUB-UPLOAD-FAILED-QUALITY",
      status: "hard_reject",
      attempts: 1,
      promptVersionId: prompt.id,
      promptRevision: prompt.revision,
      promptContentSha256: prompt.contentSha256,
      systemPromptSnapshot: prompt.systemPrompt,
      initialModel: prompt.initialModel,
      reviewModel: prompt.reviewModel,
      modelRuns: [],
      finalScore: "40.0",
      rawTotalScore: "40.0",
      settlementRatio: "0.0000",
      invalidDurationMs: "10000",
      billableDurationMs: "0",
      summary: "质量未通过",
      recommendations: [],
      deductions: [],
      reviewRequired: false,
      reviewReasons: [],
      normalizedResult: {},
      rawModelResult: {},
      startedAt: new Date("2026-08-12T01:01:00.000Z"),
      completedAt: new Date("2026-08-12T01:02:00.000Z"),
    });
    await request(app.getHttpServer())
      .patch("/api/v1/submissions/SUB-UPLOAD-FAILED-QUALITY/quality-review")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        finalScore: 90,
        reason: "尝试推翻硬否决",
        expectedReviewRevision: 0,
        issues: [],
      })
      .expect(409);
    const unsettledBeforeLock = await request(app.getHttpServer())
      .get("/api/v1/submissions")
      .query({ status: "unsettled", page: 1, pageSize: 10 })
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(unsettledBeforeLock.body.submissions.map((item: { id: string }) => item.id)).toEqual([
      completedSubmissionId,
    ]);

    const exported = await request(app.getHttpServer())
      .get("/api/v1/submissions/export.csv")
      .query({
        q: "first-person",
        status: "passed",
      })
      .set("Cookie", adminCookie)
      .expect(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.headers["content-disposition"]).toContain(
      "submissions-export.csv",
    );
    expect(exported.text).toContain("submission_id,file_name,owner_name");
    expect(exported.text).toContain(completedSubmissionId);
    expect(exported.text).toContain("first-person-task.mp4");
    expect(exported.text).toContain("上传数采");
    expect(exported.text).toContain("上传测试一队");

    await dataSource.getRepository(PointCycleEntity).save({
      id: "PC-UPLOAD-01",
      businessDate: "2026-08-13",
      status: "locked",
      submissionCount: 1,
      effectiveDurationMs: "9000",
      totalPoints: "1.35",
      createdByAccountId: "U-UPLOAD-ADMIN",
      createdByName: "上传管理员",
    });
    await dataSource.getRepository(PointCycleItemEntity).save({
      id: "PCI-UPLOAD-01",
      cycleId: "PC-UPLOAD-01",
      submissionId: completedSubmissionId,
      ownerId: "U-UPLOAD-COLLECTOR",
      ownerName: "上传数采",
      teamId: "TEAM-UPLOAD-01",
      teamName: "上传测试一队",
      fileName: "first-person-task.mp4",
      finalScore: "88.0",
      settlementRatio: "0.9000",
      effectiveDurationMs: "9000",
      pointsPerMinute: "10.0000",
      points: "1.35",
      qualityRevision: 0,
    });
    const settled = await request(app.getHttpServer())
      .get("/api/v1/submissions")
      .query({ status: "unsettled", page: 1, pageSize: 10 })
      .set("Cookie", adminCookie)
      .expect(200);
    expect(settled.body.submissions).toHaveLength(0);
    const settledSearch = await request(app.getHttpServer())
      .get("/api/v1/submissions")
      .query({ q: "上传数采", page: 1, pageSize: 10 })
      .set("Cookie", adminCookie)
      .expect(200);
    expect(settledSearch.body.submissions[0]).toMatchObject({
      id: completedSubmissionId,
      settlementStatus: "settled",
    });
    await dataSource.getRepository(PointCycleItemEntity).delete({
      id: "PCI-UPLOAD-01",
    });
    await dataSource.getRepository(PointCycleEntity).delete({
      id: "PC-UPLOAD-01",
    });

    const preview = await request(app.getHttpServer())
      .get(`/api/v1/submissions/${completedSubmissionId}/preview`)
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(preview.body.preview).toMatchObject({
      url: expect.stringContaining("preview.mp4"),
      contentType: "video/mp4",
      fileName: "first-person-task.mp4",
      source: "web_preview",
      hls: {
        url: `/api/v1/submissions/${completedSubmissionId}/preview/hls/master.m3u8`,
        contentType: "application/vnd.apple.mpegurl",
        qualities: [{ quality: "720p", width: 1280, height: 720 }],
      },
      thumbnail: {
        url: expect.stringContaining("thumbnail.jpg"),
        contentType: "image/jpeg",
        expiresAt: expect.any(Number),
      },
      evidenceFrames: [
        expect.objectContaining({
          segmentId: "SEG-UPLOAD-PREVIEW-01",
          type: "black",
          startSeconds: 1,
          endSeconds: 2,
          url: expect.stringContaining("1-black.jpg"),
          contentType: "image/jpeg",
          expiresAt: expect.any(Number),
        }),
      ],
    });
    expect(preview.body.preview.expiresAt).toEqual(expect.any(Number));

    const hls = await request(app.getHttpServer())
      .get(`/api/v1/submissions/${completedSubmissionId}/preview/hls/master.m3u8`)
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(hls.headers["content-type"]).toContain(
      "application/vnd.apple.mpegurl",
    );
    expect(hls.text).toContain(
      `object:derived/${completedSubmissionId}/preview/hls/master.m3u8`,
    );

    await request(app.getHttpServer())
      .get(`/api/v1/submissions/${completedSubmissionId}/preview`)
      .set("Cookie", otherCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/submissions/${completedSubmissionId}/preview/hls/master.m3u8`)
      .set("Cookie", otherCookie)
      .expect(403);
  });

  it("keeps an unreviewed review-pending result out of formal pass and settlement views", async () => {
    const submissionId = "SUB-UPLOAD-REVIEW-PENDING";
    const zeroPointSubmissionId = "SUB-UPLOAD-ZERO-POINT";
    const strictFailedSubmissionId = "SUB-UPLOAD-STRICT-FAILED";
    const prompt = await dataSource
      .getRepository(VideoQualityPromptVersionEntity)
      .findOneByOrFail({ id: "VQP-UPLOAD-01" });
    await dataSource.getRepository(SubmissionEntity).save({
      id: submissionId,
      ownerId: "U-UPLOAD-COLLECTOR",
      teamId: "TEAM-UPLOAD-01",
      originalFileName: "strict-review-pending.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "1024",
      checksumSha256: "6".repeat(64),
      objectKey: `uploads/${submissionId}/original.mp4`,
      uploadStatus: "uploaded",
      processingStatus: "completed",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(VideoQualityResultEntity).save({
      submissionId,
      status: "review_pending",
      attempts: 1,
      promptVersionId: prompt.id,
      promptRevision: prompt.revision,
      promptContentSha256: prompt.contentSha256,
      systemPromptSnapshot: prompt.systemPrompt,
      initialModel: prompt.initialModel,
      reviewModel: prompt.reviewModel,
      qualityRuleSnapshot: {
        id: "QRV-UPLOAD-STRICT",
        revision: 2,
        version: "RULE-UPLOAD-STRICT",
        passThreshold: 70,
        description: "七十分通过",
      },
      finalScore: "65.0",
      settlementRatio: null,
      passed: null,
      invalidDurationMs: "0",
      billableDurationMs: "10000",
      summary: "等待人工确认",
      modelRuns: [],
      recommendations: [],
      deductions: [],
      reviewRequired: true,
      reviewReasons: ["边界分数需人工确认"],
      normalizedResult: {},
      rawModelResult: {},
      completedAt: new Date(),
    });
    await dataSource.getRepository(SubmissionEntity).save({
      id: strictFailedSubmissionId,
      ownerId: "U-UPLOAD-COLLECTOR",
      teamId: "TEAM-UPLOAD-01",
      originalFileName: "strict-scored-failed.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "1024",
      checksumSha256: "9".repeat(64),
      objectKey: `uploads/${strictFailedSubmissionId}/original.mp4`,
      uploadStatus: "uploaded",
      processingStatus: "completed",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(VideoQualityResultEntity).save({
      submissionId: strictFailedSubmissionId,
      status: "scored",
      attempts: 1,
      promptVersionId: prompt.id,
      promptRevision: prompt.revision,
      promptContentSha256: prompt.contentSha256,
      systemPromptSnapshot: prompt.systemPrompt,
      initialModel: prompt.initialModel,
      reviewModel: prompt.reviewModel,
      qualityRuleSnapshot: {
        id: "QRV-UPLOAD-STRICT",
        revision: 2,
        version: "RULE-UPLOAD-STRICT",
        passThreshold: 70,
        description: "七十分通过",
      },
      finalScore: "65.0",
      rawTotalScore: "65.0",
      settlementRatio: "0.0000",
      passed: false,
      invalidDurationMs: "0",
      billableDurationMs: "10000",
      summary: "低于锁定规则阈值",
      modelRuns: [],
      recommendations: [],
      deductions: [],
      reviewRequired: false,
      reviewReasons: [],
      normalizedResult: {},
      rawModelResult: {},
      completedAt: new Date(),
    });
    await dataSource.getRepository(PointRuleVersionEntity).save({
      id: "PRV-UPLOAD-ZERO",
      revision: 1,
      version: "POINTS-UPLOAD-ZERO",
      defaultPointsPerMinute: "12.0000",
      coefficientBands: [
        { minScore: 0, maxScore: 100, ratio: 0, label: "暂不计分" },
      ],
      description: "验证零系数通过项不进入待锁定列表",
      active: true,
      createdByAccountId: "U-UPLOAD-ADMIN",
      createdByName: "上传管理员",
    });
    await dataSource.getRepository(SubmissionEntity).save({
      id: zeroPointSubmissionId,
      ownerId: "U-UPLOAD-COLLECTOR",
      teamId: "TEAM-UPLOAD-01",
      originalFileName: "zero-point-passed.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "1024",
      checksumSha256: "8".repeat(64),
      objectKey: `uploads/${zeroPointSubmissionId}/original.mp4`,
      uploadStatus: "uploaded",
      processingStatus: "completed",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(VideoQualityResultEntity).save({
      submissionId: zeroPointSubmissionId,
      status: "scored",
      attempts: 1,
      promptVersionId: prompt.id,
      promptRevision: prompt.revision,
      promptContentSha256: prompt.contentSha256,
      systemPromptSnapshot: prompt.systemPrompt,
      initialModel: prompt.initialModel,
      reviewModel: prompt.reviewModel,
      finalScore: "82.0",
      settlementRatio: "1.0000",
      passed: true,
      invalidDurationMs: "0",
      billableDurationMs: "10000",
      summary: "质量通过但积分系数为零",
      modelRuns: [],
      recommendations: [],
      deductions: [],
      reviewRequired: false,
      reviewReasons: [],
      normalizedResult: {},
      rawModelResult: {},
      completedAt: new Date(),
    });

    try {
      const collectorCookie = await login("upload-collector");
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/submissions/${submissionId}`)
        .set("Cookie", collectorCookie)
        .expect(200);
      expect(detail.body.submission.quality).toMatchObject({
        status: "review_pending",
        finalScore: 65,
        passed: null,
        passThreshold: 70,
      });

      for (const status of ["passed", "reviewed", "unsettled"] as const) {
        const response = await request(app.getHttpServer())
          .get("/api/v1/submissions")
          .query({ q: "strict-review-pending", status, page: 1, pageSize: 10 })
          .set("Cookie", collectorCookie)
          .expect(200);
        expect(response.body.pagination.total).toBe(0);
      }

      const leaderCookie = await login("upload-leader");
      const adminCookie = await login("upload-admin");
      for (const [cookie, status] of [
        [collectorCookie, "quality_results"],
        [leaderCookie, "quality_results"],
        [adminCookie, "review_queue"],
      ] as const) {
        const response = await request(app.getHttpServer())
          .get("/api/v1/submissions")
          .query({ q: "strict-review-pending", status, page: 1, pageSize: 10 })
          .set("Cookie", cookie)
          .expect(200);
        expect(response.body.submissions.map((item: { id: string }) => item.id)).toEqual([
          submissionId,
        ]);
      }

      const passed = await request(app.getHttpServer())
        .get("/api/v1/submissions")
        .query({ q: "zero-point-passed", status: "passed", page: 1, pageSize: 10 })
        .set("Cookie", collectorCookie)
        .expect(200);
      expect(passed.body.pagination.total).toBe(1);
      const unsettled = await request(app.getHttpServer())
        .get("/api/v1/submissions")
        .query({
          q: "zero-point-passed",
          status: "unsettled",
          page: 1,
          pageSize: 10,
        })
        .set("Cookie", collectorCookie)
        .expect(200);
      expect(unsettled.body.pagination.total).toBe(0);

      const strictFailed = await request(app.getHttpServer())
        .get("/api/v1/submissions")
        .query({
          q: "strict-scored-failed",
          status: "failed",
          page: 1,
          pageSize: 10,
        })
        .set("Cookie", collectorCookie)
        .expect(200);
      expect(strictFailed.body.pagination.total).toBe(1);
      const strictPassed = await request(app.getHttpServer())
        .get("/api/v1/submissions")
        .query({
          q: "strict-scored-failed",
          status: "passed",
          page: 1,
          pageSize: 10,
        })
        .set("Cookie", collectorCookie)
        .expect(200);
      expect(strictPassed.body.pagination.total).toBe(0);
    } finally {
      await dataSource
        .getRepository(VideoQualityResultEntity)
        .delete([
          submissionId,
          zeroPointSubmissionId,
          strictFailedSubmissionId,
        ]);
      await dataSource
        .getRepository(SubmissionEntity)
        .delete([
          submissionId,
          zeroPointSubmissionId,
          strictFailedSubmissionId,
        ]);
      await dataSource
        .getRepository(PointRuleVersionEntity)
        .delete({ id: "PRV-UPLOAD-ZERO" });
    }
  });

  it("persists manual quality review with audit and optimistic revision checks", async () => {
    const adminCookie = await login("upload-admin");
    const correction = {
      schema_version: "ego_video_annotation_v2",
      video_id: completedSubmissionId,
      video_summary: "人工复核确认当前采样帧没有可交付任务。",
      scene: {
        coarse_label: "室内",
        fine_label: "家庭厨房",
        confidence: 0.95,
        evidence_timestamps_ms: [0],
      },
      temporal_structure_type: "unclear",
      model_assessability: "assessable",
      assessability_reason: "人工核对原视频后确认该结构化结果。",
      tasks: [],
      coverage_segments: [
        {
          start_ms: 0,
          end_ms: 750,
          segment_type: "transition",
          linked_task_index: null,
          visible_activity: "无独立手物操作",
          evidence_timestamps_ms: [0, 250, 500, 750],
        },
      ],
      uncertain_fields: [],
      global_limitations: [],
    };
    const qualityBeforeReview = await dataSource
      .getRepository(VideoQualityResultEntity)
      .findOneByOrFail({ submissionId: completedSubmissionId });
    qualityBeforeReview.normalizedResult = {
      ...(qualityBeforeReview.normalizedResult ?? {}),
      candidateAnnotation: {
        status: "review_required",
        schemaVersion: "ego_video_annotation_v2",
        policyVersion: "ego_annotation_evidence_policy_v2",
        promptVersion: "ego_video_annotation_prompt_v2",
        promptContentSha256: "a".repeat(64),
        model: "qwen3.7-plus",
        sampling: {
          maxFrameGapMs: 250,
          sourceTimestampsMs: [0, 250, 500, 750],
        },
        raw: correction,
        effective: correction,
        labelMappings: [],
        validation: { errors: [], warnings: [] },
      },
    };
    qualityBeforeReview.labelSetSnapshot = {
      id: "LSV-ANNOTATION-TEST",
      revision: 1,
      version: "LABELS-ANNOTATION-TEST",
      labels: [
        {
          id: "SCENE-001",
          name: "家庭厨房",
          type: "scene",
          enabled: true,
        },
      ],
    };
    await dataSource
      .getRepository(VideoQualityResultEntity)
      .save(qualityBeforeReview);
    await request(app.getHttpServer())
      .patch(`/api/v1/submissions/${completedSubmissionId}/quality-review`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        finalScore: 92,
        reason: "旧影子字段不得再写入正式复核",
        expectedReviewRevision: 0,
        issues: [],
        annotationDecision: "accepted",
        annotationCorrection: correction,
      })
      .expect(400);
    expect(await dataSource.getRepository(VideoQualityResultEntity).findOneByOrFail({
      submissionId: completedSubmissionId,
    })).toMatchObject({ reviewRevision: 0 });
    const reviewed = await request(app.getHttpServer())
      .patch(`/api/v1/submissions/${completedSubmissionId}/quality-review`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        finalScore: 92,
        reason: "证据区间复核后确认画面可用",
        expectedReviewRevision: 0,
        issues: [{ label: "轻微晃动", start: 1, end: 3.5 }],
      })
      .expect(200);

    expect(reviewed.body.submission.quality).toMatchObject({
      finalScore: 92,
      aiFinalScore: 88,
      settlementRatio: 1,
      invalidDurationMs: 2500,
      billableDurationMs: 7500,
      reviewRevision: 1,
      manualReview: {
        reviewedByAccountId: "U-UPLOAD-ADMIN",
        reviewedByName: "上传管理员",
        reason: "证据区间复核后确认画面可用",
        finalScore: 92,
      },
    });
    expect(reviewed.body.submission.quality.annotationReview).toBeUndefined();
    expect(reviewed.body.submission.quality.manualIssues).toEqual([
      { label: "轻微晃动", start: 1, end: 3.5 },
    ]);
    expect(reviewed.body.submission.audit).toEqual([
      expect.objectContaining({
        actor: "上传管理员",
        action: "人工复核质量结果",
        reason: "证据区间复核后确认画面可用",
        previousScore: 88,
        nextScore: 92,
      }),
    ]);
    expect(await dataSource.getRepository(AuditLogEntity).countBy({
      action: "quality_review",
      targetAccountId: completedSubmissionId,
    })).toBe(1);

    await request(app.getHttpServer())
      .patch(`/api/v1/submissions/${completedSubmissionId}/quality-review`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        finalScore: 91,
        reason: "旧版本覆盖尝试",
        expectedReviewRevision: 0,
        issues: [],
      })
      .expect(409);

    const quarantined = await request(app.getHttpServer())
      .patch(`/api/v1/submissions/${completedSubmissionId}/quality-review`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        finalScore: 91,
        reason: "画面包含隐私信息，转入敏感隔离",
        expectedReviewRevision: 1,
        issues: [],
        quarantine: true,
      })
      .expect(200);
    expect(quarantined.body.submission).toMatchObject({
      assetStatus: "quarantined",
      quarantine: {
        reason: "画面包含隐私信息，转入敏感隔离",
        quarantinedByAccountId: "U-UPLOAD-ADMIN",
        quarantinedByName: "上传管理员",
      },
      quality: {
        finalScore: 91,
        reviewRevision: 2,
      },
    });
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "asset_quarantine",
        targetAccountId: completedSubmissionId,
      }),
    ).toBe(1);

    const released = await request(app.getHttpServer())
      .patch(`/api/v1/submissions/${completedSubmissionId}/quality-review`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        finalScore: 93,
        reason: "已完成脱敏处理，解除隔离",
        expectedReviewRevision: 2,
        issues: [],
        quarantine: false,
      })
      .expect(200);
    expect(released.body.submission).toMatchObject({
      assetStatus: "active",
      quality: {
        finalScore: 93,
        reviewRevision: 3,
      },
    });
    expect(released.body.submission).not.toHaveProperty("quarantine");
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "asset_release",
        targetAccountId: completedSubmissionId,
      }),
    ).toBe(1);

    const collectorCookie = await login("upload-collector");
    await request(app.getHttpServer())
      .patch(`/api/v1/submissions/${completedSubmissionId}/quality-review`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({
        finalScore: 91,
        reason: "数采尝试复核",
        expectedReviewRevision: 3,
        issues: [],
      })
      .expect(403);
  });

  it("lets administrators rerun failed AI quality jobs with audit records", async () => {
    await dataSource.getRepository(SubmissionEntity).update(
      { id: completedSubmissionId },
      {
        processingStatus: "system_failed",
        failureCode: "AI_QUALITY_FAILED",
        failureMessage: "模型调用失败",
      },
    );
    await dataSource.getRepository(VideoQualityResultEntity).update(
      { submissionId: completedSubmissionId },
      {
        status: "system_failed",
        lastError: "模型调用失败",
        completedAt: new Date(),
      },
    );
    await dataSource.getRepository(JobOutboxEntity).save({
      id: "JOB-UPLOAD-AI-RERUN",
      aggregateType: "submission",
      aggregateId: completedSubmissionId,
      eventType: "ai.quality.v1",
      payload: { submissionId: completedSubmissionId },
      status: "published",
      attempts: 3,
      availableAt: new Date("2026-08-13T07:00:00Z"),
      publishedAt: new Date("2026-08-13T07:01:00Z"),
      lastError: "旧发布错误",
    });

    const collectorCookie = await login("upload-collector");
    await request(app.getHttpServer())
      .post(`/api/v1/submissions/${completedSubmissionId}/quality-rerun`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ reason: "数采尝试重跑" })
      .expect(403);

    const adminCookie = await login("upload-admin");
    const rerun = await request(app.getHttpServer())
      .post(`/api/v1/submissions/${completedSubmissionId}/quality-rerun`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ reason: "模型服务恢复，重新排队质检" })
      .expect(201);

    expect(rerun.body.submission).toMatchObject({
      id: completedSubmissionId,
      processingStatus: "awaiting_ai",
      quality: {
        status: "queued",
        finalScore: null,
        settlementRatio: null,
      },
    });
    expect(rerun.body.submission).not.toHaveProperty("failureCode");
    expect(rerun.body.submission).not.toHaveProperty("failureMessage");
    expect(rerun.body.submission.quality).not.toHaveProperty("lastError");
    const outbox = await dataSource
      .getRepository(JobOutboxEntity)
      .findOneByOrFail({
        aggregateId: completedSubmissionId,
        eventType: "ai.quality.v1",
      });
    expect(outbox).toMatchObject({
      status: "pending",
      attempts: 0,
      publishedAt: null,
      lastError: null,
    });
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "ai_quality_rerun",
        targetAccountId: completedSubmissionId,
      }),
    ).toBe(1);
  });

  it("lets administrators rename and delete submitted data records", async () => {
    const adminCookie = await login("upload-admin");
    const collectorCookie = await login("upload-collector");
    storage.deleted = [];
    await dataSource.getRepository(SubmissionEntity).save({
      id: "SUB-UPLOAD-MANAGE",
      ownerId: "U-UPLOAD-COLLECTOR",
      teamId: "TEAM-UPLOAD-01",
      originalFileName: "manage-me.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "2048",
      checksumSha256: "9".repeat(64),
      objectKey: "uploads/manage/original.mp4",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      storageRetainUntil: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: "SUB-UPLOAD-MANAGE",
      durationSeconds: "12.000",
      width: 1920,
      height: 1080,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: "2048",
      rawProbe: {},
      thumbnailObjectKey: "derived/manage/thumbnail.jpg",
      previewObjectKey: "derived/manage/preview.mp4",
      hlsMasterObjectKey: null,
      hlsBaseObjectKey: null,
      hlsQualities: [],
      hlsObjectKeys: [],
    });
    await dataSource.getRepository(MediaSegmentEntity).save({
      id: "SEG-UPLOAD-MANAGE",
      submissionId: "SUB-UPLOAD-MANAGE",
      type: "black",
      startSeconds: "2.000",
      endSeconds: "4.000",
      invalid: true,
      details: {},
      evidenceObjectKey: "derived/manage/black.jpg",
    });
    await dataSource.getRepository(JobOutboxEntity).save({
      id: "JOB-UPLOAD-MANAGE",
      aggregateType: "submission",
      aggregateId: "SUB-UPLOAD-MANAGE",
      eventType: "ai.quality.v1",
      payload: { submissionId: "SUB-UPLOAD-MANAGE" },
      status: "pending",
      attempts: 0,
      availableAt: new Date(),
    });

    await request(app.getHttpServer())
      .patch("/api/v1/submissions/SUB-UPLOAD-MANAGE/name")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ fileName: "collector-rename.mp4" })
      .expect(403);

    const renamed = await request(app.getHttpServer())
      .patch("/api/v1/submissions/SUB-UPLOAD-MANAGE/name")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        fileName: "managed-renamed.mp4",
        reason: "修正测试人员误填文件名",
      })
      .expect(200);
    expect(renamed.body.submission).toMatchObject({
      id: "SUB-UPLOAD-MANAGE",
      fileName: "managed-renamed.mp4",
    });

    const invalidName = await request(app.getHttpServer())
      .patch("/api/v1/submissions/SUB-UPLOAD-MANAGE/name")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ fileName: "wrong-extension.mov" })
      .expect(400);
    expect(invalidName.body.code).toBe("INVALID_FILE_NAME");

    const blocked = await request(app.getHttpServer())
      .delete("/api/v1/submissions/SUB-UPLOAD-MANAGE")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ reason: "保留期内普通删除" })
      .expect(409);
    expect(blocked.body.code).toBe("RETENTION_NOT_EXPIRED");
    expect(storage.deleted).toEqual([]);

    const deleted = await request(app.getHttpServer())
      .delete("/api/v1/submissions/SUB-UPLOAD-MANAGE")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ reason: "误传数据移除", force: true })
      .expect(200);
    expect(deleted.body).toMatchObject({
      deletedSubmissionId: "SUB-UPLOAD-MANAGE",
      deletedFileName: "managed-renamed.mp4",
      deletedObjectKeys: [
        "uploads/manage/original.mp4",
        "derived/manage/preview.mp4",
        "derived/manage/thumbnail.jpg",
        "derived/manage/black.jpg",
      ],
    });
    expect(storage.deleted).toEqual([
      "uploads/manage/original.mp4",
      "derived/manage/preview.mp4",
      "derived/manage/thumbnail.jpg",
      "derived/manage/black.jpg",
    ]);
    expect(
      await dataSource.getRepository(SubmissionEntity).countBy({
        id: "SUB-UPLOAD-MANAGE",
      }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(MediaMetadataEntity).countBy({
        submissionId: "SUB-UPLOAD-MANAGE",
      }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(MediaSegmentEntity).countBy({
        submissionId: "SUB-UPLOAD-MANAGE",
      }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(JobOutboxEntity).countBy({
        aggregateId: "SUB-UPLOAD-MANAGE",
      }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "submission_rename",
        targetAccountId: "SUB-UPLOAD-MANAGE",
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "submission_delete",
        targetAccountId: "SUB-UPLOAD-MANAGE",
      }),
    ).toBe(1);
  });

  it("audits and synchronizes object deletion with retention checks", async () => {
    const adminCookie = await login("upload-admin");
    storage.deleted = [];
    await dataSource.getRepository(SubmissionEntity).save({
      id: "SUB-UPLOAD-DELETE",
      ownerId: "U-UPLOAD-COLLECTOR",
      teamId: "TEAM-UPLOAD-01",
      originalFileName: "delete-me.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "1024",
      checksumSha256: "8".repeat(64),
      objectKey: "uploads/delete/original.mp4",
      uploadStatus: "uploaded",
      processingStatus: "completed",
      storageRetainUntil: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: "SUB-UPLOAD-DELETE",
      durationSeconds: "10.000",
      width: 1920,
      height: 1080,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: "1024",
      rawProbe: {},
      thumbnailObjectKey: "derived/delete/thumbnail.jpg",
      previewObjectKey: "derived/delete/preview.mp4",
      hlsMasterObjectKey: "derived/delete/hls/master.m3u8",
      hlsBaseObjectKey: "derived/delete/hls",
      hlsQualities: [{ quality: "720p", width: 1280, height: 720 }],
      hlsObjectKeys: [
        "derived/delete/hls/master.m3u8",
        "derived/delete/hls/720p.m3u8",
        "derived/delete/hls/720p-000.ts",
      ],
    });
    await dataSource.getRepository(MediaSegmentEntity).save({
      id: "SEG-UPLOAD-DELETE",
      submissionId: "SUB-UPLOAD-DELETE",
      type: "freeze",
      startSeconds: "2.000",
      endSeconds: "3.000",
      invalid: true,
      details: {},
      evidenceObjectKey: "derived/delete/freeze.jpg",
    });
    await dataSource.getRepository(JobOutboxEntity).save({
      id: "JOB-UPLOAD-DELETE",
      aggregateType: "submission",
      aggregateId: "SUB-UPLOAD-DELETE",
      eventType: "ai.quality.v1",
      payload: { submissionId: "SUB-UPLOAD-DELETE" },
      status: "pending",
      attempts: 0,
      availableAt: new Date(),
    });

    const retention = await request(app.getHttpServer())
      .delete("/api/v1/submissions/SUB-UPLOAD-DELETE/objects")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ reason: "保留期内普通删除" })
      .expect(409);
    expect(retention.body.code).toBe("RETENTION_NOT_EXPIRED");
    expect(storage.deleted).toEqual([]);

    const deleted = await request(app.getHttpServer())
      .delete("/api/v1/submissions/SUB-UPLOAD-DELETE/objects")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ reason: "隐私请求删除", force: true })
      .expect(200);

    expect(storage.deleted).toEqual([
      "uploads/delete/original.mp4",
      "derived/delete/preview.mp4",
      "derived/delete/thumbnail.jpg",
      "derived/delete/hls/master.m3u8",
      "derived/delete/hls/720p.m3u8",
      "derived/delete/hls/720p-000.ts",
      "derived/delete/freeze.jpg",
    ]);
    expect(deleted.body.submission).toMatchObject({
      id: "SUB-UPLOAD-DELETE",
      uploadStatus: "aborted",
      assetStatus: "quarantined",
      storageStatus: "deleted",
      storage: {
        status: "deleted",
        deletedByAccountId: "U-UPLOAD-ADMIN",
        deletedByName: "上传管理员",
        deleteReason: "隐私请求删除",
      },
      deletedObjectKeys: storage.deleted,
    });
    expect(
      await dataSource.getRepository(JobOutboxEntity).countBy({
        aggregateId: "SUB-UPLOAD-DELETE",
      }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "storage_object_delete",
        targetAccountId: "SUB-UPLOAD-DELETE",
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .get("/api/v1/submissions/SUB-UPLOAD-DELETE/preview")
      .set("Cookie", adminCookie)
      .expect(410);
  });

  it("rejects cross-account upload control and size mismatches", async () => {
    const ownerCookie = await login("upload-collector");
    const created = await request(app.getHttpServer())
      .post("/api/v1/submissions/uploads")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", ownerCookie)
      .send({
        fileName: "wrong-size.mov",
        contentType: "video/quicktime",
        sizeBytes: 16_777_216,
        checksumSha256: "b".repeat(64),
        dataUsageAuthorized: true,
        privacyConfirmed: true,
        sensitiveContentConfirmed: true,
        taskId: "TASK-UPLOAD-01",
        taskRequirementsConfirmed: true,
      })
      .expect(201);
    const id = created.body.submission.id as string;

    const otherCookie = await login("upload-other");
    const active = await request(app.getHttpServer())
      .get("/api/v1/submissions/uploads/active")
      .set("Cookie", ownerCookie)
      .expect(200);
    expect(active.body.uploads).toEqual([
      expect.objectContaining({
        submission: expect.objectContaining({
          id,
          fileName: "wrong-size.mov",
          uploadStatus: "uploading",
        }),
        upload: expect.objectContaining({
          uploadId: expect.any(String),
          partCount: 1,
          partSizeBytes: 16_777_216,
        }),
      }),
    ]);
    const otherActive = await request(app.getHttpServer())
      .get("/api/v1/submissions/uploads/active")
      .set("Cookie", otherCookie)
      .expect(200);
    expect(otherActive.body.uploads).toEqual([]);

    await request(app.getHttpServer())
      .post(`/api/v1/submissions/${id}/uploads/parts`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", otherCookie)
      .send({ partNumbers: [1] })
      .expect(403);

    const verified = await request(app.getHttpServer())
      .post(`/api/v1/submissions/${id}/uploads/resume`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", ownerCookie)
      .send({
        fileName: "wrong-size.mov",
        sizeBytes: 16_777_216,
        checksumSha256: "b".repeat(64),
      })
      .expect(201);
    expect(verified.body).toMatchObject({
      submission: { id },
      upload: {
        uploadId: expect.any(String),
        partCount: 1,
        partSizeBytes: 16_777_216,
      },
    });

    await request(app.getHttpServer())
      .post(`/api/v1/submissions/${id}/uploads/resume`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", otherCookie)
      .send({
        fileName: "wrong-size.mov",
        sizeBytes: 16_777_216,
        checksumSha256: "b".repeat(64),
      })
      .expect(403);

    const resumeMismatch = await request(app.getHttpServer())
      .post(`/api/v1/submissions/${id}/uploads/resume`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", ownerCookie)
      .send({
        fileName: "wrong-size.mov",
        sizeBytes: 16_777_216,
        checksumSha256: "c".repeat(64),
      })
      .expect(409);
    expect(resumeMismatch.body.code).toBe("RESUME_FILE_MISMATCH");

    storage.reportedSizeBytes = "10";
    const mismatch = await request(app.getHttpServer())
      .post(`/api/v1/submissions/${id}/uploads/complete`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", ownerCookie)
      .send({ parts: [{ partNumber: 1, etag: "etag" }] })
      .expect(422);
    expect(mismatch.body.code).toBe("OBJECT_SIZE_MISMATCH");

    const saved = await dataSource
      .getRepository(SubmissionEntity)
      .findOneByOrFail({ id });
    expect(saved.processingStatus).toBe("system_failed");
    expect(
      await dataSource.getRepository(JobOutboxEntity).countBy({
        aggregateId: id,
      }),
    ).toBe(0);
  });

  it("recovers a multipart completion after the external object succeeds before database finalization", async () => {
    const id = "SUB-UPLOAD-RECOVER-COMPLETE";
    const objectKey = "uploads/recovery/original.mp4";
    storage.uploads.set("UPLOAD-RECOVER", { objectKey, sizeBytes: "1024" });
    await dataSource.getRepository(SubmissionEntity).save({
      id,
      ownerId: "U-UPLOAD-COLLECTOR",
      teamId: "TEAM-UPLOAD-01",
      originalFileName: "recover-complete.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "1024",
      checksumSha256: "d".repeat(64),
      objectKey,
      multipartUploadId: "UPLOAD-RECOVER",
      multipartCompletionParts: [{ partNumber: 1, etag: "etag-recover" }],
      uploadStatus: "completing",
      processingStatus: "uploading",
    });

    const service = app.get(SubmissionsService);
    expect(await service.reconcileStorageOperations()).toMatchObject({
      completedUploads: 1,
      failures: 0,
    });
    const recovered = await dataSource
      .getRepository(SubmissionEntity)
      .findOneByOrFail({ id });
    expect(recovered).toMatchObject({
      uploadStatus: "uploaded",
      processingStatus: "queued",
      multipartUploadId: null,
      multipartCompletionParts: null,
    });
    expect(
      await dataSource.getRepository(JobOutboxEntity).countBy({
        aggregateId: id,
        eventType: "media.probe.v1",
      }),
    ).toBe(1);
    await service.reconcileStorageOperations();
    expect(
      await dataSource.getRepository(JobOutboxEntity).countBy({
        aggregateId: id,
        eventType: "media.probe.v1",
      }),
    ).toBe(1);
  });

  it("persists object deletion intent and finishes it through reconciliation", async () => {
    const id = "SUB-UPLOAD-RECOVER-DELETE";
    const objectKey = "uploads/recovery/delete.mp4";
    await dataSource.getRepository(SubmissionEntity).save({
      id,
      ownerId: "U-UPLOAD-COLLECTOR",
      teamId: "TEAM-UPLOAD-01",
      originalFileName: "recover-delete.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "1024",
      checksumSha256: "e".repeat(64),
      objectKey,
      uploadStatus: "uploaded",
      processingStatus: "completed",
      storageRetainUntil: new Date("2026-08-01T00:00:00.000Z"),
      uploadedAt: new Date(),
    });
    storage.deleteFailuresRemaining = 1;
    const adminCookie = await login("upload-admin");
    await request(app.getHttpServer())
      .delete(`/api/v1/submissions/${id}/objects`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ reason: "验证删除恢复", force: true })
      .expect(500);

    expect(
      await dataSource.getRepository(SubmissionEntity).findOneByOrFail({ id }),
    ).toMatchObject({
      storageStatus: "delete_pending",
      storageDeleteMode: "objects",
      storageDeleteObjectKeys: [objectKey],
    });
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "storage_object_delete",
        targetAccountId: id,
      }),
    ).toBe(0);

    const service = app.get(SubmissionsService);
    expect(await service.reconcileStorageOperations()).toMatchObject({
      completedDeletes: 1,
      failures: 0,
    });
    expect(
      await dataSource.getRepository(SubmissionEntity).findOneByOrFail({ id }),
    ).toMatchObject({
      storageStatus: "deleted",
      uploadStatus: "aborted",
      storageDeleteMode: null,
      storageDeleteObjectKeys: [],
    });
    expect(storage.deleted).toContain(objectKey);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "storage_object_delete",
        targetAccountId: id,
      }),
    ).toBe(1);
  });

  it("filters and sorts the submission list by time, scene and score", async () => {
    const prompt = await dataSource.getRepository(VideoQualityPromptVersionEntity).save({
      id: "VQP-SORT-01",
      revision: 99,
      systemPrompt: "sort test prompt",
      contentSha256: "a".repeat(64),
      promptVersion: "qwen_video_qc_prompt_v1",
      ruleVersion: "video_qc_v2",
      outputSchema: "video_qc_result_v1",
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      active: false,
      createdByAccountId: "U-UPLOAD-ADMIN",
      createdByName: "上传管理员",
    });
    const base = {
      ownerId: "U-UPLOAD-COLLECTOR",
      teamId: "TEAM-UPLOAD-01",
      contentType: "video/mp4",
      expectedSizeBytes: "1048576",
      checksumSha256: "f".repeat(64),
      uploadStatus: "uploaded",
      processingStatus: "completed",
      uploadedAt: new Date(),
    } as const;
    const seedIds = ["SUB-SORT-01", "SUB-SORT-02", "SUB-SORT-03"];
    await dataSource.getRepository(SubmissionEntity).save([
      {
        ...base,
        id: seedIds[0],
        originalFileName: "sort-a.mp4",
        objectKey: "uploads/sort-a.mp4",
        taskSceneName: "家庭-厨房",
        createdAt: new Date("2026-08-10T02:00:00.000Z"),
      },
      {
        ...base,
        id: seedIds[1],
        originalFileName: "sort-b.mp4",
        objectKey: "uploads/sort-b.mp4",
        taskSceneName: "家庭-客厅",
        createdAt: new Date("2026-08-12T02:00:00.000Z"),
      },
      {
        ...base,
        id: seedIds[2],
        originalFileName: "sort-c.mp4",
        objectKey: "uploads/sort-c.mp4",
        taskSceneName: "家庭-厨房",
        createdAt: new Date("2026-08-14T02:00:00.000Z"),
      },
    ]);
    const scores = ["60.0", "90.0", "75.0"];
    for (let index = 0; index < seedIds.length; index += 1) {
      await dataSource.getRepository(VideoQualityResultEntity).save({
        submissionId: seedIds[index],
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: scores[index],
        settlementRatio: "0.7000",
        invalidDurationMs: "0",
        billableDurationMs: "10000",
        summary: "排序测试",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date(),
      });
    }

    const adminCookie = await login("upload-admin");

    // 质量评分降序：90 → 75 → 60
    const byScore = await request(app.getHttpServer())
      .get("/api/v1/submissions?sortBy=finalScore&sortOrder=desc&pageSize=10")
      .set("Cookie", adminCookie)
      .expect(200);
    const scoreOrder = byScore.body.submissions
      .filter((item: { id: string }) => seedIds.includes(item.id))
      .map((item: { id: string; quality: { finalScore: string } | null }) => ({
        id: item.id,
        score: item.quality?.finalScore ?? null,
      }));
    expect(scoreOrder[0]).toMatchObject({ id: "SUB-SORT-02", score: 90 });
    expect(scoreOrder[1]).toMatchObject({ id: "SUB-SORT-03", score: 75 });
    expect(scoreOrder[2]).toMatchObject({ id: "SUB-SORT-01", score: 60 });

    // 提交时间升序：08-10 → 08-12 → 08-14
    const byTime = await request(app.getHttpServer())
      .get("/api/v1/submissions?sortBy=createdAt&sortOrder=asc&pageSize=10")
      .set("Cookie", adminCookie)
      .expect(200);
    const timeOrder = byTime.body.submissions
      .filter((item: { id: string }) => seedIds.includes(item.id))
      .map((item: { id: string }) => item.id);
    expect(timeOrder).toEqual(["SUB-SORT-01", "SUB-SORT-02", "SUB-SORT-03"]);

    // 场景筛选：家庭-厨房 → 只返回 01 与 03
    const byScene = await request(app.getHttpServer())
      .get("/api/v1/submissions?scene=%E5%AE%B6%E5%BA%AD-%E5%8E%A8%E6%88%BF&pageSize=10")
      .set("Cookie", adminCookie)
      .expect(200);
    const sceneIds = byScene.body.submissions
      .filter((item: { id: string }) => seedIds.includes(item.id))
      .map((item: { id: string }) => item.id);
    expect(sceneIds.sort()).toEqual(["SUB-SORT-01", "SUB-SORT-03"]);

    // 提交时间范围：08-11 之后 → 只返回 02 与 03
    const byDate = await request(app.getHttpServer())
      .get("/api/v1/submissions?dateFrom=2026-08-11&pageSize=10")
      .set("Cookie", adminCookie)
      .expect(200);
    const dateIds = byDate.body.submissions
      .filter((item: { id: string }) => seedIds.includes(item.id))
      .map((item: { id: string }) => item.id);
    expect(dateIds.sort()).toEqual(["SUB-SORT-02", "SUB-SORT-03"]);

    await Promise.all(
      seedIds.map((id) =>
        dataSource.getRepository(SubmissionEntity).delete({ id }),
      ),
    );
  });
});
