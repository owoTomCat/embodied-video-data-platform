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
import { CollectionTaskEntity } from "../src/database/entities/collection-task.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { configureApplication } from "../src/http/configure-application.js";
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from "../src/storage/object-storage.port.js";
import { SubmissionsModule } from "../src/submissions/submissions.module.js";
import { TasksModule } from "../src/tasks/tasks.module.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Tasks-api-password-2026";

class StubObjectStorage implements ObjectStoragePort {
  async downloadObject(): Promise<void> {
    throw new Error("not used");
  }
  async readObject(): Promise<NodeJS.ReadableStream> {
    throw new Error("not used");
  }
  async uploadObject(): Promise<void> {
    throw new Error("not used");
  }
  async createMultipartUpload() {
    return { uploadId: "UPLOAD-STUB" };
  }
  async presignUploadPart() {
    return {
      partNumber: 1,
      url: "http://minio.local/stub",
      expiresAt: new Date(Date.now() + 60_000),
    };
  }
  async presignDownloadObject() {
    return {
      url: "http://minio.local/stub?download=1",
      expiresAt: new Date(Date.now() + 60_000),
    };
  }
  async deleteObject(): Promise<void> {
    // no-op
  }
  async completeMultipartUpload() {
    return { etag: "stub-etag" };
  }
  async headObject() {
    return { sizeBytes: "1024" };
  }
  async abortMultipartUpload(): Promise<void> {
    // no-op
  }
}

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("tasks API with task type dimension", () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let passwordHash: string;

  async function login(username: string, password = TEST_PASSWORD) {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .set("Origin", WEB_ORIGIN)
      .send({ username, password })
      .expect(200);
    return cookieFrom(response);
  }

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    passwordHash = await argon2.hash(TEST_PASSWORD, {
      type: argon2.argon2id,
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
        TasksModule,
        SubmissionsModule,
      ],
    })
      .overrideProvider(OBJECT_STORAGE)
      .useValue(new StubObjectStorage())
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

  beforeEach(async () => {
    await dataSource.query(
      "TRUNCATE submissions, sessions, audit_logs, collection_tasks, users, teams RESTART IDENTITY CASCADE",
    );
    await dataSource.getRepository(TeamEntity).save([
      { id: "TEAM-STAT-01", name: "统计一队" },
      { id: "TEAM-STAT-02", name: "统计二队" },
    ]);
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-STAT-ADMIN",
        displayName: "统计管理员",
        username: "stat-admin",
        usernameNormalized: "stat-admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-STAT-LEADER",
        displayName: "一队团长",
        username: "stat-leader",
        usernameNormalized: "stat-leader",
        passwordHash,
        role: "leader",
        teamId: "TEAM-STAT-01",
        status: "active",
      },
      {
        id: "U-STAT-COLLECTOR",
        displayName: "一队数采",
        username: "stat-collector",
        usernameNormalized: "stat-collector",
        passwordHash,
        role: "collector",
        teamId: "TEAM-STAT-01",
        status: "active",
      },
      {
        id: "U-STAT-OTHER",
        displayName: "二队数采",
        username: "stat-other",
        usernameNormalized: "stat-other",
        passwordHash,
        role: "collector",
        teamId: "TEAM-STAT-02",
        status: "active",
      },
    ]);
  });

  describe("GET /tasks/preset-scenes", () => {
    it("returns the generic template and five preset scenes for admins", async () => {
      const cookie = await login("stat-admin");
      const response = await request(app.getHttpServer())
        .get("/api/v1/tasks/preset-scenes")
        .set("Cookie", cookie)
        .expect(200);
      const { presetScenes, generic } = response.body;
      expect(presetScenes.map((scene: { name: string }) => scene.name)).toEqual([
        "家庭-厨房",
        "家庭-客厅",
        "家庭-卧室",
        "办公室",
        "工厂",
      ]);
      expect(generic.sceneName).toBe("通用");
      expect(generic.requirements.length).toBeGreaterThanOrEqual(4);
      for (const scene of presetScenes as Array<{
        defaultTitle: string;
        description: string;
        requirements: string[];
        qualityNotes: string[];
      }>) {
        expect(scene.defaultTitle.length).toBeGreaterThan(0);
        expect(scene.description.length).toBeGreaterThan(50);
        expect(scene.requirements.length).toBeGreaterThanOrEqual(4);
        expect(scene.qualityNotes.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("rejects non-admin roles", async () => {
      const cookie = await login("stat-collector");
      await request(app.getHttpServer())
        .get("/api/v1/tasks/preset-scenes")
        .set("Cookie", cookie)
        .expect(403);
    });
  });

  describe("task create/update with taskType", () => {
    it("creates a generic task bound to no scene", async () => {
      const cookie = await login("stat-admin");
      const response = await request(app.getHttpServer())
        .post("/api/v1/tasks")
        .set("Origin", WEB_ORIGIN)
        .set("Cookie", cookie)
        .send({
          title: "通用综合采集",
          description: "不限场景",
          sceneName: "通用",
          taskType: "generic",
          rawRequirements: "必须第一人称拍摄，双手全程可见。",
        })
        .expect(201);
      expect(response.body.task).toMatchObject({
        taskType: "generic",
        sceneName: "通用",
        status: "draft",
      });
    });

    it("creates a preset scene task with the preset scene name", async () => {
      const cookie = await login("stat-admin");
      const response = await request(app.getHttpServer())
        .post("/api/v1/tasks")
        .set("Origin", WEB_ORIGIN)
        .set("Cookie", cookie)
        .send({
          title: "厨房做饭采集",
          description: "预设场景",
          sceneName: "家庭-厨房",
          taskType: "preset",
          rawRequirements: "必须使用第一人称视角拍摄。",
        })
        .expect(201);
      expect(response.body.task.taskType).toBe("preset");
    });

    it("defaults to custom when taskType is omitted", async () => {
      const cookie = await login("stat-admin");
      const response = await request(app.getHttpServer())
        .post("/api/v1/tasks")
        .set("Origin", WEB_ORIGIN)
        .set("Cookie", cookie)
        .send({
          title: "自定义场景采集",
          description: "",
          sceneName: "仓库库房",
          rawRequirements: "必须第一人称拍摄。",
        })
        .expect(201);
      expect(response.body.task.taskType).toBe("custom");
    });

    it("rejects an invalid taskType", async () => {
      const cookie = await login("stat-admin");
      await request(app.getHttpServer())
        .post("/api/v1/tasks")
        .set("Origin", WEB_ORIGIN)
        .set("Cookie", cookie)
        .send({
          title: "非法类型",
          description: "",
          sceneName: "家庭-厨房",
          taskType: "scene",
          rawRequirements: "必须第一人称拍摄。",
        })
        .expect(400);
    });

    it("updates taskType via PATCH and lists it in manage", async () => {
      const cookie = await login("stat-admin");
      const created = await request(app.getHttpServer())
        .post("/api/v1/tasks")
        .set("Origin", WEB_ORIGIN)
        .set("Cookie", cookie)
        .send({
          title: "类型调整任务",
          description: "",
          sceneName: "家庭-客厅",
          taskType: "preset",
          rawRequirements: "必须第一人称拍摄。",
        })
        .expect(201);
      const id = created.body.task.id as string;

      const updated = await request(app.getHttpServer())
        .patch(`/api/v1/tasks/${id}`)
        .set("Origin", WEB_ORIGIN)
        .set("Cookie", cookie)
        .send({ taskType: "custom", sceneName: "自定义展厅" })
        .expect(200);
      expect(updated.body.task.taskType).toBe("custom");
      expect(updated.body.task.sceneName).toBe("自定义展厅");

      const listed = await request(app.getHttpServer())
        .get("/api/v1/tasks/manage")
        .set("Cookie", cookie)
        .expect(200);
      const found = (listed.body.tasks as Array<{ id: string; taskType: string }>).find(
        (task) => task.id === id,
      );
      expect(found?.taskType).toBe("custom");
    });
  });

  describe("POST /tasks/:id/resume", () => {
    it("enforces publication requirements and publishes a new revision", async () => {
      const cookie = await login("stat-admin");
      const repository = dataSource.getRepository(CollectionTaskEntity);
      const task = await repository.save({
        id: "TASK-RESUME",
        title: "恢复校验任务",
        description: "",
        sceneName: "通用",
        taskType: "generic",
        rawRequirements: "必须第一人称拍摄",
        normalizedRequirements: null,
        normalizationStatus: "pending",
        status: "paused",
        revision: 1,
        createdByAccountId: "U-STAT-ADMIN",
        createdByName: "统计管理员",
        publishedAt: new Date("2026-08-24T08:00:00Z"),
        pausedAt: new Date("2026-08-24T09:00:00Z"),
      });

      const blocked = await request(app.getHttpServer())
        .post(`/api/v1/tasks/${task.id}/resume`)
        .set("Origin", WEB_ORIGIN)
        .set("Cookie", cookie)
        .expect(409);
      expect(blocked.body.code).toBe("TASK_REQUIREMENTS_NOT_READY");

      await repository.update(task.id, {
        normalizationStatus: "ready",
        normalizedRequirements: {
          scene_description: "通用采集",
          requirements: [{ type: "hard", content: "必须第一人称拍摄" }],
          quality_notes: [],
        },
      });

      const resumed = await request(app.getHttpServer())
        .post(`/api/v1/tasks/${task.id}/resume`)
        .set("Origin", WEB_ORIGIN)
        .set("Cookie", cookie)
        .expect(201);
      expect(resumed.body.task).toMatchObject({
        status: "published",
        revision: 2,
        sceneLabelId: null,
        pausedAt: null,
      });
    });
  });

  describe("GET /submissions/task-stats", () => {
    async function seedTasksAndSubmissions() {
      await dataSource.getRepository(CollectionTaskEntity).save([
        {
          id: "TASK-STAT-A",
          title: "厨房预设任务",
          description: "",
          sceneName: "家庭-厨房",
          taskType: "preset",
          rawRequirements: "第一人称拍摄",
          normalizationStatus: "ready",
          status: "published",
          revision: 1,
          createdByAccountId: "U-STAT-ADMIN",
          createdByName: "统计管理员",
          publishedAt: new Date(),
        },
        {
          id: "TASK-STAT-B",
          title: "办公室自定义任务",
          description: "",
          sceneName: "办公室",
          taskType: "custom",
          rawRequirements: "第一人称拍摄",
          normalizationStatus: "ready",
          status: "published",
          revision: 1,
          createdByAccountId: "U-STAT-ADMIN",
          createdByName: "统计管理员",
          publishedAt: new Date(),
        },
      ]);
      const base = {
        contentType: "video/mp4",
        expectedSizeBytes: "1048576",
        checksumSha256: "b".repeat(64),
        uploadStatus: "uploaded",
        processingStatus: "completed",
      } as const;
      await dataSource.getRepository(SubmissionEntity).save([
        {
          ...base,
          id: "SUB-STAT-01",
          ownerId: "U-STAT-COLLECTOR",
          teamId: "TEAM-STAT-01",
          originalFileName: "kitchen-01.mp4",
          objectKey: "subs/sub-stat-01.mp4",
          taskId: "TASK-STAT-A",
          taskSceneName: "家庭-厨房",
        },
        {
          ...base,
          id: "SUB-STAT-02",
          ownerId: "U-STAT-COLLECTOR",
          teamId: "TEAM-STAT-01",
          originalFileName: "kitchen-02.mp4",
          objectKey: "subs/sub-stat-02.mp4",
          taskId: "TASK-STAT-A",
          taskSceneName: "家庭-厨房",
        },
        {
          ...base,
          id: "SUB-STAT-03",
          ownerId: "U-STAT-COLLECTOR",
          teamId: "TEAM-STAT-01",
          originalFileName: "office-01.mp4",
          objectKey: "subs/sub-stat-03.mp4",
          taskId: "TASK-STAT-B",
          taskSceneName: "办公室",
        },
        {
          ...base,
          id: "SUB-STAT-04",
          ownerId: "U-STAT-COLLECTOR",
          teamId: "TEAM-STAT-01",
          originalFileName: "legacy-01.mp4",
          objectKey: "subs/sub-stat-04.mp4",
          taskId: null,
          taskSceneName: null,
        },
        {
          ...base,
          id: "SUB-STAT-05",
          ownerId: "U-STAT-OTHER",
          teamId: "TEAM-STAT-02",
          originalFileName: "other-01.mp4",
          objectKey: "subs/sub-stat-05.mp4",
          taskId: "TASK-STAT-A",
          taskSceneName: "家庭-厨房",
        },
      ]);
    }

    it("aggregates per-task stats for the full platform as admin", async () => {
      await seedTasksAndSubmissions();
      const cookie = await login("stat-admin");
      const response = await request(app.getHttpServer())
        .get("/api/v1/submissions/task-stats")
        .set("Cookie", cookie)
        .expect(200);
      const stats = response.body.stats as Array<{
        taskId: string | null;
        title: string;
        total: number;
        reviewed: number;
      }>;
      const byTask = new Map(stats.map((stat) => [stat.taskId, stat]));
      expect(byTask.get("TASK-STAT-A")?.total).toBe(3);
      expect(byTask.get("TASK-STAT-B")?.total).toBe(1);
      expect(byTask.get(null)?.title).toBe("未关联任务");
      expect(byTask.get(null)?.total).toBe(1);
      const totalAcross = stats.reduce((sum, stat) => sum + stat.total, 0);
      expect(totalAcross).toBe(5);
    });

    it("scopes task-stats to the leader's own team", async () => {
      await seedTasksAndSubmissions();
      const cookie = await login("stat-leader");
      const response = await request(app.getHttpServer())
        .get("/api/v1/submissions/task-stats")
        .set("Cookie", cookie)
        .expect(200);
      const stats = response.body.stats as Array<{
        taskId: string | null;
        total: number;
      }>;
      expect(stats.reduce((sum, stat) => sum + stat.total, 0)).toBe(4);
      expect(stats.find((stat) => stat.taskId === "TASK-STAT-A")?.total).toBe(2);
    });

    it("scopes task-stats to the collector's own submissions", async () => {
      await seedTasksAndSubmissions();
      const cookie = await login("stat-collector");
      const response = await request(app.getHttpServer())
        .get("/api/v1/submissions/task-stats")
        .set("Cookie", cookie)
        .expect(200);
      const stats = response.body.stats as Array<{ total: number }>;
      expect(stats.reduce((sum, stat) => sum + stat.total, 0)).toBe(4);
    });
  });
});
