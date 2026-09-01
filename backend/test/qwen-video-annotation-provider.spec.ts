import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadVideoAnnotationPrompt } from "../src/video-annotation/prompt-loader.js";
import {
  QwenVideoAnnotationProvider,
  VideoAnnotationProviderError,
} from "../src/video-annotation/qwen-video-annotation.provider.js";

function modelOutput() {
  return {
    schema_version: "ego_video_annotation_v2",
    video_id: "video-1",
    video_summary: "拿起杯子并放下。",
    scene: {
      coarse_label: "indoor",
      fine_label: "kitchen",
      confidence: 0.9,
      evidence_timestamps_ms: [0, 750],
    },
    temporal_structure_type: "single_task",
    model_assessability: "assessable",
    assessability_reason: "四个密集采样点支持当前可见任务。",
    tasks: [
      {
        start_ms: 0,
        end_ms: 750,
        task_label: "放置杯子",
        task_verb: "pick_and_place",
        task_object: "杯子",
        evidence_level: "direct_visual",
        execution_pattern: "single_goal",
        evidence_timestamps_ms: [0, 250, 500, 750],
        manipulated_objects: ["杯子"],
        tools: [],
        hand_mode: "right",
        atomic_action_sequence: [
          {
            order: 1,
            verb: "move",
            object: "杯子",
            evidence_timestamps_ms: [0, 500],
          },
          {
            order: 2,
            verb: "release",
            object: "杯子",
            evidence_timestamps_ms: [750],
          },
        ],
        interaction_primitives: ["grasp", "release"],
        completion: "complete",
        result_observability: "visible",
        result_status: "success",
        result_evidence_type: "direct_visible_postcondition",
        visible_postcondition: "杯子已放在桌面。",
        result_evidence_timestamps_ms: [500, 750],
        failure_recovery: "none_observed",
        failure_evidence_timestamps_ms: [],
        recovery_evidence_timestamps_ms: [],
        complexity_signals: [],
        uncertainty_reasons: [],
        confidence: 0.9,
      },
    ],
    coverage_segments: [
      {
        start_ms: 0,
        end_ms: 750,
        segment_type: "task",
        linked_task_index: 0,
        visible_activity: "拿起并放置杯子",
        evidence_timestamps_ms: [0, 250, 500, 750],
      },
    ],
    uncertain_fields: [],
    global_limitations: [],
  };
}

