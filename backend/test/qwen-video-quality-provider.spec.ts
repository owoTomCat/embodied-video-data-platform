import { describe, expect, it, vi } from "vitest";

import type { LoadedVideoQualityPrompt } from "../src/video-quality/prompt-loader.js";
import {
  BailianRequestError,
  QwenVideoQualityProvider,
} from "../src/video-quality/qwen-video-quality.provider.js";
import type {
  DimensionKey,
  RawVideoQcResultV1,
  VideoQcInputV1,
} from "../src/video-quality/video-quality.types.js";

const keys: DimensionKey[] = [
  "first_person_and_composition",
  "hand_forearm_object_integrity",
  "frame_and_video_quality",
  "task_authenticity_completeness",
  "task_value_uniqueness",
];

function rawResult(): RawVideoQcResultV1 {
  const segments: Partial<Record<DimensionKey, Array<Record<string, unknown>>>> = {
    first_person_and_composition: [{ start_ms: 0, end_ms: 1, evidence_timestamps_ms: [0], c_pov: 1, c_angle: 1, c_orientation: 1, c_arm_entry: 1 }],
    hand_forearm_object_integrity: [{ start_ms: 0, end_ms: 1, evidence_timestamps_ms: [0], hand_required: true, c_completeness: 1, c_edge: 1, c_scale: 1, c_occlusion: 1, c_object_visibility: 1 }],
    frame_and_video_quality: [{ start_ms: 0, end_ms: 1, evidence_timestamps_ms: [0], c_sharpness: 1, c_exposure: 1, c_stability: 1, c_continuity: 1 }],
    task_authenticity_completeness: [{ start_ms: 0, end_ms: 1, evidence_timestamps_ms: [0], level: "L3", c_level: 1, c_authenticity: 1, c_progress: 1 }],
    task_value_uniqueness: [],
  };
  return {
    schema_version: "video_qc_result_v2",
    rule_version: "video_qc_v2_traceable",
    prompt_version: "qwen_video_qc_prompt_v2_traceable",
    video_id: "LAB-1",
    evaluation_status: "scored",
    hard_veto: { triggered: false, reasons: [] },
    detected_task: {
      scene_id: "kitchen",
      task_id: "clean",
      variant_id: "",
      task_summary: "清洁物体",
      confidence: 0.9,
    },
    dimensions: Object.fromEntries(
      keys.map((key) => [
        key,
        {
          coefficient: 1,
          score: key === "task_value_uniqueness" ? 0 : 25,
          confidence: 0.9,
          calculation_trace: key === "task_value_uniqueness"
            ? "平台需求快照 C_demand=1.0"
            : "按维度系数计算：25 × 1.0",
          segments: segments[key] ?? [],
          issues: [],
          ...(key === "hand_forearm_object_integrity" ? { hand_active_duration_ms: 1 } : {}),
          ...(key === "frame_and_video_quality" ? { c_spec: 1, c_visual: 1 } : {}),
          ...(key === "task_authenticity_completeness" ? { completion_coefficient: 1 } : {}),
        },
      ]),
    ) as unknown as RawVideoQcResultV1["dimensions"],
    billing_observations: {
      candidate_invalid_segments: [],
      candidate_valid_waiting_segments: [],
    },
    raw_total_score: 100,
    final_score: 100,
    summary: "质量稳定",
    deductions: [],
    recommendations: [],
    review_required: false,
    review_reasons: [],
    missing_inputs: [],
  };
}

function response(
  content: string,
  status = 200,
  requestId = "req-123",
): Response {
  return new Response(
    status >= 200 && status < 300
      ? JSON.stringify({
          choices: [{ message: { content } }],
          request_id: requestId,
        })
      : content,
    {
      status,
      headers: {
        "content-type": "application/json",
        "x-request-id": requestId,
      },
    },
  );
}

const prompt: LoadedVideoQualityPrompt = {
  systemPrompt: "system prompt",
  outputExample: rawResult() as unknown as Record<string, unknown>,
  promptVersion: "qwen_video_qc_prompt_v2_traceable",
  ruleVersion: "video_qc_v2_traceable",
  outputSchema: "video_qc_result_v2",
  initialModel: "qwen3.7-plus",
  reviewModel: "qwen3.7-flash",
  contentSha256: "c".repeat(64),
};

const input = {
  schema_version: "video_qc_input_v1",
  video_id: "LAB-1",
} as VideoQcInputV1;

