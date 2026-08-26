import { hostname } from "node:os";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import {
  WorkerHeartbeatEntity,
  type WorkerHeartbeatStatus,
  type WorkerKind,
} from "../database/entities/worker-heartbeat.entity.js";

const STALE_AFTER_MS = 60_000;
const DEFAULT_MEDIA_TASK_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_AI_TASK_TIMEOUT_MS = 10 * 60_000;
const MAX_ACTIVE_WORKERS = 50;
const MAX_INACTIVE_WORKERS = 20;

type WorkerHeartbeatUpdate = {
  status: WorkerHeartbeatStatus;
  currentSubmissionId?: string | null;
  currentTaskStartedAt?: Date | null;
  lastError?: string | null;
};

export type PublicWorkerHeartbeat = ReturnType<typeof publicWorker>;

export type WorkerHeartbeatList = {
  active: PublicWorkerHeartbeat[];
  inactive: PublicWorkerHeartbeat[];
  inactiveCount: number;
};

function publicWorker(worker: WorkerHeartbeatEntity, now = Date.now()) {
  const lastSeenAt = worker.lastSeenAt.getTime();
  const currentTaskStartedAt = worker.currentTaskStartedAt?.getTime();
  const currentTaskAgeMs =
    currentTaskStartedAt === undefined
      ? undefined
      : Math.max(0, now - currentTaskStartedAt);
  const taskTimeoutMs = workerTaskTimeoutMs(worker.kind);
  return {
    id: worker.id,
    kind: worker.kind,
    hostName: worker.hostName,
    processId: worker.processId,
    status: worker.status,
    currentSubmissionId: worker.currentSubmissionId ?? undefined,
    currentTaskStartedAt,
    currentTaskAgeMs,
    completedTaskCount: worker.completedTaskCount,
    failedTaskCount: worker.failedTaskCount,
    lastTaskDurationMs: worker.lastTaskDurationMs ?? undefined,
    averageTaskDurationMs:
      worker.completedTaskCount === 0
        ? 0
        : Math.round(Number(worker.totalTaskDurationMs) / worker.completedTaskCount),
    maxTaskDurationMs: worker.maxTaskDurationMs,
    runningTooLong:
      worker.status === "running" &&
      currentTaskAgeMs !== undefined &&
      currentTaskAgeMs > taskTimeoutMs,
    taskTimeoutMs,
    lastError: worker.lastError ?? undefined,
    startedAt: worker.startedAt.getTime(),
    lastSeenAt,
    stale: worker.status !== "stopped" && now - lastSeenAt > STALE_AFTER_MS,
  };
}

function workerTaskTimeoutMs(kind: WorkerKind): number {
  if (kind === "ai_quality") {
    return parseTimeout(
      process.env.AI_QUALITY_MODEL_TIMEOUT_MS,
      DEFAULT_AI_TASK_TIMEOUT_MS,
    );
  }
  return parseTimeout(
    process.env.MEDIA_WORKER_TASK_TIMEOUT_MS,
    DEFAULT_MEDIA_TASK_TIMEOUT_MS,
  );
}

function parseTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim() || fallback);
  if (!Number.isInteger(parsed) || parsed < 10_000) return fallback;
  return parsed;
}

@Injectable()
export class WorkerHeartbeatService {
  constructor(
    @InjectRepository(WorkerHeartbeatEntity)
    private readonly workers: Repository<WorkerHeartbeatEntity>,
  ) {}

  async start(kind: WorkerKind, id = this.defaultId(kind)): Promise<string> {
    const now = new Date();
    await this.workers.save({
      id,
      kind,
      hostName: hostname(),
      processId: process.pid,
      status: "idle",
      currentSubmissionId: null,
      currentTaskStartedAt: null,
      lastError: null,
      startedAt: now,
      lastSeenAt: now,
    });
    return id;
  }

  async beat(id: string, update: WorkerHeartbeatUpdate): Promise<void> {
    await this.workers.update(
      { id },
      {
        status: update.status,
        currentSubmissionId: update.currentSubmissionId ?? null,
        currentTaskStartedAt: update.currentTaskStartedAt ?? null,
        lastError: update.lastError ?? null,
        lastSeenAt: new Date(),
      },
    );
  }

  async stop(id: string): Promise<void> {
    await this.beat(id, { status: "stopped" });
  }

  async recordTaskFinished(input: {
    id: string;
    durationMs: number;
    failed: boolean;
  }): Promise<void> {
    const worker = await this.workers.findOneBy({ id: input.id });
    if (!worker) return;
    const safeDurationMs = Math.max(0, Math.round(input.durationMs));
    worker.completedTaskCount += 1;
    if (input.failed) worker.failedTaskCount += 1;
    worker.totalTaskDurationMs = (
      BigInt(worker.totalTaskDurationMs) + BigInt(safeDurationMs)
    ).toString();
    worker.lastTaskDurationMs = safeDurationMs;
    worker.maxTaskDurationMs = Math.max(worker.maxTaskDurationMs, safeDurationMs);
    worker.lastSeenAt = new Date();
    await this.workers.save(worker);
  }

  /**
   * 分组心跳：active 为当前存活且正常心跳的 Worker（默认只展示这些）；
   * inactive 为已停止或心跳过期的历史记录，仅保留最近若干条用于折叠展示。
   */
  async list(): Promise<WorkerHeartbeatList> {
    const workers = await this.workers.find({
      order: { lastSeenAt: "DESC" },
      take: 100,
    });
    const mapped = workers.map((worker) => publicWorker(worker));
    const active = mapped.filter(
      (worker) => worker.status !== "stopped" && !worker.stale,
    );
    const inactive = mapped.filter(
      (worker) => worker.status === "stopped" || worker.stale,
    );
    return {
      active: active.slice(0, MAX_ACTIVE_WORKERS),
      inactive: inactive.slice(0, MAX_INACTIVE_WORKERS),
      inactiveCount: inactive.length,
    };
  }

  /**
   * 全部心跳（含已停止/过期），供超时回收与告警计算使用。
   */
  async listAll(): Promise<PublicWorkerHeartbeat[]> {
    const workers = await this.workers.find({
      order: { lastSeenAt: "DESC" },
      take: 100,
    });
    return workers.map((worker) => publicWorker(worker));
  }

  /**
   * 删除所有已停止或心跳过期的历史心跳记录。
   */
  async pruneInactive(): Promise<number> {
    const result = await this.workers
      .createQueryBuilder()
      .delete()
      .where('"status" = :stopped OR "last_seen_at" < :staleBefore', {
        stopped: "stopped",
        staleBefore: new Date(Date.now() - STALE_AFTER_MS),
      })
      .execute();
    return result.affected ?? 0;
  }

  private defaultId(kind: WorkerKind): string {
    return `${kind}-${hostname()}-${process.pid}`;
  }
}
