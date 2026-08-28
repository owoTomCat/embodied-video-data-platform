import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import request from "supertest";
import type { DataSource } from "typeorm";

import { AuthModule } from "../src/auth/auth.module.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import {
  createDataSource,
  identityEntities,
} from "../src/database/data-source.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { PointCycleAdjustmentEntity } from "../src/database/entities/point-cycle-adjustment.entity.js";
import { PointCycleItemEntity } from "../src/database/entities/point-cycle-item.entity.js";
import { PointRuleVersionEntity } from "../src/database/entities/point-rule-version.entity.js";
import { SubmissionDuplicateCandidateEntity } from "../src/database/entities/submission-duplicate-candidate.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { VideoQualityPromptVersionEntity } from "../src/database/entities/video-quality-prompt-version.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";
import { configureApplication } from "../src/http/configure-application.js";
import { PointsModule } from "../src/points/points.module.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../src/storage/object-storage.port.js";
import { SubmissionsModule } from "../src/submissions/submissions.module.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Point-cycle-password-2026";

class UnusedStorage implements ObjectStoragePort {
  async downloadObject() {
    throw new Error("not used");
  }
  async readObject(): Promise<never> {
    throw new Error("not used");
  }
  async uploadObject() {
    throw new Error("not used");
  }
  async createMultipartUpload() {
    return { uploadId: "unused" };
  }
  async presignUploadPart() {
    return { partNumber: 1, url: "http://unused.local", expiresAt: new Date() };
  }
  async presignDownloadObject() {
    return {
      url: "http://unused.local/download",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    };
  }
  async deleteObject() {
    throw new Error("not used");
  }
  async completeMultipartUpload() {
    return { etag: "unused" };
  }
  async abortMultipartUpload() {
    throw new Error("not used");
  }
  async headObject() {
    return { sizeBytes: "0", etag: "unused", contentType: "video/mp4" };
  }
}

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("point cycle API", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let firstSubmissionId = "SUB-PC-01";

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
      {
        id: "TEAM-PC-01",
        name: "积分一队",
        unitPricePerMinute: "12.0000",
      },
      {
        id: "TEAM-PC-02",
        name: "积分二队",
        unitPricePerMinute: "10.0000",
      },
    ]);
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-PC-ADMIN",
        displayName: "积分管理员",
        username: "point-admin",
        usernameNormalized: "point-admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-PC-LEADER",
        displayName: "积分团长",
        username: "point-leader",
        usernameNormalized: "point-leader",
        passwordHash,
        role: "leader",
        teamId: "TEAM-PC-01",
        status: "active",
      },
      {
        id: "U-PC-COLLECTOR",
        displayName: "积分数采",
        username: "point-collector",
        usernameNormalized: "point-collector",
        passwordHash,
        role: "collector",
        teamId: "TEAM-PC-01",
        status: "active",
      },
      {
        id: "U-PC-OTHER",
        displayName: "二队数采",
        username: "point-other",
        usernameNormalized: "point-other",
        passwordHash,
        role: "collector",
        teamId: "TEAM-PC-02",
        status: "active",
      },
    ]);
    await dataSource.getRepository(SubmissionEntity).save([
      {
        id: firstSubmissionId,
        ownerId: "U-PC-COLLECTOR",
        teamId: "TEAM-PC-01",
        originalFileName: "kitchen-a.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "a".repeat(64),
        objectKey: "uploads/point/kitchen-a.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-PC-02",
        ownerId: "U-PC-COLLECTOR",
        teamId: "TEAM-PC-01",
        originalFileName: "kitchen-b.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "b".repeat(64),
        objectKey: "uploads/point/kitchen-b.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-PC-03",
        ownerId: "U-PC-OTHER",
        teamId: "TEAM-PC-02",
        originalFileName: "other-team.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "c".repeat(64),
        objectKey: "uploads/point/other-team.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-PC-QUARANTINED",
        ownerId: "U-PC-COLLECTOR",
        teamId: "TEAM-PC-01",
        originalFileName: "private-room.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "9".repeat(64),
        objectKey: "uploads/point/private-room.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        assetStatus: "quarantined",
        quarantineReason: "包含隐私信息",
        quarantinedAt: new Date(),
        quarantinedByAccountId: "U-PC-ADMIN",
        quarantinedByName: "积分管理员",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-PC-FAIL",
        ownerId: "U-PC-COLLECTOR",
        teamId: "TEAM-PC-01",
        originalFileName: "failed-score.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "d".repeat(64),
        objectKey: "uploads/point/failed-score.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-PC-QUEUED",
        ownerId: "U-PC-COLLECTOR",
        teamId: "TEAM-PC-01",
        originalFileName: "queued.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "e".repeat(64),
        objectKey: "uploads/point/queued.mp4",
        uploadStatus: "uploaded",
        processingStatus: "queued",
        uploadedAt: new Date(),
      },
    ]);
    await dataSource.getRepository(MediaMetadataEntity).save([
      {
        submissionId: firstSubmissionId,
        durationSeconds: "120.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000",
        sizeBytes: "1000",
        rawProbe: {},
        thumbnailObjectKey: "previews/SUB-PC-01/thumbnail.jpg",
      },
      {
        submissionId: "SUB-PC-02",
        durationSeconds: "60.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000",
        sizeBytes: "1000",
        rawProbe: {},
      },
      {
        submissionId: "SUB-PC-03",
        durationSeconds: "120.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000",
        sizeBytes: "1000",
        rawProbe: {},
      },
      {
        submissionId: "SUB-PC-QUARANTINED",
        durationSeconds: "300.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000",
        sizeBytes: "1000",
        rawProbe: {},
      },
      {
        submissionId: "SUB-PC-FAIL",
        durationSeconds: "90.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000",
        sizeBytes: "1000",
        rawProbe: {},
      },
    ]);
    await dataSource.getRepository(SubmissionDuplicateCandidateEntity).save({
      id: "DUP-PC-02",
      submissionId: "SUB-PC-02",
      candidateSubmissionId: firstSubmissionId,
      similarity: "0.9700",
      status: "candidate",
      details: { source: "test" },
    });
    const prompt = await dataSource
      .getRepository(VideoQualityPromptVersionEntity)
      .save({
        id: "VQP-PC-01",
        revision: 1,
        systemPrompt: "point cycle prompt",
        contentSha256: "f".repeat(64),
        promptVersion: "qwen_video_qc_prompt_v1",
        ruleVersion: "video_qc_v2",
        outputSchema: "video_qc_result_v1",
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        active: true,
        createdByAccountId: "U-PC-ADMIN",
        createdByName: "积分管理员",
      });
    await dataSource.getRepository(VideoQualityResultEntity).save([
      {
        submissionId: firstSubmissionId,
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "80.0",
        settlementRatio: "1.0000",
        invalidDurationMs: "10000",
        billableDurationMs: "110000",
        summary: "通过",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-PC-02",
        status: "review_pending",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "68.0",
        settlementRatio: "0.7000",
        invalidDurationMs: "0",
        billableDurationMs: "60000",
        manualFinalScore: "75.0",
        manualSettlementRatio: "0.8500",
        manualInvalidDurationMs: "5000",
        manualBillableDurationMs: "55000",
        manualReviewReason: "复核后通过",
        manualReviewedByAccountId: "U-PC-ADMIN",
        manualReviewedByName: "积分管理员",
        manualReviewedAt: new Date(),
        reviewRevision: 1,
        summary: "待复核后通过",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: true,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-PC-03",
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "90.0",
        settlementRatio: "1.0000",
        invalidDurationMs: "0",
        billableDurationMs: "120000",
        summary: "二队通过",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-PC-QUARANTINED",
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "95.0",
        settlementRatio: "1.0000",
        invalidDurationMs: "0",
        billableDurationMs: "300000",
        summary: "本来合格但已隔离",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-PC-FAIL",
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "55.0",
        settlementRatio: "0.0000",
        invalidDurationMs: "0",
        billableDurationMs: "90000",
        summary: "不通过",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date(),
      },
    ]);

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
        PointsModule,
      ],
    })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new UnusedStorage())
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

  it("previews eligible submissions before locking", async () => {
    const adminCookie = await login("point-admin");
    const preview = await request(app.getHttpServer())
      .get("/api/v1/point-cycles/preview")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(preview.body.preview).toMatchObject({
      submissionCount: 2,
      effectiveDurationMs: 230000,
      effectiveMinutes: 3.83,
      totalPoints: 0.7,
    });
    expect(preview.body.preview.teamSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          teamId: "TEAM-PC-01",
          submissionCount: 1,
          points: 0.37,
        }),
        expect.objectContaining({
          teamId: "TEAM-PC-02",
          submissionCount: 1,
          points: 0.33,
        }),
      ]),
    );

    const collectorCookie = await login("point-collector");
    await request(app.getHttpServer())
      .get("/api/v1/point-cycles/preview")
      .set("Cookie", collectorCookie)
      .expect(403);
  });

  it("lets admins clear near-duplicate candidates before settlement", async () => {
    const adminCookie = await login("point-admin");
    const cleared = await request(app.getHttpServer())
      .post("/api/v1/submissions/SUB-PC-02/duplicate-candidates/DUP-PC-02/clear")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ reason: "人工确认任务步骤不同" })
      .expect(201);

    expect(cleared.body.submission.duplicateCandidates).toEqual([]);
    expect(
      await dataSource.getRepository(SubmissionDuplicateCandidateEntity).findOneByOrFail({
        id: "DUP-PC-02",
      }),
    ).toMatchObject({
      status: "cleared",
      clearedReason: "人工确认任务步骤不同",
      clearedByAccountId: "U-PC-ADMIN",
    });
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "duplicate_candidate_clear",
      }),
    ).toBe(1);

    const preview = await request(app.getHttpServer())
      .get("/api/v1/point-cycles/preview")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(preview.body.preview).toMatchObject({
      submissionCount: 3,
      effectiveDurationMs: 285000,
      totalPoints: 0.86,
    });

    await dataSource.getRepository(SubmissionDuplicateCandidateEntity).save({
      id: "DUP-PC-02",
      submissionId: "SUB-PC-02",
      candidateSubmissionId: firstSubmissionId,
      similarity: "0.9700",
      status: "candidate",
      details: { source: "test" },
    });
  });

  it("publishes versioned point rules and writes audit", async () => {
    const adminCookie = await login("point-admin");
    const initial = await request(app.getHttpServer())
      .get("/api/v1/point-cycles/rule")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(initial.body.rule).toMatchObject({
      revision: 1,
      version: "POINTS-2026-08",
      defaultPointsPerMinute: 20,
      createdByName: "系统初始化",
    });
    expect(initial.body.rule.coefficientBands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ minScore: 80, maxScore: 100, ratio: 1 }),
        expect.objectContaining({ minScore: 0, maxScore: 59, ratio: 0 }),
      ]),
    );

    const published = await request(app.getHttpServer())
      .put("/api/v1/point-cycles/rule")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        version: "POINTS-2026-09",
        defaultPointsPerMinute: 15,
        coefficientBands: [
          { minScore: 80, maxScore: 100, ratio: 0.5, label: "新优质档" },
          { minScore: 70, maxScore: 79, ratio: 0.4, label: "新合格档" },
          { minScore: 60, maxScore: 69, ratio: 0.3, label: "新基础档" },
          { minScore: 0, maxScore: 59, ratio: 0, label: "不计分" },
        ],
        description: "九月积分规则",
      })
      .expect(200);
    expect(published.body.rule).toMatchObject({
      revision: 2,
      version: "POINTS-2026-09",
      defaultPointsPerMinute: 15,
      coefficientBands: expect.arrayContaining([
        expect.objectContaining({ minScore: 80, ratio: 0.5 }),
      ]),
      description: "九月积分规则",
      createdByName: "积分管理员",
    });

    const rules = await dataSource
      .getRepository(PointRuleVersionEntity)
      .find({ order: { revision: "ASC" } });
    expect(rules.map((rule) => rule.active)).toEqual([false, true]);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "point_rule_publish",
      }),
    ).toBe(1);

    const collectorCookie = await login("point-collector");
    await request(app.getHttpServer())
      .put("/api/v1/point-cycles/rule")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({
        version: "POINTS-2026-10",
        defaultPointsPerMinute: 16,
        coefficientBands: initial.body.rule.coefficientBands,
        description: "无权限规则",
      })
      .expect(403);
  });

  it("locks a point cycle with immutable per-submission snapshots", async () => {
    const adminCookie = await login("point-admin");
    await dataSource
      .getRepository(TeamEntity)
      .update({ id: "TEAM-PC-02" }, { unitPricePerMinute: "0.0000" });
    const created = await request(app.getHttpServer())
      .post("/api/v1/point-cycles")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ businessDate: "2026-08-13" })
      .expect(201);

    expect(created.body.cycle).toMatchObject({
      businessDate: "2026-08-13",
      status: "locked",
      submissionCount: 2,
      totalPoints: 0.43,
      pointRuleRevision: 2,
      pointRuleSnapshot: {
        defaultPointsPerMinute: 15,
        coefficientBands: expect.arrayContaining([
          expect.objectContaining({ minScore: 80, ratio: 0.5 }),
        ]),
      },
      createdByAccountId: "U-PC-ADMIN",
      createdByName: "积分管理员",
    });
    expect(created.body.cycle.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          submissionId: firstSubmissionId,
          thumbnail: {
            url: "http://unused.local/download",
            expiresAt: Date.parse("2030-01-01T00:00:00.000Z"),
            contentType: "image/jpeg",
          },
          finalScore: 80,
          settlementRatio: 0.5,
          effectiveDurationMs: 110000,
          pointsPerMinute: 12,
          points: 0.18,
          qualityRevision: 0,
        }),
      ]),
    );
    expect(
      await dataSource.getRepository(PointCycleItemEntity).count(),
    ).toBe(2);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "point_cycle_lock",
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post("/api/v1/point-cycles")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ businessDate: "2026-08-13" })
      .expect(409);

    // 锁定后不允许再修改质检结果：锁定即最终结算依据
    await request(app.getHttpServer())
      .patch(`/api/v1/submissions/${firstSubmissionId}/quality-review`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        finalScore: 92,
        reason: "锁定后复核调整",
        expectedReviewRevision: 0,
        issues: [],
      })
      .expect(409);

    const lockedItem = await dataSource
      .getRepository(PointCycleItemEntity)
      .findOneByOrFail({ submissionId: firstSubmissionId });
    expect(lockedItem.finalScore).toBe("80.0");
    expect(lockedItem.effectiveDurationMs).toBe("110000");
    expect(lockedItem.points).toBe("0.18");
    expect(
      await dataSource.getRepository(PointCycleAdjustmentEntity).countBy({
        submissionId: firstSubmissionId,
      }),
    ).toBe(0);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "point_cycle_adjustment",
      }),
    ).toBe(0);

    const listed = await request(app.getHttpServer())
      .get("/api/v1/point-cycles")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(listed.body.cycles[0]).toMatchObject({
      id: created.body.cycle.id,
      submissionCount: 2,
      effectiveDurationMs: 230000,
      totalPoints: 0.43,
    });
    expect(listed.body.cycles[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          submissionId: firstSubmissionId,
          finalScore: 80,
          settlementRatio: 0.5,
          effectiveDurationMs: 110000,
          points: 0.18,
        }),
      ]),
    );

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/point-cycles/${created.body.cycle.id}`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(fetched.body.cycle).toMatchObject({
      effectiveDurationMs: 230000,
      totalPoints: 0.43,
    });
    expect(fetched.body.cycle.items).toEqual(listed.body.cycles[0].items);

    const exported = await request(app.getHttpServer())
      .get(`/api/v1/point-cycles/${created.body.cycle.id}/export.csv`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(exported.headers["content-type"]).toContain("text/csv");
    expect(exported.text).toContain(
      "cycle_id,business_date,submission_id,file_name,team_id,team_name",
    );
    expect(exported.text).toContain("SUB-PC-01,kitchen-a.mp4");
    expect(exported.text).toContain("SUB-PC-03,other-team.mp4");
    expect(exported.text).not.toContain("SUB-PC-02,kitchen-b.mp4");
    const firstRow = exported.text
      .split("\n")
      .find((row) => row.includes("SUB-PC-01,kitchen-a.mp4"));
    expect(firstRow?.split(",").slice(11, 16)).toEqual([
      "80.0",
      "0.5000",
      "1.83",
      "12.0000",
      "0.18",
    ]);
  });

  it("scopes locked cycles for leaders and collectors", async () => {
    const leaderCookie = await login("point-leader");
    const leader = await request(app.getHttpServer())
      .get("/api/v1/point-cycles")
      .set("Cookie", leaderCookie)
      .expect(200);
    expect(leader.body.cycles).toHaveLength(1);
    expect(leader.body.cycles[0]).toMatchObject({
      submissionCount: 1,
      effectiveDurationMs: 110000,
      totalPoints: 0.18,
    });
    expect(
      leader.body.cycles[0].items.map((item: { teamId: string }) => item.teamId),
    ).toEqual(["TEAM-PC-01"]);
    const leaderExport = await request(app.getHttpServer())
      .get(`/api/v1/point-cycles/${leader.body.cycles[0].id}/export.csv`)
      .set("Cookie", leaderCookie)
      .expect(200);
    expect(leaderExport.text).toContain("SUB-PC-01,kitchen-a.mp4");
    expect(leaderExport.text).not.toContain("SUB-PC-03");
    expect(
      leaderExport.text
        .split("\n")
        .find((row) => row.includes("SUB-PC-01,kitchen-a.mp4"))
        ?.split(",")
        .slice(11, 16),
    ).toEqual(["80.0", "0.5000", "1.83", "12.0000", "0.18"]);

    const leaderGet = await request(app.getHttpServer())
      .get(`/api/v1/point-cycles/${leader.body.cycles[0].id}`)
      .set("Cookie", leaderCookie)
      .expect(200);
    expect(leaderGet.body.cycle).toMatchObject({
      submissionCount: 1,
      effectiveDurationMs: 110000,
      totalPoints: 0.18,
    });
    expect(leaderGet.body.cycle.items).toEqual([
      expect.objectContaining({
        submissionId: firstSubmissionId,
        finalScore: 80,
        points: 0.18,
      }),
    ]);

    const collectorCookie = await login("point-collector");
    const collector = await request(app.getHttpServer())
      .get("/api/v1/point-cycles")
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(collector.body.cycles[0]).toMatchObject({
      submissionCount: 1,
      effectiveDurationMs: 110000,
      totalPoints: 0.18,
    });
    expect(collector.body.cycles[0].items).toEqual([
      expect.objectContaining({
        submissionId: firstSubmissionId,
        finalScore: 80,
        settlementRatio: 0.5,
        points: 0.18,
      }),
    ]);
    const collectorGet = await request(app.getHttpServer())
      .get(`/api/v1/point-cycles/${collector.body.cycles[0].id}`)
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(collectorGet.body.cycle).toMatchObject({
      submissionCount: 1,
      effectiveDurationMs: 110000,
      totalPoints: 0.18,
    });
    const collectorExport = await request(app.getHttpServer())
      .get(
        `/api/v1/point-cycles/${collector.body.cycles[0].id}/export.csv`,
      )
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(collectorExport.text).toContain("SUB-PC-01,kitchen-a.mp4");
    expect(collectorExport.text).not.toContain("SUB-PC-03");
    expect(
      collectorExport.text
        .split("\n")
        .find((row) => row.includes("SUB-PC-01,kitchen-a.mp4"))
        ?.split(",")
        .slice(11, 16),
    ).toEqual(["80.0", "0.5000", "1.83", "12.0000", "0.18"]);

    const otherCookie = await login("point-other");
    const other = await request(app.getHttpServer())
      .get(`/api/v1/point-cycles/${leader.body.cycles[0].id}`)
      .set("Cookie", otherCookie)
      .expect(200);
    expect(other.body.cycle).toMatchObject({
      submissionCount: 1,
      effectiveDurationMs: 120000,
      totalPoints: 0.25,
    });
    expect(other.body.cycle.items).toEqual([
      expect.objectContaining({ submissionId: "SUB-PC-03" }),
    ]);
  });

  it("credits wallets on lock, settles after due time and records withdrawals", async () => {
    const adminCookie = await login("point-admin");
    const collectorCookie = await login("point-collector");
    const leaderCookie = await login("point-leader");

    // 前序用例已锁定周期：SUB-PC-01（积分数采 0.18 元）、SUB-PC-03（二队数采 0.25 元）
    const listed = await request(app.getHttpServer())
      .get("/api/v1/point-cycles")
      .set("Cookie", adminCookie)
      .expect(200);
    const cycle = listed.body.cycles[0] as { id: string; status: string; settleDueAt: number | null };
    expect(cycle.status).toBe("locked");
    expect(cycle.settleDueAt).toBeGreaterThan(Date.now());

    // 锁定即入钱包「结算中」
    const before = await request(app.getHttpServer())
      .get("/api/v1/wallet/me")
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(before.body.balance).toMatchObject({
      ownerName: "积分数采",
      totalBalance: 0.18,
      settlingBalance: 0.18,
      availableBalance: 0,
      withdrawnBalance: 0,
      cumulativeWithdrawn: 0,
    });
    const lockTx = before.body.transactions as Array<{ type: string }>;
    expect(lockTx[0]?.type).toBe("lock");

    // 手动触发结算：结算中 → 可提现
    const settled = await request(app.getHttpServer())
      .post(`/api/v1/point-cycles/${cycle.id}/settle`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(settled.body.cycle.status).toBe("settled");
    expect(settled.body.cycle.settledAt).toBeGreaterThan(0);

    const after = await request(app.getHttpServer())
      .get("/api/v1/wallet/me")
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(after.body.balance).toMatchObject({
      totalBalance: 0.18,
      settlingBalance: 0,
      availableBalance: 0.18,
    });
    const txTypes = (after.body.transactions as Array<{ type: string }>).map(
      (item) => item.type,
    );
    expect(txTypes.slice(0, 2)).toEqual(["settle", "lock"]);

    // 提现：可提现 → 已提现 / 累计提现
    const withdrawn = await request(app.getHttpServer())
      .post("/api/v1/wallet/withdraw")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ amount: 0.1, remark: "测试提现" })
      .expect(200);
    expect(withdrawn.body.balance).toMatchObject({
      totalBalance: 0.18,
      settlingBalance: 0,
      availableBalance: 0.08,
      withdrawnBalance: 0.1,
      cumulativeWithdrawn: 0.1,
    });

    // 超额提现被拒绝
    await request(app.getHttpServer())
      .post("/api/v1/wallet/withdraw")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ amount: 999 })
      .expect(409);

    // 钱包列表范围：管理员全平台 / 团长本队
    const adminWallets = await request(app.getHttpServer())
      .get("/api/v1/wallet")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(
      (adminWallets.body.wallets as Array<{ ownerName: string; totalBalance: number }>).map(
        (item) => [item.ownerName, item.totalBalance],
      ),
    ).toEqual(expect.arrayContaining([
      ["积分数采", 0.18],
      ["二队数采", 0.25],
    ]));

    const leaderWallets = await request(app.getHttpServer())
      .get("/api/v1/wallet")
      .set("Cookie", leaderCookie)
      .expect(200);
    const leaderNames = (leaderWallets.body.wallets as Array<{ ownerName: string }>).map(
      (item) => item.ownerName,
    );
    expect(leaderNames).toContain("积分数采");
    expect(leaderNames).not.toContain("二队数采");
  });
});
