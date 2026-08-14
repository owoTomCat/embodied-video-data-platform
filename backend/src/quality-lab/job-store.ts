import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type {
  BailianCallDiagnostic,
  NormalizedVideoQcResultV1,
  QualityStage,
} from "../video-quality/video-quality.types.js";

export type PublicQualityLabJob = {
  id: string;
  batchId: string;
  fileName: string;
  sizeBytes: number;
  stage: QualityStage;
  createdAt: string;
  updatedAt: string;
  result?: Omit<NormalizedVideoQcResultV1, "rawModelResult">;
  error?: string;
  diagnostics: BailianCallDiagnostic[];
  demandStatus?: "紧缺" | "推荐" | "已饱和";
  demandCoefficient?: number;
};

export type QualityLabJobRecord = {
  public: PublicQualityLabJob;
  filePath: string;
  workDirectory: string;
  abortController: AbortController;
};

const terminalStages = new Set<QualityStage>([
  "completed",
  "review_pending",
  "system_failed",
  "cancelled",
]);

type PersistedDocument = {
  version: 1;
  savedAt: string;
  jobs: PublicQualityLabJob[];
};

type QualityLabJobStoreOptions = {
  persistencePath?: string;
  retentionMs?: number;
  now?: () => Date;
};

export function isTerminalQualityStage(stage: QualityStage): boolean {
  return terminalStages.has(stage);
}

function redactedText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
    .replace(/sk-(?:ws-)?[A-Za-z0-9._-]+/gu, "<redacted>")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gu, "<data-url-redacted>")
    .replace(/\/(?:private\/)?tmp\/[A-Za-z0-9_./ -]+/gu, "<temp>")
    .slice(0, 500);
}

function safeDiagnostic(value: BailianCallDiagnostic): BailianCallDiagnostic {
  return {
    ...value,
    ...(value.errorName ? { errorName: redactedText(value.errorName) } : {}),
    ...(value.errorCode ? { errorCode: redactedText(value.errorCode) } : {}),
    ...(value.errorMessage
      ? { errorMessage: redactedText(value.errorMessage) }
      : {}),
  };
}

export class QualityLabJobStore {
  private readonly jobs = new Map<string, QualityLabJobRecord>();
  private readonly hashesByBatch = new Map<string, Set<string>>();
  private readonly persistencePath?: string;
  private readonly retentionMs: number;
  private readonly now: () => Date;

  constructor(options: QualityLabJobStoreOptions = {}) {
    this.persistencePath = options.persistencePath;
    this.retentionMs = options.retentionMs ?? 30 * 24 * 60 * 60 * 1_000;
    this.now = options.now ?? (() => new Date());
    this.load();
  }

  create(input: {
    batchId: string;
    fileName: string;
    sizeBytes: number;
    filePath: string;
    workDirectory: string;
    demandStatus?: "紧缺" | "推荐" | "已饱和";
    demandCoefficient?: number;
  }): QualityLabJobRecord {
    this.sweep();
    const timestamp = this.now().toISOString();
    const id = `LAB-${randomUUID()}`;
    const record: QualityLabJobRecord = {
      public: {
        id,
        batchId: input.batchId,
        fileName: input.fileName,
        sizeBytes: input.sizeBytes,
        stage: "queued",
        createdAt: timestamp,
        updatedAt: timestamp,
        diagnostics: [],
        demandStatus: input.demandStatus,
        demandCoefficient: input.demandCoefficient,
      },
      filePath: input.filePath,
      workDirectory: input.workDirectory,
      abortController: new AbortController(),
    };
    this.jobs.set(id, record);
    this.persist();
    return record;
  }

  getRecord(id: string): QualityLabJobRecord | undefined {
    this.sweep();
    return this.jobs.get(id);
  }

  getPublic(id: string): PublicQualityLabJob | undefined {
    const record = this.getRecord(id);
    return record ? structuredClone(record.public) : undefined;
  }

