import { existsSync } from "node:fs";

import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import {
  parseQualityLabEnvironment,
  type QualityLabEnvironment,
} from "../src/quality-lab/environment.js";
import { createQualityLabApp } from "../src/quality-lab/server.js";
import type { VideoQualityEvaluator } from "../src/quality-lab/server.js";
import type { NormalizedVideoQcResultV1 } from "../src/video-quality/video-quality.types.js";

function environment(
  overrides: Partial<QualityLabEnvironment> = {},
): QualityLabEnvironment {
  return {
    host: "127.0.0.1",
    port: 4010,
    maxUploadBytes: 1_024,
    modelTimeoutMs: 600_000,
    promptPath: "/quality/prompt.md",
    qwenApiKey: "configured",
    qwenBaseUrl: "https://workspace.example.com/compatible-mode/v1",
    initialModel: "qwen3.7-plus",
    reviewModel: "qwen3.7-flash",
    modelConfigured: true,
    historyPath: undefined,
    historyRetentionDays: 30,
    ...overrides,
  };
}

function result(videoId: string): NormalizedVideoQcResultV1 {
  return {
    schemaVersion: "video_qc_result_v2",
    ruleVersion: "video_qc_v2_traceable",
    promptVersion: "qwen_video_qc_prompt_v2_traceable",
    videoId,
    evaluationStatus: "scored",
    dimensions: {} as NormalizedVideoQcResultV1["dimensions"],
    rawTotalScore: 80,
    finalScore: 80,
    settlementRatio: 1,
    analysisDurationMs: 1_000,
    invalidDurationMs: 0,
    billableDurationMs: 1_000,
    invalidSegments: [],
    hardVeto: { triggered: false, reasons: [] },
    detectedTask: {
      scene_id: "",
      task_id: "",
      variant_id: "",
      task_summary: "test",
      confidence: 1,
    },
    deductions: [],
    recommendations: [],
    summary: "test",
    reviewRequired: false,
    reviewReasons: [],
    missingInputs: [],
    validation: { warnings: [], errors: [] },
    rawModelResult: {} as NormalizedVideoQcResultV1["rawModelResult"],
    modelRuns: [],
    media: {
      metadata: {} as NormalizedVideoQcResultV1["media"]["metadata"],
      technicalMetrics: {} as NormalizedVideoQcResultV1["media"]["technicalMetrics"],
      fullVideoSamplingFps: 0.2,
      fullVideoFrameCount: 4,
    },
  };
}

