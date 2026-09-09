import type { INestApplication } from "@nestjs/common";
import { randomBytes } from "node:crypto";
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
import { PointCycleEntity } from "../src/database/entities/point-cycle.entity.js";
import { WalletBalanceEntity, WalletTransactionEntity } from "../src/database/entities/wallet.entity.js";
import { PointCyclesService, nextSettlementAt } from "../src/points/point-cycles.service.js";
import { SettlementSchedulerService } from "../src/points/settlement-scheduler.service.js";
import { NextDaySettlement2026092100001 } from "../src/database/migrations/202609210001-next-day-settlement.js";
import { WalletService } from "../src/wallet/wallet.service.js";
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
    vi.stubEnv("PAYOUT_RECIPIENT_KEY", randomBytes(32).toString("hex"));
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
        completedAt: new Date("2030-01-01T15:59:00.000Z"),
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
        manualReviewedAt: new Date("2030-01-01T15:59:00.000Z"),
        reviewRevision: 1,
        summary: "待复核后通过",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: true,
        reviewReasons: [],
        normalizedResult: {},
        rawModelResult: {},
        completedAt: new Date("2030-01-01T15:59:00.000Z"),
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
        completedAt: new Date("2030-01-01T15:59:00.000Z"),
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
        completedAt: new Date("2030-01-01T15:59:00.000Z"),
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
        completedAt: new Date("2030-01-01T15:59:00.000Z"),
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
      .overrideProvider(SettlementSchedulerService)
      .useValue({ onModuleInit() {}, onModuleDestroy() {} })
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
    vi.unstubAllEnvs();
  });

  async function cloneSubmission(id: string, approvedAt = new Date("2030-01-01T15:59:00.000Z")) {
    const source = await dataSource.getRepository(SubmissionEntity).findOneByOrFail({ id: firstSubmissionId });
    await dataSource.getRepository(SubmissionEntity).save({ ...source, id, originalFileName: `${id}.mp4`, objectKey: `uploads/${id}.mp4` });
    const quality = await dataSource.getRepository(VideoQualityResultEntity).findOneByOrFail({ submissionId: firstSubmissionId });
    await dataSource.getRepository(VideoQualityResultEntity).save({ ...quality, submissionId: id, completedAt: approvedAt, manualReviewedAt: null });
    const metadata = await dataSource.getRepository(MediaMetadataEntity).findOneByOrFail({ submissionId: firstSubmissionId });
    await dataSource.getRepository(MediaMetadataEntity).save({ ...metadata, submissionId: id });
    return id;
  }

  async function cycleFor(submissionId: string) {
    const item = await dataSource.getRepository(PointCycleItemEntity).findOneByOrFail({ submissionId });
    return dataSource.getRepository(PointCycleEntity).findOneByOrFail({ id: item.cycleId });
  }

  it.each([
    ["2030-01-01T15:59:59.999Z", "2030-01-01T18:00:00.000Z"],
    ["2030-01-01T16:00:00.000Z", "2030-01-02T18:00:00.000Z"],
    ["2030-01-01T17:59:00.000Z", "2030-01-02T18:00:00.000Z"],
    ["2030-01-01T18:00:00.000Z", "2030-01-02T18:00:00.000Z"],
    ["2030-12-31T15:59:59.999Z", "2030-12-31T18:00:00.000Z"],
  ])("uses next Shanghai calendar day, not 24h: %s", (approval, due) => {
    expect(nextSettlementAt(new Date(approval)).toISOString()).toBe(due);
  });

  it("backfills eligible snapshots without an active administrator or duplicate credit", async () => {
    await dataSource.getRepository(UserEntity).update({ id: "U-PC-ADMIN" }, { status: "disabled" });
    try {
      expect(await app.get(PointCyclesService).reconcileAccruals()).toBe(2);
      expect(await app.get(PointCyclesService).reconcileAccruals()).toBe(0);
      const balance = await app.get(WalletService).getWallet("U-PC-COLLECTOR");
      expect(balance).toMatchObject({ totalBalance: 0.37, settlingBalance: 0.37, availableBalance: 0, nextSettlementAt: Date.parse("2030-01-01T18:00:00.000Z") });
      expect(await dataSource.getRepository(PointCycleItemEntity).count()).toBe(2);
      expect((await cycleFor(firstSubmissionId)).createdByAccountId).toBeNull();
      const excluded = await dataSource.getRepository(PointCycleItemEntity).find();
      expect(excluded.map((item) => item.submissionId).sort()).toEqual([firstSubmissionId, "SUB-PC-03"].sort());
    } finally {
      await dataSource.getRepository(UserEntity).update({ id: "U-PC-ADMIN" }, { status: "active" });
    }
  });

  it("credits immediately when the last duplicate exclusion is cleared", async () => {
    const cookie = await login("point-admin");
    await request(app.getHttpServer()).post("/api/v1/submissions/SUB-PC-02/duplicate-candidates/DUP-PC-02/clear")
      .set("Origin", WEB_ORIGIN).set("Cookie", cookie).send({ reason: "人工确认任务步骤不同" }).expect(201);
    expect(await app.get(WalletService).getWallet("U-PC-COLLECTOR")).toMatchObject({ settlingBalance: 0.53 });
    const cycle = await cycleFor("SUB-PC-02");
    expect(cycle.settleDueAt?.toISOString()).toBe("2030-01-01T18:00:00.000Z");
  });

  it("manual approval and credit commit together and expose file/due evidence", async () => {
    const cookie = await login("point-admin");
    await request(app.getHttpServer()).patch("/api/v1/submissions/SUB-PC-FAIL/quality-review")
      .set("Origin", WEB_ORIGIN).set("Cookie", cookie)
      .send({ finalScore: 90, expectedReviewRevision: 0, reason: "人工复核通过", issues: [] }).expect(200);
    const quality = await dataSource.getRepository(VideoQualityResultEntity).findOneByOrFail({ submissionId: "SUB-PC-FAIL" });
    const cycle = await cycleFor("SUB-PC-FAIL");
    expect(cycle.settleDueAt).toEqual(nextSettlementAt(quality.manualReviewedAt!));
    const collector = await login("point-collector");
    const wallet = await request(app.getHttpServer()).get("/api/v1/wallet/me").set("Cookie", collector).expect(200);
    expect(wallet.body.balance).toMatchObject({ settlingBalance: 0.83, availableBalance: 0 });
    expect(wallet.body.transactions).toEqual(expect.arrayContaining([expect.objectContaining({
      submissionId: "SUB-PC-FAIL", type: "lock", amount: 0.3, fileName: "failed-score.mp4", settleDueAt: cycle.settleDueAt!.getTime(),
    })]));
    await request(app.getHttpServer()).patch("/api/v1/submissions/SUB-PC-FAIL/quality-review")
      .set("Origin", WEB_ORIGIN).set("Cookie", cookie)
      .send({ finalScore: 91, expectedReviewRevision: 1, reason: "不得覆盖已入账快照", issues: [] }).expect(409);
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


  it("retains scoped read/export while removing every manual availability bypass", async () => {
    const admin = await login("point-admin");
    const cycle = await cycleFor(firstSubmissionId);
    await request(app.getHttpServer()).post("/api/v1/point-cycles").set("Origin", WEB_ORIGIN).set("Cookie", admin).send({}).expect(404);
    await request(app.getHttpServer()).get("/api/v1/point-cycles/preview").set("Cookie", admin).expect(404);
    await request(app.getHttpServer()).post(`/api/v1/point-cycles/${cycle.id}/settle`).set("Origin", WEB_ORIGIN).set("Cookie", admin).expect(404);
    await expect(app.get(PointCyclesService).settleCycle(cycle.id, new Date(cycle.settleDueAt!.getTime() - 1))).rejects.toMatchObject({ code: "SETTLEMENT_NOT_DUE" });
    const collector = await login("point-collector");
    const exported = await request(app.getHttpServer()).get(`/api/v1/point-cycles/${cycle.id}/export.csv`).set("Cookie", collector).expect(200);
    expect(exported.text).toContain("SUB-PC-01,kitchen-a.mp4");
    expect(exported.text).not.toContain("SUB-PC-03");
    const other = await login("point-other");
    await request(app.getHttpServer()).get(`/api/v1/point-cycles/${cycle.id}`).set("Cookie", other).expect(404);
    const listed = await request(app.getHttpServer()).get("/api/v1/point-cycles").set("Cookie", collector).expect(200);
    expect(listed.body.cycles.flatMap((row: { items: Array<{ ownerId: string }> }) => row.items).every((item: { ownerId: string }) => item.ownerId === "U-PC-COLLECTOR")).toBe(true);
  });

  it("adjusts pending balance by delta and settles the effective snapshot exactly once", async () => {
    const cycle = await cycleFor(firstSubmissionId);
    const item = await dataSource.getRepository(PointCycleItemEntity).findOneByOrFail({ submissionId: firstSubmissionId });
    const before = await app.get(WalletService).getWallet(item.ownerId);
    const admin = await login("point-admin");
    await request(app.getHttpServer()).post(`/api/v1/point-cycles/${cycle.id}/items/${item.id}/adjust`)
      .set("Origin", WEB_ORIGIN).set("Cookie", admin).send({ nextFinalScore: 70, reason: "纠正评分" }).expect(201);
    const adjustment = await dataSource.getRepository(PointCycleAdjustmentEntity).findOneByOrFail({ pointCycleItemId: item.id });
    const amount = Number(adjustment.nextPoints);
    expect(amount).toBe(0.31); // Original default coefficient snapshot, not the newly published 0.4.
    expect((await app.get(WalletService).getWallet(item.ownerId)).settlingBalance).toBeCloseTo(before.settlingBalance + Number(adjustment.pointsDelta), 2);
    expect((await dataSource.getRepository(PointCycleItemEntity).findOneByOrFail({ id: item.id })).points).toBe("0.37");
    const service = app.get(PointCyclesService);
    const result = await Promise.all([service.settleCycle(cycle.id, cycle.settleDueAt!), service.settleCycle(cycle.id, cycle.settleDueAt!)]);
    expect(result.sort()).toEqual([false, true]);
    expect(await app.get(WalletService).getWallet(item.ownerId)).toMatchObject({ availableBalance: 0.31 });
    expect(await dataSource.getRepository(WalletTransactionEntity).countBy({ cycleId: cycle.id, type: "settle" })).toBe(1);
    await dataSource.getRepository(SubmissionEntity).update({ id: item.submissionId }, { assetStatus: "quarantined" });
    await service.settleCycle(cycle.id, cycle.settleDueAt!);
    expect(await app.get(WalletService).getWallet(item.ownerId)).toMatchObject({ availableBalance: 0.31 });
    await request(app.getHttpServer()).post(`/api/v1/point-cycles/${cycle.id}/items/${item.id}/adjust`)
      .set("Origin", WEB_ORIGIN).set("Cookie", admin).send({ nextFinalScore: 0, reason: "不可暗扣已可用收入" }).expect(409);
    await dataSource.getRepository(SubmissionEntity).update({ id: item.submissionId }, { assetStatus: "active" });
  });

  it("serializes an adjustment racing settlement without a foreign-key deadlock", async () => {
    const id = await cloneSubmission("SUB-PC-ADJUST-SETTLE");
    const service = app.get(PointCyclesService);
    await service.accrueSubmission(id);
    const cycle = await cycleFor(id);
    const item = await dataSource.getRepository(PointCycleItemEntity).findOneByOrFail({ submissionId: id });
    const before = await app.get(WalletService).getWallet(item.ownerId);
    const admin = await login("point-admin");
    const blocker = dataSource.createQueryRunner();
    await blocker.connect();
    await blocker.startTransaction();
    let adjustment: Promise<request.Response> | undefined;
    let settlement: Promise<PromiseSettledResult<boolean>[]> | undefined;
    try {
      await blocker.query("SELECT id FROM point_cycles WHERE id = $1 FOR UPDATE", [cycle.id]);
      const waitForBlocked = async (count: number) => {
        await vi.waitFor(async () => {
          const [row] = await dataSource.query(
            "SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
          );
          expect(row.count).toBe(count);
        }, { timeout: 5_000 });
      };
      adjustment = request(app.getHttpServer()).post(`/api/v1/point-cycles/${cycle.id}/items/${item.id}/adjust`)
        .set("Origin", WEB_ORIGIN).set("Cookie", admin)
        .send({ nextFinalScore: 70, reason: "与自动结算并发修正" }).then(response => response);
      await waitForBlocked(1);
      settlement = Promise.allSettled([service.settleCycle(cycle.id, cycle.settleDueAt!)]);
      await waitForBlocked(2);
      await blocker.commitTransaction();
      expect((await adjustment).status).toBe(201);
      expect(await settlement).toEqual([{ status: "fulfilled", value: true }]);
      const correction = await dataSource.getRepository(PointCycleAdjustmentEntity).findOneByOrFail({ submissionId: id });
      expect((await app.get(WalletService).getWallet(item.ownerId)).availableBalance)
        .toBeCloseTo(before.availableBalance + Number(correction.nextPoints), 2);
      expect(await dataSource.getRepository(WalletTransactionEntity).countBy({ cycleId: cycle.id, type: "settle" })).toBe(1);
    } finally {
      if (blocker.isTransactionActive) await blocker.rollbackTransaction();
      await blocker.release();
      await Promise.allSettled([adjustment, settlement]);
    }
  });

  it.each([["linked", 0.17], ["unversioned", 0.33]] as const)(
    "preserves %s legacy pricing when correcting duration without a snapshot",
    async (kind, expectedPoints) => {
      const id = await cloneSubmission(`SUB-PC-LEGACY-PRICING-${kind}`);
      const service = app.get(PointCyclesService);
      await service.accrueSubmission(id);
      const cycle = await cycleFor(id);
      await dataSource.getRepository(PointCycleEntity).update({ id: cycle.id }, {
        pointRuleSnapshot: null,
        ...(kind === "unversioned" ? { pointRuleVersionId: null, pointRuleRevision: null } : {}),
      });
      const item = await dataSource.getRepository(PointCycleItemEntity).findOneByOrFail({ submissionId: id });
      const before = await app.get(WalletService).getWallet(item.ownerId);
      const admin = await login("point-admin");
      await request(app.getHttpServer()).post(`/api/v1/point-cycles/${cycle.id}/items/${item.id}/adjust`)
        .set("Origin", WEB_ORIGIN).set("Cookie", admin)
        .send({ nextInvalidDurationMs: 20_000, reason: "历史时长修正" }).expect(201);
      const correction = await dataSource.getRepository(PointCycleAdjustmentEntity).findOneByOrFail({ submissionId: id });
      expect(Number(correction.nextPoints)).toBe(expectedPoints);
      await service.settleCycle(cycle.id, cycle.settleDueAt!);
      expect((await app.get(WalletService).getWallet(item.ownerId)).availableBalance)
        .toBeCloseTo(before.availableBalance + expectedPoints, 2);
    },
  );

  it("serializes multi-connection callbacks and concurrent earnings for one wallet", async () => {
    const id = await cloneSubmission("SUB-PC-CONCURRENT");
    const otherId = await cloneSubmission("SUB-PC-CONCURRENT-OTHER");
    const service = app.get(PointCyclesService);
    const before = await app.get(WalletService).getWallet("U-PC-COLLECTOR");
    const results = await Promise.all([
      ...Array.from({ length: 4 }, () => service.accrueSubmission(id)),
      // A different DataSource/connection executes the real transactional callback too.
      dataSource.transaction((manager) => service.accrueSubmission(id, manager)),
      dataSource.transaction((manager) => service.accrueSubmission(otherId, manager)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(await dataSource.getRepository(PointCycleItemEntity).countBy({ submissionId: id })).toBe(1);
    const items = await dataSource.getRepository(PointCycleItemEntity).find();
    const added = items.filter((item) => [id, otherId].includes(item.submissionId)).reduce((sum, item) => sum + Number(item.points), 0);
    expect((await app.get(WalletService).getWallet("U-PC-COLLECTOR")).settlingBalance).toBeCloseTo(before.settlingBalance + added, 2);
  });

  it("serializes settlement with withdrawal reservation and preserves manual paid history", async () => {
    const cycle = await cycleFor("SUB-PC-CONCURRENT-OTHER");
    const before = await app.get(WalletService).getWallet("U-PC-COLLECTOR");
    const collector = await login("point-collector");
    const admin = await login("point-admin");
    const [, withdrawn] = await Promise.all([
      app.get(PointCyclesService).settleCycle(cycle.id, cycle.settleDueAt!),
      request(app.getHttpServer()).post("/api/v1/wallet/withdraw").set("Origin", WEB_ORIGIN).set("Cookie", collector)
        .send({ amount: 0.1, idempotencyKey: "point-withdrawal", method: "alipay", account: "point@example.test", name: "测试收款人" }).expect(200),
    ]);
    expect(await app.get(WalletService).getWallet("U-PC-COLLECTOR")).toMatchObject({
      availableBalance: Math.round((before.availableBalance + Number(cycle.totalPoints) - 0.1) * 100) / 100,
      reservedBalance: 0.1, withdrawnBalance: 0,
    });
    const batch = await request(app.getHttpServer()).post("/api/v1/wallet/withdrawal-batches").set("Origin", WEB_ORIGIN).set("Cookie", admin)
      .send({ ids: [withdrawn.body.request.id] }).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/wallet/withdrawal-batches/${batch.body.batchId}/export`).set("Origin", WEB_ORIGIN).set("Cookie", admin).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/wallet/withdrawals/${withdrawn.body.request.id}/status`).set("Origin", WEB_ORIGIN).set("Cookie", admin)
      .send({ status: "paid", transferReference: "point-manual-transfer", paidAt: new Date().toISOString() }).expect(200);
    const paid = await app.get(WalletService).getWallet("U-PC-COLLECTOR");
    expect(paid).toMatchObject({ reservedBalance: 0, withdrawnBalance: 0.1, cumulativeWithdrawn: 0.1, totalBalance: before.totalBalance });
    await app.get(PointCyclesService).settleCycle(cycle.id, cycle.settleDueAt!);
    expect(await app.get(WalletService).getWallet("U-PC-COLLECTOR")).toEqual(paid);
    await request(app.getHttpServer()).post("/api/v1/wallet/withdraw").set("Origin", WEB_ORIGIN).set("Cookie", collector)
      .send({ amount: 999, idempotencyKey: "point-insufficient", method: "alipay", account: "point@example.test", name: "测试收款人" }).expect(409);
  });

  it("rejects insufficient pending balances instead of clipping and minting availability", async () => {
    const id = await cloneSubmission("SUB-PC-INSUFFICIENT");
    await app.get(PointCyclesService).accrueSubmission(id);
    const cycle = await cycleFor(id);
    const repository = dataSource.getRepository(WalletBalanceEntity);
    const original = await repository.findOneByOrFail({ ownerId: "U-PC-COLLECTOR" });
    await repository.update({ ownerId: original.ownerId }, {
      settlingBalance: "0.00", totalBalance: (Number(original.totalBalance) - Number(original.settlingBalance)).toFixed(2),
    });
    try {
      await expect(app.get(PointCyclesService).settleCycle(cycle.id, cycle.settleDueAt!)).rejects.toMatchObject({ code: "ACCOUNTING_INCONSISTENCY" });
      expect((await cycleFor(id)).status).toBe("locked");
      expect(await dataSource.getRepository(WalletTransactionEntity).countBy({ cycleId: cycle.id, type: "settle" })).toBe(0);
    } finally {
      await repository.save(original);
    }
  });

  it("uses serialized correction order rather than transaction timestamps", async () => {
    const id = await cloneSubmission("SUB-PC-ADJUST-ORDER");
    const service = app.get(PointCyclesService);
    await service.accrueSubmission(id);
    const cycle = await cycleFor(id);
    const item = await dataSource.getRepository(PointCycleItemEntity).findOneByOrFail({ submissionId: id });
    const admin = await login("point-admin");
    for (const score of [70, 60]) {
      await request(app.getHttpServer()).post(`/api/v1/point-cycles/${cycle.id}/items/${item.id}/adjust`)
        .set("Origin", WEB_ORIGIN).set("Cookie", admin).send({ nextFinalScore: score, reason: "复核修正" }).expect(201);
    }
    const corrections = await dataSource.getRepository(PointCycleAdjustmentEntity).find({ where: { submissionId: id }, order: { sequence: "ASC" } });
    // A transaction can begin before the transaction whose row lock it later acquires.
    await dataSource.getRepository(PointCycleAdjustmentEntity).update({ id: corrections[0]!.id }, { createdAt: new Date("2040-01-01T00:00:00Z") });
    const before = await app.get(WalletService).getWallet(item.ownerId);
    await service.settleCycle(cycle.id, cycle.settleDueAt!);
    expect((await app.get(WalletService).getWallet(item.ownerId)).availableBalance).toBeCloseTo(before.availableBalance + Number(corrections[1]!.nextPoints), 2);
  });

  it.each(["unavailable", "duplicate", "nonfinal"])("excludes %s records and reverses disqualification before availability", async (kind) => {
    const id = await cloneSubmission(`SUB-PC-REVOKE-${kind}`);
    const service = app.get(PointCyclesService);
    const invalidate = async () => {
      if (kind === "unavailable") await dataSource.getRepository(SubmissionEntity).update({ id }, { storageStatus: "delete_pending" });
      if (kind === "nonfinal") await dataSource.getRepository(VideoQualityResultEntity).update({ submissionId: id }, { status: "review_pending", manualFinalScore: null });
      if (kind === "duplicate") await dataSource.getRepository(SubmissionDuplicateCandidateEntity).save({ id: `DUP-${kind}`, submissionId: id, candidateSubmissionId: firstSubmissionId, similarity: "0.9900", status: "candidate", details: {} });
    };
    await invalidate();
    expect(await service.accrueSubmission(id)).toBe(false);
    await dataSource.getRepository(SubmissionEntity).update({ id }, { storageStatus: "available" });
    await dataSource.getRepository(VideoQualityResultEntity).update({ submissionId: id }, { status: "scored" });
    await dataSource.getRepository(SubmissionDuplicateCandidateEntity).delete({ submissionId: id });
    await service.accrueSubmission(id);
    const cycle = await cycleFor(id);
    const before = await app.get(WalletService).getWallet("U-PC-COLLECTOR");
    await invalidate();
    await service.settleCycle(cycle.id, cycle.settleDueAt!);
    const after = await app.get(WalletService).getWallet("U-PC-COLLECTOR");
    expect(after.availableBalance).toBe(before.availableBalance);
    expect(after.totalBalance).toBeCloseTo(before.totalBalance - Number(cycle.totalPoints), 2);
    const reversal = await dataSource.getRepository(PointCycleAdjustmentEntity).findOneByOrFail({ submissionId: id });
    expect(Number(reversal.pointsDelta)).toBe(-Number(cycle.totalPoints));
    expect(reversal.nextPoints).toBe("0.00");
    expect(await service.settleCycle(cycle.id, cycle.settleDueAt!)).toBe(false);
  });

  it("recovers a missed historical approval and its overdue settlement on startup", async () => {
    const id = await cloneSubmission("SUB-PC-HISTORICAL", new Date("2020-01-01T15:59:00.000Z"));
    const scheduler = new SettlementSchedulerService(app.get(PointCyclesService));
    scheduler.onModuleInit();
    try {
      await vi.waitFor(async () => {
        const cycle = await cycleFor(id);
        expect(cycle.status).toBe("settled");
        expect(cycle.settleDueAt?.toISOString()).toBe("2020-01-01T18:00:00.000Z");
      }, { timeout: 10_000 });
    } finally {
      scheduler.onModuleDestroy();
    }
    expect(await dataSource.getRepository(WalletTransactionEntity).countBy({ submissionId: id, type: "lock" })).toBe(1);
    await app.get(PointCyclesService).reconcileAccruals();
    expect(await dataSource.getRepository(WalletTransactionEntity).countBy({ submissionId: id, type: "lock" })).toBe(1);
  });

  it("migrates old pending due dates without changing paid cycles, wallet balances or credits", async () => {
    const cycle = await cycleFor("SUB-PC-CONCURRENT");
    await dataSource.getRepository(PointCycleEntity).update({ id: cycle.id }, { settleDueAt: new Date("2040-01-01T00:00:00Z") });
    const legacyA = await cloneSubmission("SUB-PC-LEGACY-A", new Date("2030-01-01T15:59:00Z"));
    const legacyB = await cloneSubmission("SUB-PC-LEGACY-B", new Date("2030-01-02T15:59:00Z"));
    const template = await dataSource.getRepository(PointCycleItemEntity).findOneByOrFail({ submissionId: "SUB-PC-CONCURRENT" });
    await dataSource.transaction(async (manager) => {
      await manager.getRepository(PointCycleEntity).save({ ...cycle, id: "PC-LEGACY-GROUP", submissionCount: 2,
        effectiveDurationMs: String(Number(template.effectiveDurationMs) * 2), totalPoints: (Number(template.points) * 2).toFixed(2),
        settleDueAt: new Date("2040-01-01T00:00:00Z") });
      await manager.getRepository(PointCycleItemEntity).save([
        { ...template, id: "PCI-LEGACY-A", cycleId: "PC-LEGACY-GROUP", submissionId: legacyA, qualityReviewedAt: new Date("2030-01-01T15:59:00Z") },
        { ...template, id: "PCI-LEGACY-B", cycleId: "PC-LEGACY-GROUP", submissionId: legacyB, qualityReviewedAt: new Date("2030-01-02T15:59:00Z") },
      ]);
      await app.get(WalletService).creditSettling(manager, { ownerId: template.ownerId, amount: Number(template.points) * 2, cycleId: "PC-LEGACY-GROUP", remark: "历史聚合周期原入账" });
    });
    const settled = await cycleFor(firstSubmissionId);
    const before = await dataSource.getRepository(WalletBalanceEntity).find({ order: { ownerId: "ASC" } });
    const txCount = await dataSource.getRepository(WalletTransactionEntity).count();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try { await new NextDaySettlement2026092100001().up(runner); } finally { await runner.release(); }
    expect((await cycleFor("SUB-PC-CONCURRENT")).settleDueAt?.toISOString()).toBe("2030-01-01T18:00:00.000Z");
    expect((await cycleFor(legacyA)).settleDueAt?.toISOString()).toBe("2030-01-02T18:00:00.000Z");
    expect((await cycleFor(legacyB)).id).toBe("PC-LEGACY-GROUP");
    expect(await cycleFor(firstSubmissionId)).toEqual(settled);
    expect(await dataSource.getRepository(WalletBalanceEntity).find({ order: { ownerId: "ASC" } })).toEqual(before);
    expect(await dataSource.getRepository(WalletTransactionEntity).count()).toBe(txCount);
    expect(await app.get(PointCyclesService).reconcileAccruals()).toBe(0);
  });

  it("restricts wallet and transaction access to the caller's scope", async () => {
    const leaderCookie = await login("point-leader");
    const collectorCookie = await login("point-collector");
    const adminCookie = await login("point-admin");
    const leaderWallets = await request(app.getHttpServer())
      .get("/api/v1/wallet")
      .set("Cookie", leaderCookie)
      .expect(200);
    const leaderNames = (leaderWallets.body.wallets as Array<{ ownerName: string }>).map(
      (item) => item.ownerName,
    );
    expect(leaderNames).toContain("积分数采");
    expect(leaderNames).not.toContain("二队数采");

    const ownTeamTransactions = await request(app.getHttpServer())
      .get("/api/v1/wallet/transactions?ownerId=U-PC-COLLECTOR")
      .set("Cookie", leaderCookie)
      .expect(200);
    expect(ownTeamTransactions.body.transactions.length).toBeGreaterThan(0);

    const crossTeamTransactions = await request(app.getHttpServer())
      .get("/api/v1/wallet/transactions?ownerId=U-PC-OTHER")
      .set("Cookie", leaderCookie)
      .expect(403);
    expect(crossTeamTransactions.body).toMatchObject({ code: "FORBIDDEN" });

    await request(app.getHttpServer())
      .get("/api/v1/wallet/transactions?ownerId=U-PC-OTHER")
      .set("Cookie", collectorCookie)
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/v1/wallet/transactions?ownerId=U-PC-OTHER")
      .set("Cookie", adminCookie)
      .expect(200);
  });
});
