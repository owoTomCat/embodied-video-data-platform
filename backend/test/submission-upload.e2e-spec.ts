import type { INestApplication } from "@nestjs/common";
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
import { JobOutboxEntity } from "../src/database/entities/job-outbox.entity.js";
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

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Submission-upload-password-2026";

class RecordingObjectStorage implements ObjectStoragePort {
  uploads = new Map<string, { objectKey: string; sizeBytes: string }>();
  completed: Array<{ uploadId: string; parts: number[] }> = [];
  aborted: string[] = [];
  reportedSizeBytes = "33554432";

  async downloadObject() {
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

  async completeMultipartUpload(input: {
    objectKey: string;
    uploadId: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }) {
    this.completed.push({
      uploadId: input.uploadId,
      parts: input.parts.map((part) => part.partNumber),
    });
    return { etag: "completed-etag" };
  }

  async headObject(input: { objectKey: string }) {
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
    expect(
      await dataSource.getRepository(JobOutboxEntity).countBy({
        aggregateId: id,
        eventType: "media.probe.v1",
      }),
    ).toBe(1);
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
        promptVersion: "qwen_video_qc_prompt_v2_traceable",
        ruleVersion: "video_qc_v2_traceable",
        outputSchema: "video_qc_result_v2",
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        active: true,
        createdByAccountId: "U-UPLOAD-ADMIN",
        createdByName: "上传管理员",
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
      })
      .expect(201);
    const id = created.body.submission.id as string;

    const otherCookie = await login("upload-other");
    await request(app.getHttpServer())
      .post(`/api/v1/submissions/${id}/uploads/parts`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", otherCookie)
      .send({ partNumbers: [1] })
      .expect(403);

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
});
