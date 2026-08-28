import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import * as argon2 from "argon2";
import request from "supertest";
import type { DataSource } from "typeorm";

import { AuditModule } from "../src/audit/audit.module.js";
import { AuthModule } from "../src/auth/auth.module.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import {
  createDataSource,
  identityEntities,
} from "../src/database/data-source.js";
import { configureApplication } from "../src/http/configure-application.js";
import { SceneSystemModule } from "../src/scene-system/scene-system.module.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Scene-system-password-2026";

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("scene system API", () => {
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
      { id: "TEAM-SS-01", name: "场景一队", unitPricePerMinute: "0" },
    ]);
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-SS-ADMIN",
        displayName: "场景管理员",
        username: "scene-admin",
        usernameNormalized: "scene-admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-SS-COLLECTOR",
        displayName: "场景数采",
        username: "scene-collector",
        usernameNormalized: "scene-collector",
        passwordHash,
        role: "collector",
        teamId: "TEAM-SS-01",
        status: "active",
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
        AuditModule,
        SceneSystemModule,
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

  it("exposes level-1 scene constants and seeded classification", async () => {
    const adminCookie = await login("scene-admin");
    const meta = await request(app.getHttpServer())
      .get("/api/v1/scene-system/meta")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(meta.body.level1).toHaveLength(4);
    expect(meta.body.level1.map((item: { code: string }) => item.code)).toEqual([
      "F01",
      "O01",
      "W01",
      "G01",
    ]);

    const list = await request(app.getHttpServer())
      .get("/api/v1/scene-system/classification")
      .set("Cookie", adminCookie)
      .expect(200);
    const items = list.body.classification as Array<{
      id: string;
      level1Code: string;
      level2Name: string;
    }>;
    expect(items).toHaveLength(14);
    const family = items.filter((item) => item.level1Code === "F01");
    expect(family.length).toBeGreaterThanOrEqual(3);
    expect(family.map((item) => item.level2Name)).toContain("厨房");
  });

  it("requires authentication to read the scene system", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/scene-system/classification")
      .expect(401);
  });

  it("creates a second-level scene under an existing level-1 code", async () => {
    const adminCookie = await login("scene-admin");
    const created = await request(app.getHttpServer())
      .post("/api/v1/scene-system/classification")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ level1Code: "F01", level2Name: "玄关", description: "入户换鞋、收纳整理等操作。" })
      .expect(201);
    expect(created.body.item).toMatchObject({
      level1Code: "F01",
      level1Name: "家庭",
      level2Name: "玄关",
    });
    // 同一级下二级重名冲突
    await request(app.getHttpServer())
      .post("/api/v1/scene-system/classification")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ level1Code: "F01", level2Name: "玄关" })
      .expect(409);
    // 非法一级编码
    await request(app.getHttpServer())
      .post("/api/v1/scene-system/classification")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ level1Code: "X99", level2Name: "未知" })
      .expect(400);
  });

  it("updates and disables a second-level scene", async () => {
    const adminCookie = await login("scene-admin");
    const updated = await request(app.getHttpServer())
      .put("/api/v1/scene-system/classification/SC-001")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ description: "更新后的厨房描述", enabled: false })
      .expect(200);
    expect(updated.body.item).toMatchObject({
      id: "SC-001",
      description: "更新后的厨房描述",
      enabled: false,
    });
    await request(app.getHttpServer())
      .put("/api/v1/scene-system/classification/SC-001")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ enabled: true })
      .expect(200);
  });

  it("creates library scenes with category and sub-scenes", async () => {
    const adminCookie = await login("scene-admin");
    const created = await request(app.getHttpServer())
      .post("/api/v1/scene-system/library")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        name: "采集员A家",
        categoryKey: "family",
        subSceneIds: ["SC-001", "SC-002", "SC-003"],
        description: "采集员A的家庭场景",
      })
      .expect(201);
    expect(created.body.item).toMatchObject({
      name: "采集员A家",
      categoryKey: "family",
      categoryName: "家庭",
    });
    expect(created.body.item.subScenes.map((item: { level2Name: string }) => item.level2Name)).toEqual(
      ["厨房", "客厅", "卧室"],
    );

    // 子场景不属于所选一级
    await request(app.getHttpServer())
      .post("/api/v1/scene-system/library")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        name: "错配场景",
        categoryKey: "office",
        subSceneIds: ["SC-001"],
      })
      .expect(400);
    // 不存在的子场景
    await request(app.getHttpServer())
      .post("/api/v1/scene-system/library")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        name: "空场景",
        categoryKey: "family",
        subSceneIds: ["SC-999"],
      })
      .expect(400);
  });

  it("lists and deletes library scenes, blocking deletion of referenced classification", async () => {
    const adminCookie = await login("scene-admin");
    const list = await request(app.getHttpServer())
      .get("/api/v1/scene-system/library")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(list.body.library).toHaveLength(1);
    const libraryId = list.body.library[0].id as string;

    // 被场景库引用的二级场景不可删除
    await request(app.getHttpServer())
      .delete("/api/v1/scene-system/classification/SC-001")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .expect(409);

    await request(app.getHttpServer())
      .delete(`/api/v1/scene-system/library/${libraryId}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .expect(200);
    // 解除引用后可删除二级场景
    await request(app.getHttpServer())
      .delete("/api/v1/scene-system/classification/SC-001")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .expect(200);
  });

  it("rejects non-admin scene system mutations", async () => {
    const collectorCookie = await login("scene-collector");
    await request(app.getHttpServer())
      .post("/api/v1/scene-system/classification")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ level1Code: "F01", level2Name: "走廊" })
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/v1/scene-system/library")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ name: "违规场景", categoryKey: "family", subSceneIds: [] })
      .expect(403);
  });
});