  listPublic(): PublicQualityLabJob[] {
    this.sweep();
    return [...this.jobs.values()]
      .map((record) => structuredClone(record.public))
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  updateStage(id: string, stage: QualityStage): void {
    const record = this.jobs.get(id);
    if (!record || record.public.stage === "cancelled") return;
    record.public.stage = stage;
    record.public.updatedAt = this.now().toISOString();
    this.persist();
  }

  complete(id: string, result: NormalizedVideoQcResultV1): void {
    const record = this.jobs.get(id);
    if (!record || record.public.stage === "cancelled") return;
    const { rawModelResult: _discardedRawModelResult, ...safeResult } = result;
    record.public.result = safeResult;
    record.public.stage =
      result.evaluationStatus === "review_pending"
        ? "review_pending"
        : "completed";
    record.public.updatedAt = this.now().toISOString();
    this.persist();
  }

  fail(id: string, error: string): void {
    const record = this.jobs.get(id);
    if (!record || record.public.stage === "cancelled") return;
    record.public.stage = "system_failed";
    record.public.error = redactedText(error);
    record.public.updatedAt = this.now().toISOString();
    this.persist();
  }

  cancel(id: string): boolean {
    const record = this.jobs.get(id);
    if (!record || terminalStages.has(record.public.stage)) return false;
    record.public.stage = "cancelled";
    record.public.updatedAt = this.now().toISOString();
    record.abortController.abort(new Error("任务已取消"));
    this.persist();
    return true;
  }

  deleteTerminal(id: string): boolean {
    const record = this.jobs.get(id);
    if (!record || !terminalStages.has(record.public.stage)) return false;
    this.jobs.delete(id);
    this.cleanupHashes();
    this.persist();
    return true;
  }

  appendDiagnostic(id: string, diagnostic: BailianCallDiagnostic): void {
    const record = this.jobs.get(id);
    if (!record) return;
    record.public.diagnostics.push(safeDiagnostic(diagnostic));
    record.public.updatedAt = this.now().toISOString();
    this.persist();
  }

  registerSha256(batchId: string, sha256: string): boolean {
    const hashes = this.hashesByBatch.get(batchId) ?? new Set<string>();
    const duplicate = hashes.has(sha256);
    hashes.add(sha256);
    this.hashesByBatch.set(batchId, hashes);
    return duplicate;
  }

  private load(): void {
    if (!this.persistencePath || !existsSync(this.persistencePath)) return;
    const document = JSON.parse(
      readFileSync(this.persistencePath, "utf8"),
    ) as PersistedDocument;
    if (document.version !== 1 || !Array.isArray(document.jobs)) {
      throw new Error("AI 质检任务历史文件版本无效");
    }
    let changed = false;
    for (const publicJob of document.jobs) {
      const restored = structuredClone(publicJob);
      restored.diagnostics = Array.isArray(restored.diagnostics)
        ? restored.diagnostics.map(safeDiagnostic)
        : [];
      if (!terminalStages.has(restored.stage)) {
        restored.stage = "system_failed";
        restored.error = "服务重启导致任务中断，请重新上传";
        restored.updatedAt = this.now().toISOString();
        changed = true;
      }
      this.jobs.set(restored.id, {
        public: restored,
        filePath: "",
        workDirectory: "",
        abortController: new AbortController(),
      });
    }
    if (this.sweep(false) || changed) this.persist();
  }

  private sweep(persist = true): boolean {
    const cutoff = this.now().getTime() - this.retentionMs;
    let changed = false;
    for (const [id, record] of this.jobs) {
      if (
        terminalStages.has(record.public.stage) &&
        Date.parse(record.public.updatedAt) < cutoff
      ) {
        this.jobs.delete(id);
        changed = true;
      }
    }
    this.cleanupHashes();
    if (changed && persist) this.persist();
    return changed;
  }

  private cleanupHashes(): void {
    const activeBatches = new Set(
      [...this.jobs.values()].map((record) => record.public.batchId),
    );
    for (const batchId of this.hashesByBatch.keys()) {
      if (!activeBatches.has(batchId)) this.hashesByBatch.delete(batchId);
    }
  }

  private persist(): void {
    if (!this.persistencePath) return;
    mkdirSync(dirname(this.persistencePath), { recursive: true });
    const temporaryPath = `${this.persistencePath}.${process.pid}.${randomUUID()}.tmp`;
    const document: PersistedDocument = {
      version: 1,
      savedAt: this.now().toISOString(),
      jobs: [...this.jobs.values()].map((record) => record.public),
    };
    writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, this.persistencePath);
  }
}
