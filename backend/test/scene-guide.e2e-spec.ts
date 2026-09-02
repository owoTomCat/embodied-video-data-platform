import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import request from "supertest";
import type { DataSource } from "typeorm";

import { AuditModule } from "../src/audit/audit.module.js";
import { AuthModule } from "../src/auth/auth.module.js";
import {
  createDataSource,
  identityEntities,
} from "../src/database/data-source.js";
import { CollectionTaskEntity } from "../src/database/entities/collection-task.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { configureApplication } from "../src/http/configure-application.js";
import { SCENE_GUIDE_PROVIDER } from "../src/scene-guide/scene-guide.module.js";
import { SceneGuideModule } from "../src/scene-guide/scene-guide.module.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../src/storage/object-storage.port.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Scene-guide-password-2026";

class StubStorage implements ObjectStoragePort {
  readonly stored = new Map<string, Buffer>();
  async downloadObject(): Promise<void> {
    /* no-op */
  }
  async readObject(): Promise<NodeJS.ReadableStream> {
    throw new Error("not used");
  }
  async uploadObject(): Promise<void> {
    /* no-op */
  }
  async createMultipartUpload() {
    return { uploadId: "UPLOAD-STUB" };
  }
  async presignUploadPart() {
    return { partNumber: 1, url: "http://minio.local/stub", expiresAt: new Date() };
  }
  async presignDownloadObject() {
    return { url: "http://minio.local/stub?download=1", expiresAt: new Date() };
  }
  async presignUploadObject(input: {
    objectKey: string;
    contentType: string;
    expiresInSeconds: number;
  }) {
    return {
      objectKey: input.objectKey,
      url: `http://minio.local/stub?key=${encodeURIComponent(input.objectKey)}`,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000),
    };
  }
  async getObjectBytes(input: { objectKey: string }): Promise<Buffer> {
    const bytes = this.stored.get(input.objectKey);
    if (!bytes) throw new Error(`missing object ${input.objectKey}`);
    return bytes;
  }
  async deleteObject(): Promise<void> {
    /* no-op */
  }
  async completeMultipartUpload() {
    return { etag: "stub-etag" };
  }
  async headObject() {
    return { sizeBytes: "1024" };
  }
  async abortMultipartUpload(): Promise<void> {
    /* no-op */
  }
}

const stubStorage = new StubStorage();

