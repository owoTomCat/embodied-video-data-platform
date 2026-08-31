import type { INestApplication } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import request from "supertest";
import type { DataSource } from "typeorm";

import { AuthModule } from "../src/auth/auth.module.js";
import type { PublicUser } from "../src/auth/auth.types.js";
import { AuditService } from "../src/audit/audit.service.js";
import { AuditLogEntity } from "../src/database/entities/audit-log.entity.js";
import { AnnotationRunEntity } from "../src/database/entities/annotation-run.entity.js";
import { AnnotationReviewEntity } from "../src/database/entities/annotation-review.entity.js";
import {
  createDataSource,
  identityEntities,
} from "../src/database/data-source.js";
import { DeliveryPackageItemEntity } from "../src/database/entities/delivery-package-item.entity.js";
import { DeliveryArchiveTaskEntity } from "../src/database/entities/delivery-archive-task.entity.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { PointCycleAdjustmentEntity } from "../src/database/entities/point-cycle-adjustment.entity.js";
import { PointCycleItemEntity } from "../src/database/entities/point-cycle-item.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { VideoQualityPromptVersionEntity } from "../src/database/entities/video-quality-prompt-version.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";
import { DeliveryModule } from "../src/delivery/delivery.module.js";
import { DeliveryArchiveWorker } from "../src/delivery/delivery-archive.worker.js";
import { DeliveryPackagesService } from "../src/delivery/delivery-packages.service.js";
import { configureApplication } from "../src/http/configure-application.js";
import { PointsModule } from "../src/points/points.module.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../src/storage/object-storage.port.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Delivery-package-password-2026";
const ADMIN_ACTOR: PublicUser = {
  id: "U-DLV-ADMIN",
  displayName: "交付管理员",
  username: "delivery-admin",
  role: "admin",
  status: "active",
  updatedAt: 0,
};

class SignedLinkStorage implements ObjectStoragePort {
  private readonly uploadedObjects = new Map<string, Buffer>();
  private readonly deletedObjects = new Set<string>();
  private nextUploadBlock:
    | {
        started: () => void;
        waitForRelease: Promise<void>;
      }
    | undefined;

  blockNextUpload(): { started: Promise<void>; release: () => void } {
    let markStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const waitForRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.nextUploadBlock = { started: markStarted, waitForRelease };
    return { started, release };
  }

  hasObject(objectKey: string): boolean {
    return this.uploadedObjects.has(objectKey);
  }

  wasDeleted(objectKey: string): boolean {
    return this.deletedObjects.has(objectKey);
  }

  async downloadObject() {
    throw new Error("not used");
  }

  async readObject(input: { objectKey: string }) {
    const uploaded = this.uploadedObjects.get(input.objectKey);
    if (uploaded) return Readable.from([uploaded]);
    return Readable.from([Buffer.from(`video:${input.objectKey}`, "utf8")]);
  }

  async uploadObject(input: {
    objectKey: string;
    sourcePath: string;
    contentType: string;
  }) {
    const block = this.nextUploadBlock;
    this.nextUploadBlock = undefined;
    if (block) {
      block.started();
      await block.waitForRelease;
    }
    this.uploadedObjects.set(input.objectKey, await readFile(input.sourcePath));
    void input.contentType;
  }

  async createMultipartUpload() {
    return { uploadId: "unused" };
  }

  async presignUploadPart() {
    return { partNumber: 1, url: "http://unused.local", expiresAt: new Date() };
  }

  async presignDownloadObject(input: {
    objectKey: string;
    expiresInSeconds: number;
  }) {
    return {
      url: `http://minio.local/${input.objectKey}?expires=${input.expiresInSeconds}`,
      expiresAt: new Date(Date.UTC(2026, 7, 13, 8, 30)),
    };
  }

  async deleteObject(input: { objectKey: string }) {
    this.uploadedObjects.delete(input.objectKey);
    this.deletedObjects.add(input.objectKey);
  }

