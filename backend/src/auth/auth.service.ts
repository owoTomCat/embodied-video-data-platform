import { createHash, randomBytes } from "node:crypto";

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThanOrEqual, MoreThan, Repository } from "typeorm";

import { SessionEntity } from "../database/entities/session.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import {
  AuthFailure,
  type PublicUser,
} from "./auth.types.js";
import { PasswordService } from "./password.service.js";

const FAILURE_WINDOW_MS = 15 * 60 * 1_000;
const LOCK_DURATION_MS = 15 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 5;
const EXPIRED_SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

type LoginTransactionResult =
  | {
      ok: true;
      user: PublicUser;
      token: string;
      expiresAt: Date;
    }
  | { ok: false; failure: AuthFailure };

export function normalizeUsername(username: string): string {
  return username.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function toPublicUser(user: UserEntity): PublicUser {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    role: user.role,
    teamId: user.teamId ?? undefined,
    phone: user.phone ?? undefined,
    status: user.status,
    updatedAt: user.updatedAt.getTime(),
  };
}

function digestToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private nextExpiredSessionCleanupAtMs = 0;
  private expiredSessionCleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessions: Repository<SessionEntity>,
    private readonly passwords: PasswordService,
  ) {}

  onModuleInit(): void {
    void this.cleanupExpiredSessions().catch((error: unknown) => {
      this.logger.warn(
        `Failed to clean expired sessions on startup: ${String(error)}`,
      );
    });
    this.expiredSessionCleanupTimer = setInterval(() => {
      void this.cleanupExpiredSessions().catch((error: unknown) => {
        this.logger.warn(
          `Failed to clean expired sessions: ${String(error)}`,
        );
      });
    }, EXPIRED_SESSION_CLEANUP_INTERVAL_MS);
    this.expiredSessionCleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.expiredSessionCleanupTimer) {
      clearInterval(this.expiredSessionCleanupTimer);
    }
  }

  async login(
    username: string,
    password: string,
    now = new Date(),
  ): Promise<{
    user: PublicUser;
    token: string;
    expiresAt: Date;
  }> {
    await this.cleanupExpiredSessions(now);
    const normalized = normalizeUsername(username);
    const result: LoginTransactionResult = await this.users.manager.transaction(
      async (manager): Promise<LoginTransactionResult> => {
        const users = manager.getRepository(UserEntity);
        const sessions = manager.getRepository(SessionEntity);
        const user = normalized
          ? await users.findOne({
              where: { usernameNormalized: normalized },
              lock: { mode: "pessimistic_write" },
            })
          : null;

        if (!user) {
          await this.passwords.verifyUnknown(password);
          return {
            ok: false,
            failure: new AuthFailure(
              "INVALID_CREDENTIALS",
              "用户名或密码错误",
              401,
            ),
          };
        }
        if (user.status === "disabled") {
          return {
            ok: false,
            failure: new AuthFailure(
              "DISABLED",
              "账号已停用，请联系管理员",
              403,
            ),
          };
        }
        if (user.lockedUntil && user.lockedUntil > now) {
          return {
            ok: false,
            failure: new AuthFailure(
              "LOCKED",
              "登录尝试过多，请稍后再试",
              429,
              Math.max(
                1,
                Math.ceil(
                  (user.lockedUntil.getTime() - now.getTime()) / 1_000,
                ),
              ),
            ),
          };
        }

        if (!(await this.passwords.verify(user.passwordHash, password))) {
          return {
            ok: false,
            failure: await this.recordFailure(users, user, now),
          };
        }

        user.failedAttemptCount = 0;
        user.firstFailedAt = null;
        user.lockedUntil = null;
        await users.save(user);

        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
        await sessions.save(
          sessions.create({
            tokenHash: digestToken(token),
            accountId: user.id,
            expiresAt,
          }),
        );
        return { ok: true, user: toPublicUser(user), token, expiresAt };
      },
    );

    if (!result.ok) throw result.failure;
    return result;
  }

  async authenticate(
    token: string | null,
    now = new Date(),
  ): Promise<PublicUser | null> {
    await this.cleanupExpiredSessionsIfDue(now);
    if (!token) return null;
    const session = await this.sessions.findOne({
      where: {
        tokenHash: digestToken(token),
        expiresAt: MoreThan(now),
      },
      relations: { account: true },
    });
    if (!session?.account || session.account.status !== "active") {
      return null;
    }
    return toPublicUser(session.account);
  }

  async logout(token: string | null): Promise<void> {
    if (!token) return;
    await this.sessions.delete({ tokenHash: digestToken(token) });
  }

  async cleanupExpiredSessions(now = new Date()): Promise<number> {
    const result = await this.sessions.delete({
      expiresAt: LessThanOrEqual(now),
    });
    this.nextExpiredSessionCleanupAtMs =
      now.getTime() + EXPIRED_SESSION_CLEANUP_INTERVAL_MS;
    return result.affected ?? 0;
  }

  private async cleanupExpiredSessionsIfDue(now: Date): Promise<void> {
    if (now.getTime() < this.nextExpiredSessionCleanupAtMs) return;
    await this.cleanupExpiredSessions(now);
  }

  private async recordFailure(
    users: Repository<UserEntity>,
    user: UserEntity,
    now: Date,
  ): Promise<AuthFailure> {
    const withinWindow =
      user.firstFailedAt !== null &&
      now.getTime() - user.firstFailedAt.getTime() <= FAILURE_WINDOW_MS;
    user.failedAttemptCount = withinWindow
      ? user.failedAttemptCount + 1
      : 1;
    user.firstFailedAt = withinWindow ? user.firstFailedAt : now;

    if (user.failedAttemptCount >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
      await users.save(user);
      return new AuthFailure(
        "LOCKED",
        "登录尝试过多，请稍后再试",
        429,
        Math.ceil(LOCK_DURATION_MS / 1_000),
      );
    }

    user.lockedUntil = null;
    await users.save(user);
    return new AuthFailure(
      "INVALID_CREDENTIALS",
      "用户名或密码错误",
      401,
    );
  }
}
