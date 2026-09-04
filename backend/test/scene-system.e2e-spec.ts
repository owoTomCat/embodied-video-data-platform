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

  it("requires authentication to list scenes", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/scene-system/scenes")
      .expect(401);
  });

  it("lists single-layer scenes seeded by the migration", async () => {
    const adminCookie = await login("scene-admin");
    const res = await request(app.getHttpServer())
      .get("/api/v1/scene-system/scenes")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(Array.isArray(res.body.scenes)).toBe(true);
    const scenes = res.body.scenes as Array<{
      id: string;
      name: string;
      categoryKey: string;
      description: string;
      enabled: boolean;
      updatedAt: number;
    }>;
    // 迁移 seed 的全部场景仍以单层 scene 形态存在
    expect(scenes.length).toBeGreaterThanOrEqual(14);

    // 厨房（SC-001）归入 family 大类
    const kitchen = scenes.find((item) => item.id === "SC-001");
    expect(kitchen).toMatchObject({
      name: "厨房",
      categoryKey: "family",
      enabled: true,
    });
    expect(Number.isFinite(kitchen?.updatedAt)).toBe(true);

    // 工位（SC-006）归入 office 大类
    const workstation = scenes.find((item) => item.id === "SC-006");
    expect(workstation).toMatchObject({
      name: "工位",
      categoryKey: "office",
      enabled: true,
    });

    // 其余种子：车间工坊 → factory，桌面台面操作 → generic
    expect(scenes.find((item) => item.id === "SC-009")).toMatchObject({
      name: "车间工坊",
      categoryKey: "factory",
    });
    expect(scenes.find((item) => item.id === "SC-012")).toMatchObject({
      name: "桌面台面操作",
      categoryKey: "generic",
    });

    // 每种计费大类都有对应场景
    const keys = new Set(scenes.map((item) => item.categoryKey));
    for (const key of ["family", "office", "factory", "generic"]) {
      expect(keys.has(key)).toBe(true);
    }
  });

  it("creates a single-layer scene under an existing category", async () => {
    const adminCookie = await login("scene-admin");
    const created = await request(app.getHttpServer())
      .post("/api/v1/scene-system/scenes")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({
        name: "玄关",
        categoryKey: "family",
        description: "入户换鞋、收纳整理等操作。",
      })
      .expect(201);
    expect(created.body.item).toMatchObject({
      name: "玄关",
      categoryKey: "family",
      description: "入户换鞋、收纳整理等操作。",
      enabled: true,
    });
    expect(created.body.item.id).toMatch(/^SC-[A-F0-9]{8}$/);

    // 同大类下重名 → 409
    const duplicate = await request(app.getHttpServer())
      .post("/api/v1/scene-system/scenes")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ name: "玄关", categoryKey: "family" })
      .expect(409);
    expect(duplicate.body.code).toBe("CONFLICT");
    expect(duplicate.body.error).toContain("已存在场景");

    // 同类名可跨大类存在（唯一约束为 (category_key, name)）
    const crossCategory = await request(app.getHttpServer())
      .post("/api/v1/scene-system/scenes")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ name: "玄关", categoryKey: "office" })
      .expect(201);
    expect(crossCategory.body.item).toMatchObject({
      name: "玄关",
      categoryKey: "office",
    });

    // 计费大类不存在 → 400
    const badCategory = await request(app.getHttpServer())
      .post("/api/v1/scene-system/scenes")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ name: "未知场景", categoryKey: "hobby" })
      .expect(400);
    expect(badCategory.body.error).toBe("计费大类不存在");

    // 空名称 → 400
    const emptyName = await request(app.getHttpServer())
      .post("/api/v1/scene-system/scenes")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ name: "   ", categoryKey: "family" })
      .expect(400);
    expect(emptyName.body.error).toBe("请填写场景名称");
  });

  it("updates and disables a single-layer scene", async () => {
    const adminCookie = await login("scene-admin");
    const created = await request(app.getHttpServer())
      .post("/api/v1/scene-system/scenes")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ name: "更新测试场景", categoryKey: "office", description: "初始描述" })
      .expect(201);
    const id = created.body.item.id as string;
    expect(id).toMatch(/^SC-[A-F0-9]{8}$/);

    const updated = await request(app.getHttpServer())
      .put(`/api/v1/scene-system/scenes/${id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ description: "更新后的描述", enabled: false })
      .expect(200);
    expect(updated.body.item).toMatchObject({
      id,
      description: "更新后的描述",
      enabled: false,
    });

    // 重新启用
    const reEnabled = await request(app.getHttpServer())
      .put(`/api/v1/scene-system/scenes/${id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ enabled: true })
      .expect(200);
    expect(reEnabled.body.item.enabled).toBe(true);

    // 更新的场景不存在 → 404
    const missing = await request(app.getHttpServer())
      .put("/api/v1/scene-system/scenes/SC-NOPE")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ description: "x" })
      .expect(404);
    expect(missing.body.code).toBe("NOT_FOUND");
  });

  it("deletes an unreferenced scene and blocks referenced ones", async () => {
    const adminCookie = await login("scene-admin");
    const created = await request(app.getHttpServer())
      .post("/api/v1/scene-system/scenes")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ name: "删除测试场景", categoryKey: "factory" })
      .expect(201);
    const id = created.body.item.id as string;

    // 未引用的场景可删除
    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/scene-system/scenes/${id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(deleted.body).toEqual({ deleted: true });

    // 已删除 / 不存在的场景 → 404
    const missing = await request(app.getHttpServer())
      .delete(`/api/v1/scene-system/scenes/${id}`)
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .expect(404);
    expect(missing.body.code).toBe("NOT_FOUND");

    // 被场景库引用（scene_library.scene_id）→ 409
    await dataSource.query(
      `INSERT INTO scene_library (id, name, category_key, scene_id, created_by_account_id, created_by_name)
       VALUES ('LIB-SS-REF-01', '测试场景库', 'family', 'SC-001', 'U-SS-ADMIN', '场景管理员')`,
    );
    const referenced = await request(app.getHttpServer())
      .delete("/api/v1/scene-system/scenes/SC-001")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .expect(409);
    expect(referenced.body.code).toBe("IN_USE");
    expect(referenced.body.error).toContain("场景库引用");
  });

  it("rejects non-admin scene mutations", async () => {
    const collectorCookie = await login("scene-collector");
    await request(app.getHttpServer())
      .post("/api/v1/scene-system/scenes")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ name: "违规场景", categoryKey: "family" })
      .expect(403);
    await request(app.getHttpServer())
      .put("/api/v1/scene-system/scenes/SC-001")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ description: "x" })
      .expect(403);
    await request(app.getHttpServer())
      .delete("/api/v1/scene-system/scenes/SC-001")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .expect(403);
  });

  it("keeps inventory admin-only but exposes progress to active collectors", async () => {
    const adminCookie = await login("scene-admin");
    const collectorCookie = await login("scene-collector");

    // 管理端存量看板：管理员可读
    const inventoryAsAdmin = await request(app.getHttpServer())
      .get("/api/v1/scene-system/inventory")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(Array.isArray(inventoryAsAdmin.body.items)).toBe(true);

    // 数采读取存量返回空（controller 对非 admin 返回空数组）
    const inventoryAsCollector = await request(app.getHttpServer())
      .get("/api/v1/scene-system/inventory")
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(inventoryAsCollector.body.items).toEqual([]);

    // 数采端进度接口：任意激活用户可读
    const progress = await request(app.getHttpServer())
      .get("/api/v1/scene-system/progress")
      .set("Cookie", collectorCookie)
      .expect(200);
    expect(Array.isArray(progress.body.items)).toBe(true);
  });
});