function provider(fetcher: typeof fetch) {
  const diagnostics: import("../src/video-quality/video-quality.types.js").BailianCallDiagnostic[] = [];
  return new QwenVideoQualityProvider({
    config: {
      apiKey: "secret-test-key",
      baseUrl: "https://workspace.example.com/compatible-mode/v1/",
      initialModel: prompt.initialModel,
      reviewModel: prompt.reviewModel,
      timeoutMs: 10_000,
    },
    prompt,
    fetcher,
    sleep: async () => undefined,
    diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
  });
}

function providerWithDiagnostics(fetcher: typeof fetch) {
  const diagnostics: import("../src/video-quality/video-quality.types.js").BailianCallDiagnostic[] = [];
  const instance = new QwenVideoQualityProvider({
    config: {
      apiKey: "secret-test-key",
      baseUrl: "https://workspace.example.com/compatible-mode/v1/",
      initialModel: prompt.initialModel,
      reviewModel: prompt.reviewModel,
      timeoutMs: 10_000,
    },
    prompt,
    fetcher,
    sleep: async () => undefined,
    diagnosticSink: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { instance, diagnostics };
}

describe("Qwen video quality provider", () => {
  it("calls Qwen3.7 Plus for initial review with frame-array video input", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(JSON.stringify(rawResult())),
    );

    const result = await provider(fetcher).analyze({
      input,
      frames: [
        { timestampMs: 0, dataUrl: "data:image/jpeg;base64,AA==" },
        { timestampMs: 5_000, dataUrl: "data:image/jpeg;base64,AQ==" },
      ],
    });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, any>;
    expect(url).toBe(
      "https://workspace.example.com/compatible-mode/v1/chat/completions",
    );
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-test-key",
    );
    expect(body.model).toBe("qwen3.7-plus");
    expect(body.enable_thinking).toBe(false);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content[0]).toEqual({
      type: "video",
      video: [
        "data:image/jpeg;base64,AA==",
        "data:image/jpeg;base64,AQ==",
      ],
    });
    const textInput = JSON.parse(body.messages[1].content[1].text) as Record<
      string,
      any
    >;
    expect(textInput.output_contract.hard_veto.triggered).toBe(false);
    expect(textInput.output_requirements.join(" ")).toContain("不得改名或遗漏字段");
    expect(textInput.output_requirements.join(" ")).toContain("简体中文");
    expect(result.raw.final_score).toBe(100);
    expect(result.metadata.requestId).toBe("req-123");
    expect(result.metadata.stage).toBe("initial");
    expect(JSON.stringify(result)).not.toContain("secret-test-key");
  });

  it("retries retryable responses but not authentication errors", async () => {
    const retryingFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response('{"code":"Throttled"}', 429))
      .mockResolvedValueOnce(response(JSON.stringify(rawResult())));

    await provider(retryingFetch).analyze({ input, frames: [] });
    expect(retryingFetch).toHaveBeenCalledTimes(2);

    const authFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response('{"message":"bad secret-test-key"}', 401));
    let caught: unknown;
    try {
      await provider(authFetch).analyze({ input, frames: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BailianRequestError);
    expect((caught as Error).message).not.toContain("secret-test-key");
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it("extracts fenced JSON and repairs one invalid schema response", async () => {
    const fencedFetch = vi.fn<typeof fetch>().mockResolvedValue(
      response(`\`\`\`json\n${JSON.stringify(rawResult())}\n\`\`\``),
    );
    expect(
      (await provider(fencedFetch).analyze({ input, frames: [] })).raw
        .schema_version,
    ).toBe("video_qc_result_v2");

    const repairFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("{}"))
      .mockResolvedValueOnce(response(JSON.stringify(rawResult())));
    const repaired = await provider(repairFetch).analyze({ input, frames: [] });
    expect(repaired.raw.final_score).toBe(100);
    expect(repairFetch).toHaveBeenCalledTimes(2);
    const repairBody = JSON.parse(
      String(repairFetch.mock.calls[1]?.[1]?.body),
    ) as Record<string, any>;
    expect(repairBody.model).toBe("qwen3.7-plus");
    expect(repairBody.messages.at(-1).content[0].text).toContain(
      "video_qc_result_v2",
    );
    expect(repairBody.messages.at(-1).content[0].text).toContain(
      '"hard_veto"',
    );
  });

  it("repairs structurally valid results whose natural-language fields are English", async () => {
    const english = rawResult();
    english.detected_task.task_summary = "Clean an object";
    english.summary = "The video quality is stable";
    english.recommendations = ["Keep the camera steady"];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(JSON.stringify(english), 200, "req-en"))
      .mockResolvedValueOnce(response(JSON.stringify(rawResult()), 200, "req-zh"));

    const result = await provider(fetcher).analyze({ input, frames: [] });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const repairBody = JSON.parse(
      String(fetcher.mock.calls[1]?.[1]?.body),
    ) as Record<string, any>;
    expect(repairBody.messages.at(-1).content[0].text).toContain("简体中文");
    expect(repairBody.messages.at(-1).content[0].text).toContain(
      "detected_task.task_summary",
    );
    expect(result.raw.summary).toBe("质量稳定");
  });

  it("repairs a sub-full dimension that has no deduction explanation", async () => {
    const unexplained = rawResult();
    unexplained.dimensions.hand_forearm_object_integrity.coefficient = 0.92;
    unexplained.dimensions.hand_forearm_object_integrity.score = 23;
    unexplained.raw_total_score = 98;
    unexplained.final_score = 98;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(JSON.stringify(unexplained), 200, "req-missing"))
      .mockResolvedValueOnce(response(JSON.stringify(rawResult()), 200, "req-fixed"));

    const result = await provider(fetcher).analyze({ input, frames: [] });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.raw.final_score).toBe(100);
    const repairBody = JSON.parse(
      String(fetcher.mock.calls[1]?.[1]?.body),
    ) as Record<string, any>;
    expect(repairBody.messages.at(-1).content[0].text).toContain("没有扣分原因");
    expect(repairBody.messages.at(-1).content[0].text).toContain("issue_contract=");
  });

  it("normalizes a missing observed_value from the required description", async () => {
    const resultWithIssue = rawResult();
    resultWithIssue.dimensions.hand_forearm_object_integrity.coefficient = 0.85;
    resultWithIssue.dimensions.hand_forearm_object_integrity.score = 21.3;
    resultWithIssue.dimensions.hand_forearm_object_integrity.segments[0]!.c_scale = 0.85;
    resultWithIssue.dimensions.hand_forearm_object_integrity.issues = [{
      reason_code: "HAND_SCALE_TOO_LARGE",
      description: "操作区域持续占画面约 60%",
      start_ms: 0,
      end_ms: 1,
      severity: "minor",
      confidence: 0.9,
      evidence_timestamps_ms: [0],
      subcriterion: "SCALE",
      matched_level: "55%～70%",
      coefficient: 0.85,
      evidence_source: "model",
      recommendation: "适当拉远镜头",
    }];
    resultWithIssue.raw_total_score = 96.3;
    resultWithIssue.final_score = 96.3;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(JSON.stringify(resultWithIssue)),
    );

    const result = await provider(fetcher).analyze({ input, frames: [] });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      result.raw.dimensions.hand_forearm_object_integrity.issues[0]?.observed_value,
    ).toBe("操作区域持续占画面约 60%");
  });

  it("still repairs a deduction that has no evidence timestamp", async () => {
    const unsupported = rawResult();
    unsupported.dimensions.hand_forearm_object_integrity.coefficient = 0.85;
    unsupported.dimensions.hand_forearm_object_integrity.score = 21.3;
    unsupported.dimensions.hand_forearm_object_integrity.segments[0]!.c_scale = 0.85;
    unsupported.dimensions.hand_forearm_object_integrity.issues = [{
      reason_code: "HAND_SCALE_TOO_LARGE",
      description: "操作区域持续占画面约 60%",
      observed_value: "操作区域约占画面 60%",
      start_ms: 0,
      end_ms: 1,
      severity: "minor",
      confidence: 0.9,
      evidence_timestamps_ms: [],
      subcriterion: "SCALE",
      matched_level: "55%～70%",
      coefficient: 0.85,
      evidence_source: "model",
      recommendation: "适当拉远镜头",
    }];
    unsupported.raw_total_score = 96.3;
    unsupported.final_score = 96.3;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(JSON.stringify(unsupported), 200, "req-no-evidence"))
      .mockResolvedValueOnce(response(JSON.stringify(rawResult()), 200, "req-repaired"));

    await provider(fetcher).analyze({ input, frames: [] });

    expect(fetcher).toHaveBeenCalledTimes(2);
    const repairBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as Record<string, any>;
    expect(repairBody.messages.at(-1).content[0].text).toContain("缺少证据时间点");
  });

  it("normalizes ffprobe and metadata evidence aliases to detector", async () => {
    const resultWithAlias = rawResult();
    resultWithAlias.dimensions.frame_and_video_quality.coefficient = 0.8;
    resultWithAlias.dimensions.frame_and_video_quality.score = 20;
    resultWithAlias.dimensions.frame_and_video_quality.c_spec = 0.8;
    resultWithAlias.dimensions.frame_and_video_quality.issues = [{
      reason_code: "LOW_RESOLUTION",
      description: "视频短边分辨率为 720px",
      observed_value: "短边 720px",
      start_ms: 0,
      end_ms: 1,
      severity: "minor",
      confidence: 1,
      evidence_timestamps_ms: [0],
      subcriterion: "RESOLUTION",
      matched_level: "720～1079",
      coefficient: 0.8,
      evidence_source: "video_metadata" as "detector",
      recommendation: "使用 1080p 或更高分辨率拍摄",
    }];
    resultWithAlias.raw_total_score = 95;
    resultWithAlias.final_score = 95;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(JSON.stringify(resultWithAlias)),
    );

    const result = await provider(fetcher).analyze({ input, frames: [] });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      result.raw.dimensions.frame_and_video_quality.issues[0]?.evidence_source,
    ).toBe("detector");
  });

  it("accepts formula-only calculation traces without a repair call", async () => {
    const formulaResult = rawResult();
    for (const key of keys.slice(0, 4)) {
      formulaResult.dimensions[key].calculation_trace = "25 × 0.8 = 20";
    }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(JSON.stringify(formulaResult)),
    );

    const result = await provider(fetcher).analyze({ input, frames: [] });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.raw.dimensions.task_value_uniqueness.calculation_trace).toBe("平台需求快照 C_demand=1.0");
  });

  it("uses Qwen3.7 Flash only for review input and preserves initial observations", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response(JSON.stringify(rawResult()), 200, "req-plus"),
    );

    const result = await provider(fetcher).review({
      input,
      initialResult: rawResult(),
      frames: [{ timestampMs: 2_000, dataUrl: "data:image/jpeg;base64,Ag==" }],
      reviewReasons: ["low confidence"],
    });

    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<
      string,
      any
    >;
    expect(body.model).toBe("qwen3.7-flash");
    expect(body.messages[1].content[1].text).toContain("initial_result");
    expect(body.messages[1].content[1].text).toContain("low confidence");
    expect(body.messages[1].content[1].text).toContain("output_contract");
    expect(result.metadata.stage).toBe("review");
  });

  it("emits task-scoped diagnostics for success and HTTP retries", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response("throttled", 429, "req-rate"))
      .mockResolvedValueOnce(response(JSON.stringify(rawResult()), 200, "req-ok"));
    const { instance, diagnostics } = providerWithDiagnostics(fetcher);

    await instance.analyze({ input, frames: [] });

    expect(diagnostics).toMatchObject([
      {
        taskId: "LAB-1",
        modelStage: "initial",
        operation: "analysis",
        attempt: 1,
        outcome: "http_error",
        httpStatus: 429,
        requestId: "req-rate",
        retryable: true,
      },
      {
        taskId: "LAB-1",
        modelStage: "initial",
        operation: "analysis",
        attempt: 2,
        outcome: "success",
        httpStatus: 200,
        requestId: "req-ok",
      },
    ]);
  });

  it("records redacted network causes for every failed attempt", async () => {
    const networkError = new TypeError("fetch failed Bearer secret-test-key", {
      cause: Object.assign(new Error("connect /private/tmp/socket"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    });
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(networkError);
    const { instance, diagnostics } = providerWithDiagnostics(fetcher);

    await expect(instance.analyze({ input, frames: [] })).rejects.toThrow(
      "TypeError",
    );
    expect(diagnostics).toHaveLength(3);
    expect(diagnostics[2]).toMatchObject({
      taskId: "LAB-1",
      outcome: "network_error",
      errorName: "TypeError",
      errorCode: "UND_ERR_CONNECT_TIMEOUT",
      retryable: false,
    });
    expect(JSON.stringify(diagnostics)).not.toContain("secret-test-key");
    expect(JSON.stringify(diagnostics)).not.toContain("/private/tmp");
  });
});