const stubProvider = {
  recognizeEnvObjects: vi.fn(),
  generateTaskCard: vi.fn(),
};

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("scene guide API", () => {
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
    await dataSource.getRepository(TeamEntity).save([
      { id: "TEAM-SG-01", name: "指导一队" },
    ]);
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-SG-ADMIN",
        displayName: "指导管理员",
        username: "guide-admin",
        usernameNormalized: "guide-admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-SG-COLLECTOR",
        displayName: "指导数采",
        username: "guide-collector",
        usernameNormalized: "guide-collector",
        passwordHash,
        role: "collector",
        teamId: "TEAM-SG-01",
        status: "active",
      },
    ]);
    // 一个已发布的场景型任务
    await dataSource.getRepository(CollectionTaskEntity).save({
      id: "TASK-SG-01",
      title: "家庭厨房补量",
      description: "补量家庭厨房第一人称操作",
      sceneName: "家庭厨房",
      taskType: "scene_type",
      targetDurationSeconds: "3600",
      rawRequirements: "必须第一人称拍摄",
      normalizationStatus: "ready",
      status: "published",
      revision: 1,
      createdByAccountId: "U-SG-ADMIN",
      createdByName: "指导管理员",
      publishedAt: new Date(),
      normalizedRequirements: {
        scene_description: "家庭厨房场景。",
        requirements: [
          { type: "hard", content: "必须第一人称视角拍摄" },
        ],
        quality_notes: [],
      },
    });

    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: "postgres",
          url: TEST_DATABASE_URL,
          entities: identityEntities,
          synchronize: false,
        }),
        AuthModule,
        AuditModule,
        SceneGuideModule,
      ],
    })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(stubStorage)
      .overrideProvider(SCENE_GUIDE_PROVIDER)
      .useValue(stubProvider)
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/scene-guide")
      .expect(401);
  });

  it("presigns a photo upload for an active collector", async () => {
    const cookie = await login("guide-collector");
    const response = await request(app.getHttpServer())
      .post("/api/v1/scene-guide/photo/upload")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({ name: "kitchen.jpg", contentType: "image/jpeg", sizeBytes: 1024 })
      .expect(201);
    expect(response.body.upload.objectKey).toContain("scene-guide/");
    expect(response.body.upload.url).toContain("stub");
  });

  it("generates a guide task from photos, recognizing objects and building a card", async () => {
    stubStorage.stored.set(
      "scene-guide/U-SG-COLLECTOR/PHOTO-1/kitchen.jpg",
      Buffer.from("fake-image-bytes"),
    );
    stubProvider.recognizeEnvObjects.mockResolvedValue({
      objects: [
        { name: "冰箱", category: "appliance", confidence: 0.95 },
        { name: "灶台", category: "appliance", confidence: 0.9 },
        { name: "抹布", category: "object", confidence: 0.8 },
      ],
      scene_summary: "画面是一间家庭厨房。",
      model: "qwen-vl-max",
    });
    stubProvider.generateTaskCard.mockResolvedValue({
      target_objects: [{ name: "灶台", action: "烧水" }],
      steps: ["进入厨房", "打开燃气", "烧水", "关火"],
      end_condition: "完成烧水并关火",
      success_criteria: ["全程第一人称", "灶台清晰可见"],
      fail_criteria: ["画面遮挡", "镜头晃动"],
      model: "qwen3.7-plus",
    });

    const cookie = await login("guide-collector");
    const response = await request(app.getHttpServer())
      .post("/api/v1/scene-guide")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        sceneTypeTaskId: "TASK-SG-01",
        photoRefs: [
          {
            objectKey: "scene-guide/U-SG-COLLECTOR/PHOTO-1/kitchen.jpg",
            contentType: "image/jpeg",
          },
        ],
      })
      .expect(201);
    const task = response.body.task as {
      status: string;
      envObjects: unknown[];
      taskCard: { steps: string[] } | null;
      taskType?: string;
    };
    expect(task.status).toBe("ai_generated");
    expect(task.envObjects.length).toBe(3);
    expect(task.taskCard?.steps.length).toBe(4);
    expect(stubProvider.recognizeEnvObjects).toHaveBeenCalledTimes(1);
    expect(stubProvider.generateTaskCard).toHaveBeenCalledTimes(1);
  });

  it("lets the collector edit and submit the card for review", async () => {
    const cookie = await login("guide-collector");
    const generate = await request(app.getHttpServer())
      .post("/api/v1/scene-guide")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        sceneTypeTaskId: "TASK-SG-01",
        photoRefs: [
          {
            objectKey: "scene-guide/U-SG-COLLECTOR/PHOTO-1/kitchen.jpg",
            contentType: "image/jpeg",
          },
        ],
      })
      .expect(201);
    const id = generate.body.task.id as string;

    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/scene-guide/${id}/submit-edited`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        sceneName: "家庭厨房",
        card: {
          target_objects: [{ name: "灶台", action: "烧水" }],
          steps: ["进入厨房", "打开燃气", "烧水", "关火"],
          end_condition: "完成烧水并关火",
          success_criteria: ["全程第一人称"],
          fail_criteria: ["画面遮挡"],
        },
      })
      .expect(201);
    expect(submitted.body.task.status).toBe("in_review");

    // 管理员审核通过
    const adminCookie = await login("guide-admin");
    const approved = await request(app.getHttpServer())
      .post(`/api/v1/scene-guide/${id}/review`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ decision: "approved" })
      .expect(201);
    expect(approved.body.task.status).toBe("approved");
  });

  it("blocks a collector from reviewing", async () => {
    const cookie = await login("guide-collector");
    const generate = await request(app.getHttpServer())
      .post("/api/v1/scene-guide")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({
        sceneTypeTaskId: "TASK-SG-01",
        photoRefs: [
          {
            objectKey: "scene-guide/U-SG-COLLECTOR/PHOTO-1/kitchen.jpg",
            contentType: "image/jpeg",
          },
        ],
      })
      .expect(201);
    const id = generate.body.task.id as string;
    await request(app.getHttpServer())
      .post(`/api/v1/scene-guide/${id}/review`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", cookie)
      .send({ decision: "approved" })
      .expect(403);
  });
});