describe("qwen video annotation provider", () => {
  it("preserves provider failures for the independent run state machine", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    const fetcher = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher,
    });

    const calls: Array<{ callKind: string; callStatus: string; httpStatus: number | null }> = [];
    await expect(
      provider.annotateStrict({
        videoId: "video-1",
        durationMs: 750,
        frames: [0, 250, 500, 750].map((timestampMs) => ({
          timestampMs,
          dataUrl: "data:image/jpeg;base64,AA==",
        })),
        enabledLabels: [],
      }, undefined, {
        logicalFullAttempt: 1,
        onModelCall: async (call) => {
          calls.push(call);
        },
      }),
    ).rejects.toBeInstanceOf(VideoAnnotationProviderError);
    expect(calls).toEqual([
      expect.objectContaining({ callKind: "full", callStatus: "failed", httpStatus: 404 }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("uses at most one schema repair and records every actual provider call", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    const response = (content: string, requestId: string) =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          request_id: requestId,
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response("not-json", "request-full"))
      .mockResolvedValueOnce(response(JSON.stringify(modelOutput()), "request-schema"));
    const calls: Array<{ callKind: string; callStatus: string; totalTokens: number | null }> = [];
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher,
    });

    const result = await provider.annotateStrict({
      videoId: "video-1",
      durationMs: 750,
      frames: [0, 250, 500, 750].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      enabledLabels: [],
    }, undefined, {
      logicalFullAttempt: 1,
      onModelCall: async (call) => {
        calls.push(call);
      },
    });

    expect(result.status).toBe("candidate");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([
      expect.objectContaining({ callKind: "full", callStatus: "succeeded", totalTokens: 30 }),
      expect.objectContaining({ callKind: "schema_repair", callStatus: "succeeded", totalTokens: 30 }),
    ]);
  });

  it("performs one targeted repair for structurally valid evidence conflicts", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    const invalid = modelOutput();
    // coverage 引用损坏（绑定不存在的任务）仍是结构性错误，触发定向修复
    invalid.coverage_segments[0]!.linked_task_index = 5;
    const response = (output: ReturnType<typeof modelOutput>) =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(invalid))
      .mockResolvedValueOnce(response(modelOutput()));
    const callKinds: string[] = [];
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher,
    });

    const result = await provider.annotateStrict({
      videoId: "video-1",
      durationMs: 750,
      frames: [0, 250, 500, 750].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      enabledLabels: [],
    }, undefined, {
      logicalFullAttempt: 1,
      onModelCall: async (call) => {
        callKinds.push(call.callKind);
      },
    });

    expect(result.gate.eligibility).toBe("eligible");
    expect(callKinds).toEqual(["full", "targeted_repair"]);
    expect(result.gate.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ level: "retryable", resolution: "retried" }),
      ]),
    );
  });

  it("fixes invalid enums and oversized evidence deterministically without extra calls", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    const invalid = modelOutput();
    invalid.tasks[0]!.result_observability = "visible_observation";
    invalid.tasks[0]!.evidence_timestamps_ms = Array.from({ length: 25 }, (_, index) => index * 100);
    const response = (output: ReturnType<typeof modelOutput>) =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(invalid));
    const callKinds: string[] = [];
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher,
    });

    const result = await provider.annotateStrict({
      videoId: "video-1",
      durationMs: 2_500,
      frames: [...Array.from({ length: 25 }, (_, index) => ({
        timestampMs: index * 100,
        dataUrl: "data:image/jpeg;base64,AA==",
      })), { timestampMs: 250, dataUrl: "x" }, { timestampMs: 750, dataUrl: "x" }],
      enabledLabels: [],
    }, undefined, {
      logicalFullAttempt: 1,
      onModelCall: async (call) => {
        callKinds.push(call.callKind);
      },
    });

    expect(result.status).toBe("candidate");
    expect(callKinds).toEqual(["full"]);
    expect(result.effective.tasks[0]!.result_observability).toBe("partial");
    expect(result.effective.tasks[0]!.evidence_timestamps_ms).toHaveLength(20);
    expect(result.gate.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ENUM_VALUE_CONSERVATIVE_FIX", resolution: "repaired" }),
        expect.objectContaining({ code: "EVIDENCE_ARRAY_DOWNSAMPLED", resolution: "repaired" }),
      ]),
    );
  });

  it("aligns schema-valid approximate timestamps before evidence validation", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    const approximate = modelOutput();
    approximate.scene.evidence_timestamps_ms = [10, 740];
    approximate.tasks[0]!.start_ms = 10;
    approximate.tasks[0]!.end_ms = 740;
    approximate.tasks[0]!.evidence_timestamps_ms = [10, 260, 490, 740];
    approximate.tasks[0]!.atomic_action_sequence[0]!.evidence_timestamps_ms = [10, 490];
    approximate.tasks[0]!.atomic_action_sequence[1]!.evidence_timestamps_ms = [740];
    approximate.tasks[0]!.result_evidence_timestamps_ms = [490, 740];
    approximate.coverage_segments[0]!.start_ms = 10;
    approximate.coverage_segments[0]!.end_ms = 740;
    approximate.coverage_segments[0]!.evidence_timestamps_ms = [10, 260, 490, 740];
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(approximate) } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher,
    });

    const result = await provider.annotateStrict({
      videoId: "video-1",
      durationMs: 750,
      frames: [0, 250, 500, 750].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      enabledLabels: [],
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.gate.eligibility).toBe("eligible");
    expect(result.effective.tasks[0]).toMatchObject({ start_ms: 0, end_ms: 750 });
    expect(result.gate.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "EVIDENCE_TIMESTAMPS_ALIGNED", resolution: "repaired" }),
        expect.objectContaining({ code: "TASK_BOUNDARY_ALIGNED", resolution: "repaired" }),
      ]),
    );
  });

  it("normalizes mismatched video_id from wrapped output deterministically", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    const wrapped = {
      video_id: "video-1",
      duration_ms: 1000,
      frame_manifest: "x",
      frame_timestamps_ms: [0, 500],
      annotation_context: { enabled_labels: [] },
      requested_output_schema: "s",
      output_contract: { ...modelOutput(), video_id: "wrong-video" },
    };
    const response = (output: unknown) =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    const fetcher = vi.fn().mockResolvedValueOnce(response(wrapped));
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher,
    });

    const result = await provider.annotateStrict({
      videoId: "video-1",
      durationMs: 1_000,
      frames: [0, 250, 500, 750, 1_000].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      enabledLabels: [],
    }, undefined, {
      logicalFullAttempt: 1,
      onModelCall: async () => undefined,
    });

    expect(result.status).toBe("candidate");
    expect(result.effective.video_id).toBe("video-1");
    expect(result.gate.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "VIDEO_ID_NORMALIZED", resolution: "repaired" }),
      ]),
    );
  });

  it("loads versioned prompt assets and sends only task-blind annotation context", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(modelOutput()) } }],
          request_id: "request-1",
          model: "qwen3.7-plus-2026-05-26",
          usage: {
            prompt_tokens: 100,
            completion_tokens: 200,
            total_tokens: 300,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher,
    });

    const result = await provider.annotate({
      videoId: "video-1",
      durationMs: 750,
      frames: [0, 250, 500, 750].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      enabledLabels: [
        { id: "scene-kitchen", name: "厨房", type: "scene" },
      ],
    });

    expect(result.status).toBe("candidate");
    const requestInit = fetcher.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ content: unknown }>;
      temperature: number;
      max_tokens: number;
    };
    const userContent = body.messages[1]!.content as Array<{
      type: string;
      text?: string;
    }>;
    const context = JSON.parse(
      [...userContent].reverse().find((part) => part.type === "text")!.text!,
    ) as Record<string, unknown>;
    expect(userContent.slice(0, 4).map((part) => part.type)).toEqual([
      "text",
      "image_url",
      "text",
      "image_url",
    ]);
    expect(userContent[0]!.text).toBe("FRAME 0 | timestamp_ms=0");
    expect(context).toMatchObject({
      video_id: "video-1",
      frame_manifest: [
        { frame_index: 0, timestamp_ms: 0 },
        { frame_index: 1, timestamp_ms: 250 },
        { frame_index: 2, timestamp_ms: 500 },
        { frame_index: 3, timestamp_ms: 750 },
      ],
      annotation_context: {
        enabled_labels: [
          { id: "scene-kitchen", name: "厨房", type: "scene" },
        ],
      },
    });
    expect(context).not.toHaveProperty("task_requirements");
    expect(context).not.toHaveProperty("quality_result");
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(8_000);
    expect(result).toMatchObject({
      responseModel: "qwen3.7-plus-2026-05-26",
      usage: {
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
      },
    });
  });

  it("returns a non-authoritative failure artifact instead of throwing", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher: vi.fn().mockRejectedValue(new Error("Bearer sk-secret network error")),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    const result = await provider.annotate({
      videoId: "video-1",
      durationMs: 750,
      frames: [0, 250, 500, 750].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      enabledLabels: [],
    });

    expect(result).toMatchObject({ status: "system_failed" });
    if (result.status === "system_failed") {
      expect(result.error).not.toContain("sk-secret");
      expect(result.error).toContain("<redacted>");
    }
  });

  it("deterministically limits long inputs to the supported 80-frame sequence", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    const sourceFrames = Array.from({ length: 96 }, (_, index) => ({
      timestampMs: index * 250,
      dataUrl: "data:image/jpeg;base64,AA==",
    }));
    const selectedTimestamps = Array.from({ length: 80 }, (_, index) =>
      sourceFrames[Math.round((index * 95) / 79)]!.timestampMs,
    );
    const output = modelOutput();
    output.tasks[0]!.end_ms = 23_750;
    output.tasks[0]!.evidence_timestamps_ms = [
      selectedTimestamps[0]!,
      selectedTimestamps[26]!,
      selectedTimestamps[52]!,
      selectedTimestamps[79]!,
    ];
    output.tasks[0]!.atomic_action_sequence = [
      {
        order: 1,
        verb: "move",
        object: "杯子",
        evidence_timestamps_ms: [selectedTimestamps[0]!, selectedTimestamps[26]!],
      },
      {
        order: 2,
        verb: "release",
        object: "杯子",
        evidence_timestamps_ms: [selectedTimestamps[79]!],
      },
    ];
    output.tasks[0]!.result_evidence_timestamps_ms = [
      selectedTimestamps[52]!,
      selectedTimestamps[79]!,
    ];
    output.scene.evidence_timestamps_ms = [selectedTimestamps[0]!, selectedTimestamps[79]!];
    output.coverage_segments[0] = {
      start_ms: selectedTimestamps[0]!,
      end_ms: selectedTimestamps[79]!,
      segment_type: "task",
      linked_task_index: 0,
      visible_activity: "拿起并放置杯子",
      evidence_timestamps_ms: selectedTimestamps,
    };
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(output) } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      prompt,
      fetcher,
    });

    const result = await provider.annotate({
      videoId: "video-1",
      durationMs: 23_750,
      frames: sourceFrames,
      enabledLabels: [],
    });

    expect(result.status).toBe("candidate");
    if (result.status !== "system_failed") {
      expect(result.frameCount).toBe(80);
      expect(result.sampling.sourceTimestampsMs).toHaveLength(80);
      expect(result.sampling.sourceTimestampsMs[0]).toBe(0);
      expect(result.sampling.sourceTimestampsMs.at(-1)).toBe(23_750);
    }
    const requestInit = fetcher.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(requestInit.body)) as {
      messages: Array<{ content: Array<{ type: string; text?: string }> }>;
    };
    expect(
      body.messages[1]!.content.filter((part) => part.type === "image_url"),
    ).toHaveLength(80);
  });

  it("limits concurrent shadow model calls across submissions", async () => {
    const prompt = await loadVideoAnnotationPrompt(
      resolve(process.cwd(), "../docs/quality/prompts/ego-video-annotation-v2"),
    );
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolveGate) => {
      releaseFirst = resolveGate;
    });
    let callCount = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) await firstGate;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(modelOutput()) } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const provider = new QwenVideoAnnotationProvider({
      apiKey: "test-key",
      baseUrl: "https://example.invalid/v1",
      timeoutMs: 1_000,
      maxConcurrency: 1,
      prompt,
      fetcher,
    });
    const request = {
      videoId: "video-1",
      durationMs: 750,
      frames: [0, 250, 500, 750].map((timestampMs) => ({
        timestampMs,
        dataUrl: "data:image/jpeg;base64,AA==",
      })),
      enabledLabels: [],
    };

    const first = provider.annotate(request);
    const second = provider.annotate(request);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    releaseFirst();
    await Promise.all([first, second]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
