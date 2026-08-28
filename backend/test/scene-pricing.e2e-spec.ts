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
import { ScenePricingModule } from "../src/scene-pricing/scene-pricing.module.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const WEB_ORIGIN = "http://localhost:3000";
const TEST_PASSWORD = "Scene-pricing-password-2026";

function cookieFrom(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value.split(";")[0] ?? "";
}

describe("scene pricing API", () => {
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
      { id: "TEAM-SP-01", name: "场景一队", unitPricePerMinute: "0" },
    ]);
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-SP-ADMIN",
        displayName: "定价管理员",
        username: "pricing-admin",
        usernameNormalized: "pricing-admin",
        passwordHash,
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-SP-COLLECTOR",
        displayName: "定价数采",
        username: "pricing-collector",
        usernameNormalized: "pricing-collector",
        passwordHash,
        role: "collector",
        teamId: "TEAM-SP-01",
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
        ScenePricingModule,
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

  it("seeds default scene category pricing on migration", async () => {
    const adminCookie = await login("pricing-admin");
    const result = await request(app.getHttpServer())
      .get("/api/v1/scene-pricing")
      .set("Cookie", adminCookie)
      .expect(200);
    const categories = result.body.categories as Array<{
      categoryKey: string;
      pricePerHour: number;
    }>;
    expect(categories).toHaveLength(4);
    const byKey = new Map(
      categories.map((category) => [category.categoryKey, category]),
    );
    expect(byKey.get("family")?.pricePerHour).toBe(20);
    expect(byKey.get("office")?.pricePerHour).toBe(25);
    expect(byKey.get("factory")?.pricePerHour).toBe(30);
    expect(byKey.get("generic")?.pricePerHour).toBe(20);
  });

  it("requires authentication to read pricing", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/scene-pricing")
      .expect(401);
  });

  it("allows admin to update a category price within [20, 40]", async () => {
    const adminCookie = await login("pricing-admin");
    const result = await request(app.getHttpServer())
      .put("/api/v1/scene-pricing/office")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ pricePerHour: 28 })
      .expect(200);
    expect(result.body.category).toMatchObject({
      categoryKey: "office",
      name: "办公室",
      pricePerHour: 28,
    });
  });

  it("rejects prices outside the 20-40 range", async () => {
    const adminCookie = await login("pricing-admin");
    await request(app.getHttpServer())
      .put("/api/v1/scene-pricing/family")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ pricePerHour: 15 })
      .expect(400);
    await request(app.getHttpServer())
      .put("/api/v1/scene-pricing/family")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ pricePerHour: 45 })
      .expect(400);
  });

  it("rejects non-admin updates", async () => {
    const collectorCookie = await login("pricing-collector");
    await request(app.getHttpServer())
      .put("/api/v1/scene-pricing/family")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", collectorCookie)
      .send({ pricePerHour: 22 })
      .expect(403);
  });

  it("returns 404 for unknown category keys", async () => {
    const adminCookie = await login("pricing-admin");
    await request(app.getHttpServer())
      .put("/api/v1/scene-pricing/not-a-category")
      .set("Origin", WEB_ORIGIN)
      .set("Cookie", adminCookie)
      .send({ pricePerHour: 22 })
      .expect(404);
  });
});