  async completeMultipartUpload() {
    return { etag: "unused" };
  }

  async headObject() {
    return { sizeBytes: "0", etag: "unused", contentType: "video/mp4" };
  }

  async abortMultipartUpload() {
    throw new Error("not used");
  }
}

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("delivery package API", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let auditService: AuditService;
  let deliveryService: DeliveryPackagesService;
  let archiveWorker: DeliveryArchiveWorker;
  let storage: SignedLinkStorage;
  let packageId = "";

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
      id: "TEAM-DLV-01",
      name: "交付一队",
      unitPricePerMinute: "12.0000",
    });
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-DLV-ADMIN",
        displayName: "交付管理员",
        username: "delivery-admin",
        usernameNormalized: "delivery-admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-DLV-COLLECTOR",
        displayName: "交付数采",
        username: "delivery-collector",
        usernameNormalized: "delivery-collector",
        passwordHash,
        role: "collector",
        teamId: "TEAM-DLV-01",
        status: "active",
      },
    ]);
    await dataSource.getRepository(SubmissionEntity).save([
      {
        id: "SUB-DLV-01",
        ownerId: "U-DLV-COLLECTOR",
        teamId: "TEAM-DLV-01",
        originalFileName: "kitchen,task.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "2048",
        checksumSha256: "a".repeat(64),
        objectKey: "uploads/delivery/kitchen-task.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-DLV-02",
        ownerId: "U-DLV-COLLECTOR",
        teamId: "TEAM-DLV-01",
        originalFileName: "cleaning.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "4096",
        checksumSha256: "b".repeat(64),
        objectKey: "uploads/delivery/cleaning.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        uploadedAt: new Date(),
      },
      {
        id: "SUB-DLV-QUARANTINED",
        ownerId: "U-DLV-COLLECTOR",
        teamId: "TEAM-DLV-01",
        originalFileName: "private-room.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: "8192",
        checksumSha256: "9".repeat(64),
        objectKey: "uploads/delivery/private-room.mp4",
        uploadStatus: "uploaded",
        processingStatus: "completed",
        assetStatus: "quarantined",
        quarantineReason: "包含隐私信息",
        quarantinedAt: new Date(),
        quarantinedByAccountId: "U-DLV-ADMIN",
        quarantinedByName: "交付管理员",
        uploadedAt: new Date(),
      },
    ]);
    await dataSource.getRepository(MediaMetadataEntity).save([
      {
        submissionId: "SUB-DLV-01",
        durationSeconds: "120.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000",
        sizeBytes: "2048",
        rawProbe: {},
      },
      {
        submissionId: "SUB-DLV-02",
        durationSeconds: "60.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000",
        sizeBytes: "4096",
        rawProbe: {},
      },
      {
        submissionId: "SUB-DLV-QUARANTINED",
        durationSeconds: "180.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000",
        sizeBytes: "8192",
        rawProbe: {},
      },
    ]);
    const prompt = await dataSource
      .getRepository(VideoQualityPromptVersionEntity)
      .save({
        id: "VQP-DLV-01",
        revision: 1,
        systemPrompt: "delivery prompt",
        contentSha256: "f".repeat(64),
        promptVersion: "qwen_video_qc_prompt_v1",
        ruleVersion: "video_qc_v2",
        outputSchema: "video_qc_result_v1",
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        active: true,
        createdByAccountId: "U-DLV-ADMIN",
        createdByName: "交付管理员",
      });
    await dataSource.getRepository(VideoQualityResultEntity).save([
      {
        submissionId: "SUB-DLV-01",
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
        invalidDurationMs: "0",
        billableDurationMs: "120000",
        summary: "通过",
        modelRuns: [],
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        normalizedResult: {
          candidateAnnotation: {
            status: "review_required",
            schemaVersion: "ego_video_annotation_v1",
            policyVersion: "ego_annotation_evidence_policy_v1",
            promptVersion: "ego_video_annotation_prompt_v1",
            promptContentSha256: "a".repeat(64),
            model: "qwen-vl-max",
            effective: {
              schema_version: "ego_video_annotation_v1",
              video_id: "SUB-DLV-01",
              video_summary: "整理厨房台面",
              scene: {
                coarse_label: "厨房",
                fine_label: null,
                confidence: 0.93,
                evidence_timestamps_ms: [0],
              },
              temporal_structure_type: "single_task",
              tasks: [],
              global_limitations: ["稀疏采样无法判断动作结果"],
            },
            labelMappings: [],
            validation: { errors: [], warnings: ["sparse sampling"] },
          },
          annotationReview: {
            decision: "accepted",
            reason: "人工确认场景与任务语义",
            reviewedByAccountId: "U-DLV-ADMIN",
            reviewedByName: "交付管理员",
            reviewedAt: 1_777_000_000_000,
            candidateSchemaVersion: "ego_video_annotation_v1",
            candidatePolicyVersion: "ego_annotation_evidence_policy_v1",
            candidatePromptVersion: "ego_video_annotation_prompt_v1",
            candidatePromptContentSha256: "a".repeat(64),
          },
        },
        rawModelResult: {},
        completedAt: new Date(),
      },
      {
        submissionId: "SUB-DLV-02",
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "72.0",
        settlementRatio: "0.8500",
        invalidDurationMs: "0",
        billableDurationMs: "60000",
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
        submissionId: "SUB-DLV-QUARANTINED",
        status: "scored",
        attempts: 1,
        promptVersionId: prompt.id,
        promptRevision: prompt.revision,
        promptContentSha256: prompt.contentSha256,
        systemPromptSnapshot: prompt.systemPrompt,
        initialModel: prompt.initialModel,
        reviewModel: prompt.reviewModel,
        finalScore: "96.0",
        settlementRatio: "1.0000",
        invalidDurationMs: "0",
        billableDurationMs: "180000",
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
    ]);
    await dataSource.getRepository(AnnotationRunEntity).save({
      id: "ANR-DLV-01",
      submissionId: "SUB-DLV-01",
      trigger: "initial",
      pipelineVersion: "annotation-pipeline-v1",
      schemaVersion: "ego_video_annotation_v1",
      evidencePolicyVersion: "ego_annotation_evidence_policy_v1",
      promptVersion: "ego_video_annotation_prompt_v1",
      promptContentSha256: "a".repeat(64),
      systemPromptSnapshot: "locked historical annotation prompt",
      outputExampleSnapshot: { video_id: "example" },
      model: "qwen-vl-max",
      executionStatus: "succeeded",
      reviewStatus: "accepted_unchanged",
      publicationStatus: "human_verified",
      attemptCount: 1,
      reviewRevision: 1,
      normalizedResult: {
        status: "candidate",
        schemaVersion: "ego_video_annotation_v1",
        policyVersion: "ego_annotation_evidence_policy_v1",
        promptVersion: "ego_video_annotation_prompt_v1",
        promptContentSha256: "a".repeat(64),
        model: "qwen-vl-max",
        effective: {
          schema_version: "ego_video_annotation_v1",
          video_id: "SUB-DLV-01",
          video_summary: "整理厨房台面",
          scene: { coarse_label: "厨房", fine_label: null, confidence: 0.93 },
          temporal_structure_type: "single_task",
          tasks: [],
          global_limitations: ["稀疏采样无法判断动作结果"],
        },
        labelMappings: [],
        validation: { errors: [], warnings: ["sparse sampling"] },
      },
      queuedAt: new Date("2026-08-27T07:59:00Z"),
      startedAt: new Date("2026-08-27T08:00:00Z"),
      completedAt: new Date("2026-08-27T08:01:00Z"),
    });
    await dataSource.getRepository(AnnotationReviewEntity).save({
      id: "ANV-DLV-01",
      annotationRunId: "ANR-DLV-01",
      revision: 1,
      disposition: "accepted_unchanged",
      reviewedFields: ["video_summary", "scene"],
      reasonCodes: ["HUMAN_VERIFIED"],
      reviewDurationMs: 1_000,
      reason: "人工确认场景与任务语义",
      reviewerAccountId: "U-DLV-ADMIN",
      reviewerName: "交付管理员",
      createdAt: new Date(1_777_000_000_000),
    });

    storage = new SignedLinkStorage();
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          url: TEST_DATABASE_URL,
          entities: identityEntities,
          synchronize: false,
        }),
        AuthModule,
        PointsModule,
        DeliveryModule,
      ],
    })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app, WEB_ORIGIN);
    await app.init();
    auditService = app.get(AuditService);
    deliveryService = app.get(DeliveryPackagesService);
    archiveWorker = app.get(DeliveryArchiveWorker);

    const adminCookie = await login("delivery-admin");
    await request(app.getHttpServer())
      .post("/api/v1/point-cycles")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ businessDate: "2026-08-13" })
      .expect(201);

    const firstPointItem = await dataSource
      .getRepository(PointCycleItemEntity)
      .findOneByOrFail({ submissionId: "SUB-DLV-01" });
    const secondPointItem = await dataSource
      .getRepository(PointCycleItemEntity)
      .findOneByOrFail({ submissionId: "SUB-DLV-02" });
    await dataSource.getRepository(PointCycleAdjustmentEntity).save([
      {
        id: "PCA-DLV-01-A",
        pointCycleItemId: firstPointItem.id,
        submissionId: "SUB-DLV-01",
        previousFinalScore: firstPointItem.finalScore,
        nextFinalScore: "86.0",
        previousSettlementRatio: firstPointItem.settlementRatio,
        nextSettlementRatio: "1.0000",
        previousInvalidDurationMs: "0",
        nextInvalidDurationMs: "10000",
        previousEffectiveDurationMs: firstPointItem.effectiveDurationMs,
        nextEffectiveDurationMs: "110000",
        previousPoints: firstPointItem.points,
        nextPoints: "22.00",
        pointsDelta: "-2.00",
        reason: "交付前首次复核调整",
        createdByAccountId: ADMIN_ACTOR.id,
        createdByName: ADMIN_ACTOR.displayName,
        createdAt: new Date("2026-08-13T08:00:00.000Z"),
      },
      {
        id: "PCA-DLV-01-B",
        pointCycleItemId: firstPointItem.id,
        submissionId: "SUB-DLV-01",
        previousFinalScore: "86.0",
        nextFinalScore: "91.0",
        previousSettlementRatio: "1.0000",
        nextSettlementRatio: "1.0000",
        previousInvalidDurationMs: "10000",
        nextInvalidDurationMs: "20000",
        previousEffectiveDurationMs: "110000",
        nextEffectiveDurationMs: "100000",
        previousPoints: "22.00",
        nextPoints: "20.00",
        pointsDelta: "-2.00",
        reason: "交付前再次复核调整",
        createdByAccountId: ADMIN_ACTOR.id,
        createdByName: ADMIN_ACTOR.displayName,
        createdAt: new Date("2026-08-13T09:00:00.000Z"),
      },
      {
        id: "PCA-DLV-02",
        pointCycleItemId: secondPointItem.id,
        submissionId: "SUB-DLV-02",
        previousFinalScore: secondPointItem.finalScore,
        nextFinalScore: "55.0",
        previousSettlementRatio: secondPointItem.settlementRatio,
        nextSettlementRatio: "0.0000",
        previousInvalidDurationMs: "0",
        nextInvalidDurationMs: "0",
        previousEffectiveDurationMs: secondPointItem.effectiveDurationMs,
        nextEffectiveDurationMs: secondPointItem.effectiveDurationMs,
        previousPoints: secondPointItem.points,
        nextPoints: "0.00",
        pointsDelta: `-${secondPointItem.points}`,
        reason: "交付前复核不通过",
        createdByAccountId: ADMIN_ACTOR.id,
        createdByName: ADMIN_ACTOR.displayName,
        createdAt: new Date("2026-08-13T09:00:00.000Z"),
      },
    ]);
  });

  afterAll(async () => {
    await app?.close();
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  it("previews deliverable assets and creates a package", async () => {
    const adminCookie = await login("delivery-admin");
    const preview = await request(app.getHttpServer())
      .get("/api/v1/delivery-packages/preview")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(preview.body.preview).toEqual({
      assetCount: 1,
      totalSizeBytes: "2048",
    });

    const created = await request(app.getHttpServer())
      .post("/api/v1/delivery-packages")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ name: "八月家庭任务包" })
      .expect(201);

    packageId = created.body.package.id;
    expect(created.body.package).toMatchObject({
      name: "八月家庭任务包",
      status: "ready",
      assetCount: 1,
      totalSizeBytes: "2048",
      createdByName: "交付管理员",
    });
    expect(created.body.package.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          submissionId: "SUB-DLV-01",
          fileName: "kitchen,task.mp4",
          objectKey: "uploads/delivery/kitchen-task.mp4",
          finalScore: 91,
          points: 20,
          sizeBytes: "2048",
          annotation: expect.objectContaining({
            available: true,
            schemaVersion: "ego_video_annotation_v1",
            promptVersion: "ego_video_annotation_prompt_v1",
          }),
        }),
      ]),
    );
    expect(
      created.body.package.items.map(
        (item: { submissionId: string }) => item.submissionId,
      ),
    ).toEqual(["SUB-DLV-01"]);
    expect(
      await dataSource.getRepository(DeliveryPackageItemEntity).count(),
    ).toBe(1);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "delivery_package_create",
      }),
    ).toBe(1);
  });

  it("serves a csv manifest and prevents duplicate delivery", async () => {
    const adminCookie = await login("delivery-admin");
    const manifest = await request(app.getHttpServer())
      .get(`/api/v1/delivery-packages/${packageId}/manifest.csv`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(manifest.text).toContain("package_id,package_name,submission_id");
    expect(manifest.text).toContain('"kitchen,task.mp4"');
    expect(manifest.text).toContain("uploads/delivery/kitchen-task.mp4");
    expect(manifest.text).toContain(",91.0,20.00,2048");
    expect(manifest.text).toContain(
      "annotations/SUB-DLV-01.json,ego_video_annotation_v1",
    );
    expect(manifest.text).not.toContain("SUB-DLV-02");
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "delivery_manifest_download",
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post("/api/v1/delivery-packages")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ name: "重复交付包" })
      .expect(409);
  });

  it("rolls back archive task creation when its audit record fails", async () => {
    const tasks = dataSource.getRepository(DeliveryArchiveTaskEntity);
    const countBefore = await tasks.count();
    const auditBefore = await dataSource.getRepository(AuditLogEntity).countBy({
      action: "delivery_archive_task_create",
    });
    const record = vi
      .spyOn(auditService, "record")
      .mockRejectedValueOnce(new Error("audit unavailable"));

    await expect(
      deliveryService.createArchiveTask(ADMIN_ACTOR, packageId, {
        format: "tar",
      }),
    ).rejects.toThrow("audit unavailable");
    record.mockRestore();

    expect(await tasks.count()).toBe(countBefore);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "delivery_archive_task_create",
      }),
    ).toBe(auditBefore);
  });

  it("issues short-lived signed download links for packaged assets", async () => {
    const adminCookie = await login("delivery-admin");
    const links = await request(app.getHttpServer())
      .get(`/api/v1/delivery-packages/${packageId}/download-links`)
      .set("Cookie", adminCookie)
      .expect(200);

    expect(links.body).toMatchObject({
      expiresInSeconds: 1800,
      package: {
        id: packageId,
        name: "八月家庭任务包",
        assetCount: 1,
      },
    });
    expect(links.body.links).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          submissionId: "SUB-DLV-01",
          fileName: "kitchen,task.mp4",
          objectKey: "uploads/delivery/kitchen-task.mp4",
          sizeBytes: "2048",
          url: "http://minio.local/uploads/delivery/kitchen-task.mp4?expires=1800",
          expiresAt: Date.UTC(2026, 7, 13, 8, 30),
        }),
      ]),
    );
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "storage_download_link",
      }),
    ).toBe(1);
  });

  it("streams a tar archive containing the manifest and packaged videos", async () => {
    const adminCookie = await login("delivery-admin");
    const archive = await request(app.getHttpServer())
      .get(`/api/v1/delivery-packages/${packageId}/archive.tar`)
      .set("Cookie", adminCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(archive.headers["content-type"]).toContain("application/x-tar");
    expect(archive.headers["content-disposition"]).toContain(
      `${packageId}-assets.tar`,
    );
    const body = (archive.body as Buffer).toString("utf8");
    expect(body).toContain("manifest.csv");
    expect(body).toContain("annotations/SUB-DLV-01.json");
    expect(body).toContain("人工确认场景与任务语义");
    expect(body).toContain("assets/SUB-DLV-01.mp4");
    expect(body).toContain("video:uploads/delivery/kitchen-task.mp4");
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "delivery_archive_download",
      }),
    ).toBe(1);
  });

  it("streams a zip archive containing the manifest and packaged videos", async () => {
    const adminCookie = await login("delivery-admin");
    const archive = await request(app.getHttpServer())
      .get(`/api/v1/delivery-packages/${packageId}/archive.zip`)
      .set("Cookie", adminCookie)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(archive.headers["content-type"]).toContain("application/zip");
    expect(archive.headers["content-disposition"]).toContain(
      `${packageId}-assets.zip`,
    );
    const body = archive.body as Buffer;
    expect(body.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(body.toString("utf8")).toContain("manifest.csv");
    expect(body.toString("utf8")).toContain("annotations/SUB-DLV-01.json");
    expect(body.toString("utf8")).toContain("人工确认场景与任务语义");
    expect(body.toString("utf8")).toContain("assets/SUB-DLV-01.mp4");
    expect(body.toString("utf8")).toContain(
      "video:uploads/delivery/kitchen-task.mp4",
    );
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "delivery_archive_download",
      }),
    ).toBe(2);
  });

  it("prepares an archive task and returns a signed archive link", async () => {
    const adminCookie = await login("delivery-admin");
    const created = await request(app.getHttpServer())
      .post(`/api/v1/delivery-packages/${packageId}/archive-tasks`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ format: "zip" })
      .expect(201);

    expect(created.body.task).toMatchObject({
      packageId,
      format: "zip",
      assetCount: 1,
      processedAssetCount: 0,
      totalSizeBytes: "2048",
      fileName: `${packageId}-assets.zip`,
    });
    const taskId = created.body.task.id as string;
    let task = created.body.task;
    for (let attempt = 0; attempt < 60 && task.status !== "completed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const response = await request(app.getHttpServer())
        .get(`/api/v1/delivery-packages/${packageId}/archive-tasks/${taskId}`)
        .set("Cookie", adminCookie)
        .expect(200);
      task = response.body.task;
    }

    expect(task).toMatchObject({
      id: taskId,
      status: "completed",
      processedAssetCount: 1,
      processedSizeBytes: "2048",
      progressPercent: 100,
      fileName: `${packageId}-assets.zip`,
    });
    expect(task.archiveObjectKey).toContain(`delivery-archives/${packageId}/`);
    expect(Number(task.archiveSizeBytes)).toBeGreaterThan(0);
    expect(
      await dataSource.getRepository(DeliveryArchiveTaskEntity).count(),
    ).toBe(1);

    const link = await request(app.getHttpServer())
      .get(
        `/api/v1/delivery-packages/${packageId}/archive-tasks/${taskId}/download-link`,
      )
      .set("Cookie", adminCookie)
      .expect(200);
    expect(link.body).toMatchObject({
      expiresInSeconds: 1800,
      task: {
        id: taskId,
        status: "completed",
        format: "zip",
      },
    });
    expect(link.body.url).toContain(
      `delivery-archives/${packageId}/${taskId}/`,
    );
    expect(link.body.url).toContain(".zip?expires=1800");
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "delivery_archive_task_create",
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "delivery_archive_task_complete",
      }),
    ).toBe(1);
    expect(
      await dataSource.getRepository(AuditLogEntity).countBy({
        action: "delivery_archive_task_download_link",
      }),
    ).toBe(1);
  });

  it("recovers a queued archive task when a new worker starts", async () => {
    await archiveWorker.stop();
    const created = await deliveryService.createArchiveTask(
      ADMIN_ACTOR,
      packageId,
      { format: "tar" },
    );
    const taskId = created.id as string;
    expect(
      await dataSource
        .getRepository(DeliveryArchiveTaskEntity)
        .findOneByOrFail({ id: taskId }),
    ).toMatchObject({ status: "queued", attemptCount: 0 });

    const restartedWorker = new DeliveryArchiveWorker(deliveryService);
    restartedWorker.start();
    let recovered = await dataSource
      .getRepository(DeliveryArchiveTaskEntity)
      .findOneByOrFail({ id: taskId });
    for (
      let attempt = 0;
      attempt < 60 && recovered.status !== "completed";
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      recovered = await dataSource
        .getRepository(DeliveryArchiveTaskEntity)
        .findOneByOrFail({ id: taskId });
    }
    await restartedWorker.stop();

    expect(recovered).toMatchObject({
      status: "completed",
      attemptCount: 1,
      leaseToken: null,
      leaseOwner: null,
      leaseUntil: null,
    });
  });

  it("reclaims expired processing leases and prevents duplicate claims", async () => {
    await archiveWorker.stop();
    const tasks = dataSource.getRepository(DeliveryArchiveTaskEntity);
    const staleTaskId = "DAT-DLV-STALE-LEASE";
    await tasks.save({
      id: staleTaskId,
      packageId,
      format: "zip",
      status: "processing",
      assetCount: 1,
      processedAssetCount: 1,
      totalSizeBytes: "2048",
      processedSizeBytes: "2048",
      fileName: `${packageId}-stale-assets.zip`,
      requestedByAccountId: ADMIN_ACTOR.id,
      requestedByName: ADMIN_ACTOR.displayName,
      attemptCount: 1,
      leaseToken: "stale-token",
      leaseOwner: "stopped-worker",
      leaseUntil: new Date(Date.now() - 60_000),
      startedAt: new Date(Date.now() - 120_000),
    });

    const [firstClaims, secondClaims] = await Promise.all([
      deliveryService.claimPendingArchiveTasks("replacement-worker-a", 1),
      deliveryService.claimPendingArchiveTasks("replacement-worker-b", 1),
    ]);
    const claims = [...firstClaims, ...secondClaims];
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      taskId: staleTaskId,
      attemptCount: 2,
    });
    expect(claims[0]?.leaseToken).not.toBe("stale-token");

    await deliveryService.processArchiveClaim({
      taskId: staleTaskId,
      attemptCount: 1,
      leaseToken: "stale-token",
      leaseOwner: "stopped-worker",
    });
    const completionAuditBefore = await dataSource
      .getRepository(AuditLogEntity)
      .countBy({ action: "delivery_archive_task_complete" });
    const claim = claims[0]!;
    await Promise.all([
      deliveryService.processArchiveClaim(claim),
      deliveryService.processArchiveClaim(claim),
    ]);

    const completedTask = await tasks.findOneByOrFail({ id: staleTaskId });
    expect(completedTask).toMatchObject({
      status: "completed",
      attemptCount: 2,
      processedAssetCount: 1,
      processedSizeBytes: "2048",
      leaseToken: null,
      leaseOwner: null,
      leaseUntil: null,
    });
    expect(storage.hasObject(completedTask.archiveObjectKey!)).toBe(true);
    expect(
      await dataSource
        .getRepository(AuditLogEntity)
        .countBy({ action: "delivery_archive_task_complete" }),
    ).toBe(completionAuditBefore + 1);
  });

  it("fences a late upload after another worker reclaims the expired lease", async () => {
    await archiveWorker.stop();
    const tasks = dataSource.getRepository(DeliveryArchiveTaskEntity);
    const taskId = "DAT-DLV-BLOCKED-UPLOAD";
    await tasks.save({
      id: taskId,
      packageId,
      format: "tar",
      status: "queued",
      assetCount: 1,
      processedAssetCount: 0,
      totalSizeBytes: "2048",
      processedSizeBytes: "0",
      fileName: `${packageId}-blocked-assets.tar`,
      requestedByAccountId: ADMIN_ACTOR.id,
      requestedByName: ADMIN_ACTOR.displayName,
    });
    const [firstClaim] = await deliveryService.claimPendingArchiveTasks(
      "slow-worker-a",
      1,
    );
    expect(firstClaim).toBeDefined();

    const blockedUpload = storage.blockNextUpload();
    const firstRun = deliveryService.processArchiveClaim(firstClaim!);
    await blockedUpload.started;
    await tasks.update(
      { id: taskId },
      { leaseUntil: new Date(Date.now() - 1_000) },
    );

    const [replacementClaim] = await deliveryService.claimPendingArchiveTasks(
      "replacement-worker-b",
      1,
    );
    expect(replacementClaim).toMatchObject({
      taskId,
      attemptCount: 2,
    });
    const completionAuditBefore = await dataSource
      .getRepository(AuditLogEntity)
      .countBy({ action: "delivery_archive_task_complete" });
    await deliveryService.processArchiveClaim(replacementClaim!);
    const replacementObjectKey = `delivery-archives/${packageId}/${taskId}/${replacementClaim!.leaseToken}.tar`;
    expect(await tasks.findOneByOrFail({ id: taskId })).toMatchObject({
      status: "completed",
      archiveObjectKey: replacementObjectKey,
      attemptCount: 2,
    });
    expect(storage.hasObject(replacementObjectKey)).toBe(true);

    const staleObjectKey = `delivery-archives/${packageId}/${taskId}/${firstClaim!.leaseToken}.tar`;
    blockedUpload.release();
    await firstRun;

    expect(await tasks.findOneByOrFail({ id: taskId })).toMatchObject({
      status: "completed",
      archiveObjectKey: replacementObjectKey,
      attemptCount: 2,
    });
    expect(storage.hasObject(replacementObjectKey)).toBe(true);
    expect(storage.hasObject(staleObjectKey)).toBe(false);
    expect(storage.wasDeleted(staleObjectKey)).toBe(true);
    expect(
      await dataSource
        .getRepository(AuditLogEntity)
        .countBy({ action: "delivery_archive_task_complete" }),
    ).toBe(completionAuditBefore + 1);
  });

  it("limits package management to administrators", async () => {
    const collectorCookie = await login("delivery-collector");
    await request(app.getHttpServer())
      .get("/api/v1/delivery-packages")
      .set("Cookie", collectorCookie)
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/v1/delivery-packages")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ name: "无权创建" })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/delivery-packages/${packageId}/download-links`)
      .set("Cookie", collectorCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/delivery-packages/${packageId}/archive.tar`)
      .set("Cookie", collectorCookie)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/delivery-packages/${packageId}/archive.zip`)
      .set("Cookie", collectorCookie)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/delivery-packages/${packageId}/archive-tasks`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ format: "zip" })
      .expect(403);
  });
});