async function waitForTerminal(
  app: ReturnType<typeof createQualityLabApp>,
  jobId: string,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await request(app).get(`/api/jobs/${jobId}`);
    if (["completed", "review_pending", "system_failed", "cancelled"].includes(response.body.stage)) {
      return response;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("job did not finish");
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not reached");
}

describe("quality lab environment", () => {
  it("does not require platform infrastructure and reports missing model config", () => {
    const parsed = parseQualityLabEnvironment({});
    expect(parsed.host).toBe("127.0.0.1");
    expect(parsed.port).toBe(4010);
    expect(parsed.modelConfigured).toBe(false);
    expect(parsed.qwenApiKey).toBeUndefined();
    expect(parsed.initialModel).toBe("qwen3.7-plus");
    expect(parsed.reviewModel).toBe("qwen3.7-flash");
  });
});

describe("quality lab server", () => {
  it("assigns demand from fixed server constants and ignores client input", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const evaluate = vi.fn(async (input: Parameters<VideoQualityEvaluator["evaluate"]>[0]) => {
      expect(input.demandContext).toEqual({
        snapshotId: expect.stringMatching(/^quality-lab-LAB-/u),
        status: "推荐",
        coefficient: 0.8,
      });
      return result(input.videoId);
    });
    const app = createQualityLabApp({
      environment: environment(),
      evaluator: { evaluate },
    });

    const created = await request(app)
      .post("/api/jobs")
      .field("batchId", "batch-random-demand")
      .field("demandStatus", "紧缺")
      .attach("video", Buffer.from("video"), "sample.mp4")
      .expect(202);

    const completed = await waitForTerminal(app, created.body.jobId);
    expect(completed.body.demandStatus).toBe("推荐");
    expect(completed.body.demandCoefficient).toBe(0.8);
    expect(evaluate).toHaveBeenCalledOnce();
    random.mockRestore();
  });

  it("runs two evaluations in parallel and holds the third", async () => {
    const started: string[] = [];
    const releases: Array<() => void> = [];
    const evaluator: VideoQualityEvaluator = {
      evaluate: vi.fn(async (input) => {
        started.push(input.videoId);
        await new Promise<void>((resolve) => releases.push(resolve));
        return result(input.videoId);
      }),
    };
    const app = createQualityLabApp({ environment: environment(), evaluator });

    const jobs = [];
    for (const name of ["one.mp4", "two.mp4", "three.mp4"]) {
      const created = await request(app)
        .post("/api/jobs")
        .field("batchId", "batch-concurrency")
        .attach("video", Buffer.from("video"), name)
        .expect(202);
      jobs.push(created.body.jobId as string);
    }
    await waitUntil(() => started.length === 2);
    expect(started).toEqual(jobs.slice(0, 2));

    releases.shift()?.();
    await waitUntil(() => started.length === 3);
    expect(started[2]).toBe(jobs[2]);
    releases.splice(0).forEach((release) => release());
    await Promise.all(jobs.map((id) => waitForTerminal(app, id)));
  });

  it("accepts a multipart video, exposes progress, and removes temporary files", async () => {
    let temporaryPath = "";
    const evaluator: VideoQualityEvaluator = {
      evaluate: vi.fn(async (input, observer) => {
        temporaryPath = input.filePath;
        expect(existsSync(temporaryPath)).toBe(true);
        observer?.("media_analysis");
        observer?.("initial_review");
        return result(input.videoId);
      }),
    };
    const app = createQualityLabApp({ environment: environment(), evaluator });

    const created = await request(app)
      .post("/api/jobs")
      .field("batchId", "batch-one")
      .attach("video", Buffer.from("video"), {
        filename: "sample.mp4",
        contentType: "video/mp4",
      })
      .expect(202);

    expect(created.body.jobId).toMatch(/^LAB-/u);
    const completed = await waitForTerminal(app, created.body.jobId);
    expect(completed.body.stage).toBe("completed");
    expect(completed.body.result.finalScore).toBe(80);
    expect(JSON.stringify(completed.body)).not.toContain(temporaryPath);
    expect(existsSync(temporaryPath)).toBe(false);
  });

  it("rejects jobs when the model is unconfigured and enforces upload limits", async () => {
    const unavailable = createQualityLabApp({
      environment: environment({
        qwenApiKey: undefined,
        modelConfigured: false,
      }),
      evaluator: null,
    });
    const health = await request(unavailable).get("/api/health").expect(200);
    expect(health.body.modelStatus).toBe("not_configured");
    expect(health.body.concurrency).toBe(2);
    await request(unavailable)
      .post("/api/jobs")
      .field("batchId", "batch")
      .attach("video", Buffer.from("video"), "sample.mp4")
      .expect(503);

    const limited = createQualityLabApp({
      environment: environment({ maxUploadBytes: 4 }),
      evaluator: { evaluate: vi.fn() },
    });
    await request(limited)
      .post("/api/jobs")
      .field("batchId", "batch")
      .attach("video", Buffer.from("too-large"), "sample.mp4")
      .expect(413);
  });

  it("cancels an active job without exposing internal errors", async () => {
    const evaluator: VideoQualityEvaluator = {
      evaluate: vi.fn((_input, _observer, signal) =>
        new Promise<NormalizedVideoQcResultV1>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("/private/tmp/secret-video.mp4")));
        }),
      ),
    };
    const app = createQualityLabApp({ environment: environment(), evaluator });
    const created = await request(app)
      .post("/api/jobs")
      .field("batchId", "batch-cancel")
      .attach("video", Buffer.from("video"), "sample.mp4")
      .expect(202);

    await request(app).delete(`/api/jobs/${created.body.jobId}`).expect(202);
    const cancelled = await waitForTerminal(app, created.body.jobId);
    expect(cancelled.body.stage).toBe("cancelled");
    expect(JSON.stringify(cancelled.body)).not.toContain("/private/tmp");
  });

  it("lists persisted task IDs and deletes terminal history", async () => {
    const app = createQualityLabApp({
      environment: environment(),
      evaluator: {
        evaluate: vi.fn(async (input) => result(input.videoId)),
      },
    });
    const created = await request(app)
      .post("/api/jobs")
      .field("batchId", "batch-history")
      .attach("video", Buffer.from("video"), "26018_68.mp4")
      .expect(202);
    await waitForTerminal(app, created.body.jobId);

    const history = await request(app).get("/api/jobs").expect(200);
    expect(history.body.retentionDays).toBe(30);
    expect(history.body.jobs).toMatchObject([
      {
        id: created.body.jobId,
        fileName: "26018_68.mp4",
        stage: "completed",
        diagnostics: [],
      },
    ]);

    await request(app).delete(`/api/jobs/${created.body.jobId}`).expect(204);
    expect((await request(app).get("/api/jobs")).body.jobs).toEqual([]);
  });
});
