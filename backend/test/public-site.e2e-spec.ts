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
import { PublicSiteSnapshotEntity } from "../src/database/entities/public-site-snapshot.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { VideoQualityPromptVersionEntity } from "../src/database/entities/video-quality-prompt-version.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";
import { configureApplication } from "../src/http/configure-application.js";
import { PublicSiteModule } from "../src/public-site/public-site.module.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Public-site-password-2026";

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("public site snapshot API", () => {
  let app: INestApplication;
  let dataSource: DataSource;

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
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-PUBLIC-01",
      name: "公开一队",
      unitPricePerMinute: "12.0000",
    });
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-PUBLIC-ADMIN",
        displayName: "公开管理员",
        username: "public-admin",
        usernameNormalized: "public-admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-PUBLIC-COLLECTOR",
        displayName: "公开数采",
        username: "public-collector",
        usernameNormalized: "public-collector",
        passwordHash,
        role: "collector",
        teamId: "TEAM-PUBLIC-01",
        status: "active",
      },
    ]);
    await dataSource.getRepository(SubmissionEntity).save([
      {
        id: "SUB-PUBLIC-PASS-01",
        ownerId: "U-PUBLIC-COLLECTOR",
        teamId: "TEAM-PUBLIC-01",
        originalFileName: "private-kitchen-a.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "1".repeat(64),
        objectKey: "uploads/public/private-kitchen-a.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-PUBLIC-PASS-02",
        ownerId: "U-PUBLIC-COLLECTOR",
        teamId: "TEAM-PUBLIC-01",
        originalFileName: "private-desk.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "2".repeat(64),
        objectKey: "uploads/public/private-desk.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-PUBLIC-QUARANTINED",
        ownerId: "U-PUBLIC-COLLECTOR",
        teamId: "TEAM-PUBLIC-01",
        originalFileName: "private-bedroom.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "9".repeat(64),
        objectKey: "uploads/public/private-bedroom.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        assetStatus: "quarantined",
        quarantineReason: "包含隐私信息",
        quarantinedAt: new Date(),
        quarantinedByAccountId: "U-PUBLIC-ADMIN",
        quarantinedByName: "公开管理员",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-PUBLIC-FAIL",
        ownerId: "U-PUBLIC-COLLECTOR",
        teamId: "TEAM-PUBLIC-01",
        originalFileName: "private-failed.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "3".repeat(64),
        objectKey: "uploads/public/private-failed.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-PUBLIC-REVIEW-PENDING",
        ownerId: "U-PUBLIC-COLLECTOR",
        teamId: "TEAM-PUBLIC-01",
        originalFileName: "private-review-pending.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "1000",
        checksumSha256: "4".repeat(64),
        objectKey: "uploads/public/private-review-pending.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
    ]);
    await dataSource.getRepository(MediaMetadataEntity).save([
      {
        submissionId: "SUB-PUBLIC-PASS-01",
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
        submissionId: "SUB-PUBLIC-PASS-02",
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
        submissionId: "SUB-PUBLIC-QUARANTINED",
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
        submissionId: "SUB-PUBLIC-FAIL",
        durationSeconds: "90.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000",
        sizeBytes: "1000",
        rawProbe: {},
      },
      {
        submissionId: "SUB-PUBLIC-REVIEW-PENDING",
        durationSeconds: "30.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000",
        sizeBytes: "1000",
        rawProbe: {},
      },
    ]);
    const prompt = await dataSource
      .getRepository(VideoQualityPromptVersionEntity)
      .save({
        id: "VQP-PUBLIC-01",
        revision: 1,
        systemPrompt: "public prompt",
        contentSha256: "f".repeat(64),
        promptVersion: "qwen_video_qc_prompt_v1",
        ruleVersion: "video_qc_v2",
        outputSchema: "video_qc_result_v1",
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        active: true,
        createdByAccountId: "U-PUBLIC-ADMIN",
        createdByName: "公开管理员",
      });
    await dataSource.getRepository(VideoQualityResultEntity).save([
      {
        submissionId: "SUB-PUBLIC-PASS-01",
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "88.0",
        settlementRatio: "1.0000",
        invalidDurationMs: "10000",
        billableDurationMs: "110000",
        summary: "通过",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {
          detectedTask: {
            scene_id: "kitchen",
            task_summary: "整理厨房台面",
          },
        },
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-PUBLIC-PASS-02",
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
        manualFinalScore: "72.0",
        manualSettlementRatio: "0.8500",
        manualBillableDurationMs: "55000",
        manualReviewReason: "复核后通过",
        manualReviewedByAccountId: "U-PUBLIC-ADMIN",
        manualReviewedByName: "公开管理员",
        manualReviewedAt: new Date(),
        summary: "通过",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: true,
        reviewReasons: [],
        normalizedResult: {
          detectedTask: {
            scene_id: "scene",
            task_summary: "桌面整理",
          },
        },
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-PUBLIC-FAIL",
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "45.0",
        settlementRatio: "0.0000",
        invalidDurationMs: "0",
        billableDurationMs: "90000",
        summary: "不通过",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {
          detectedTask: {
            scene_id: "private",
            task_summary: "不可公开样例",
          },
        },
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-PUBLIC-QUARANTINED",
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "99.0",
        settlementRatio: "1.0000",
        invalidDurationMs: "0",
        billableDurationMs: "300000",
        summary: "本来合格但已隔离",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {
          detectedTask: {
            scene_id: "bedroom",
            task_summary: "卧室隐私样例",
          },
        },
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-PUBLIC-REVIEW-PENDING",
        status: "review_pending",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        qualityRuleSnapshot: {
          id: "QRV-PUBLIC-STRICT",
          revision: 2,
          version: "RULE-PUBLIC-STRICT",
          passThreshold: 70,
          description: "七十分通过",
        },
        finalScore: "65.0",
        settlementRatio: null,
        passed: null,
        invalidDurationMs: "0",
        billableDurationMs: "30000",
        summary: "等待人工确认",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: true,
        reviewReasons: ["边界分数需人工确认"],
        normalizedResult: {
          detectedTask: {
            scene_id: "pending",
            task_summary: "尚未确认场景",
          },
        },
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
        PublicSiteModule,
      ],
    }).compile();
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

  it("serves a public anonymized snapshot without authentication", async () => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/public-site/snapshot")
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      revision: 1,
      generatedByName: "系统初始化",
      metrics: {
        deliverableVideoCount: 2,
        effectiveDurationSeconds: 165,
        sceneCount: 2,
        qualityPassRate: expect.closeTo(66.67, 2),
      },
    });
    expect(response.body.snapshot.sceneBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "家庭厨房",
          videoCount: 1,
          share: 50,
        }),
        expect.objectContaining({
          name: "桌面整理",
          videoCount: 1,
          share: 50,
        }),
      ]),
    );
    expect(JSON.stringify(response.body.snapshot)).not.toContain(
      "private-kitchen-a.mp4",
    );
    expect(JSON.stringify(response.body.snapshot)).not.toContain("卧室隐私样例");
    expect(JSON.stringify(response.body.snapshot)).not.toContain(
      "U-PUBLIC-COLLECTOR",
    );
  });

  it("lets administrators publish refreshed public config snapshots", async () => {
    const cookie = await login("public-admin");
    const response = await request(app.getHttpServer())
      .put("/api/v1/public-site/snapshot")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        // 主推场景不再接受手工填写，由后台按最高频场景自动生成；旧字段可省略
        ctaCopy: "从真实任务出发，建立可持续的数据供给",
      })
      .expect(200);

    expect(response.body.snapshot).toMatchObject({
      revision: 2,
      generatedByName: "公开管理员",
      config: {
        ctaCopy: "从真实任务出发，建立可持续的数据供给",
      },
      metrics: {
        deliverableVideoCount: 2,
        effectiveDurationSeconds: 165,
      },
    });
    // 主推场景自动取后台最高频场景（家庭厨房或桌面整理），不得为空或沿用旧输入
    const snapshotConfig = response.body.snapshot.config as {
      primarySceneName: string;
      primarySceneDescription: string;
    };
    expect(snapshotConfig.primarySceneName.length).toBeGreaterThan(0);
    expect(snapshotConfig.primarySceneName).not.toBe("家庭精细操作");
    expect(
      await dataSource.getRepository(PublicSiteSnapshotEntity).countBy({
        active: true,
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "public_site_snapshot_publish",
      }),
    ).toBe(1);
  });

  it("forbids collectors from publishing public snapshots", async () => {
    const cookie = await login("public-collector");
    await request(app.getHttpServer())
      .put("/api/v1/public-site/snapshot")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        primarySceneName: "越权场景",
        primarySceneDescription: "不应保存",
        ctaCopy: "不应保存",
      })
      .expect(403);
  });
});
