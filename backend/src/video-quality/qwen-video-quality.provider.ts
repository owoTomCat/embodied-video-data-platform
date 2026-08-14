import type { LoadedVideoQualityPrompt } from "./prompt-loader.js";
import {
  parseRawVideoQcResult,
  VideoQcSchemaError,
} from "./video-qc-schema.js";
import type {
  BailianCallDiagnostic,
  ModelRunMetadata,
  RawVideoQcResultV1,
  TimestampedFrame,
  VideoQcInputV1,
  VideoQualityModelConfig,
} from "./video-quality.types.js";

type Fetcher = typeof fetch;

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "video"; video: string[] }
        | { type: "text"; text: string }
      >;
};

export type ModelRunResult = {
  raw: RawVideoQcResultV1;
  metadata: ModelRunMetadata;
};

export type AnalyzeVideoQualityRequest = {
  input: VideoQcInputV1;
  frames: TimestampedFrame[];
};

export type ReviewVideoQualityRequest = AnalyzeVideoQualityRequest & {
  initialResult: RawVideoQcResultV1;
  reviewReasons: string[];
};

export class BailianRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly requestId: string | null,
  ) {
    super(message);
  }
}

type ProviderOptions = {
  config: VideoQualityModelConfig;
  prompt: LoadedVideoQualityPrompt;
  fetcher?: Fetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  diagnosticSink?: (diagnostic: BailianCallDiagnostic) => void;
};

type CallInput = {
  taskId: string;
  model: string;
  modelStage: "initial" | "review";
  operation: "analysis" | "review" | "repair";
  messages: ChatMessage[];
  signal?: AbortSignal;
};

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function redactedErrorText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
    .replace(/sk-(?:ws-)?[A-Za-z0-9._-]+/gu, "<redacted>")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gu, "<data-url-redacted>")
    .replace(/\/(?:private\/)?tmp\/[A-Za-z0-9_./ -]+/gu, "<temp>")
    .slice(0, 500);
}

function errorDetails(error: unknown): {
  errorName: string;
  errorCode?: string;
  errorMessage: string;
} {
  const candidate = error instanceof Error ? error : new Error(String(error));
  const cause = candidate.cause;
  const causeRecord =
    cause && typeof cause === "object"
      ? (cause as Record<string, unknown>)
      : undefined;
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : typeof causeRecord?.message === "string"
        ? causeRecord.message
        : undefined;
  const errorCode =
    typeof causeRecord?.code === "string"
      ? causeRecord.code
      : typeof (candidate as Error & { code?: unknown }).code === "string"
        ? (candidate as Error & { code: string }).code
        : undefined;
  return {
    errorName: redactedErrorText(candidate.name || "Error"),
    ...(errorCode ? { errorCode: redactedErrorText(errorCode) } : {}),
    errorMessage: redactedErrorText(
      causeMessage ? `${candidate.message}: ${causeMessage}` : candidate.message,
    ),
  };
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function requestId(response: Response, document: unknown): string | null {
  const header = response.headers.get("x-request-id");
  if (header) return header;
  if (
    document &&
    typeof document === "object" &&
    "request_id" in document &&
    typeof document.request_id === "string"
  ) {
    return document.request_id;
  }
  return null;
}

function messageContent(document: unknown): string {
  if (!document || typeof document !== "object" || !("choices" in document)) {
    throw new BailianRequestError("百炼响应缺少 choices", null, null);
  }
  const choices = document.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new BailianRequestError("百炼响应 choices 为空", null, null);
  }
  const first = choices[0];
  if (!first || typeof first !== "object" || !("message" in first)) {
    throw new BailianRequestError("百炼响应缺少 message", null, null);
  }
  const message = first.message;
  if (!message || typeof message !== "object" || !("content" in message)) {
    throw new BailianRequestError("百炼响应缺少 message.content", null, null);
  }
  const content: unknown = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part: unknown) =>
        part &&
        typeof part === "object" &&
        "text" in part &&
        typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("");
  }
  throw new BailianRequestError("百炼响应 content 类型无效", null, null);
}

const qualityIssueContract = {
  reason_code: "HAND_SCALE_TOO_LARGE",
  description: "操作区域在该区间内持续占画面约 60%，命中偏大档位",
  start_ms: 0,
  end_ms: 10_000,
  severity: "minor",
  confidence: 0.9,
  evidence_timestamps_ms: [5_000],
  subcriterion: "SCALE",
  rule_id: "HAND.SCALE.C085",
  observed_value: "操作区域约占画面 60%",
  matched_level: "55%～70%",
  coefficient: 0.85,
  evidence_source: "model",
  recommendation: "适当拉远镜头，使操作区域占画面 8%～55%",
};

function outputInstructions(prompt: LoadedVideoQualityPrompt): {
  requested_output_schema: string;
  output_contract: Record<string, unknown>;
  issue_contract: Record<string, unknown>;
  output_requirements: string[];
} {
  return {
    requested_output_schema: prompt.outputSchema,
    output_contract: prompt.outputExample,
    issue_contract: qualityIssueContract,
    output_requirements: [
      "只返回一个合法 JSON 对象，不要返回 Markdown 或解释文字。",
      "严格使用 output_contract 中的字段名和嵌套层级，不得改名或遗漏字段。",
      "没有内容的数组返回 []；不得为了填充示例而输出空白占位对象。",
      "数值和枚举必须符合系统提示词；不要输出 pass/fail 或结算字段。",
      "task_summary、summary、description、recommendations、review_reasons 等所有自然语言字段必须使用简体中文；calculation_trace 可以只写公式；字段名、枚举和 reason_code 保持原值。",
      "前四个维度必须按 output_contract 给出的 segment 字段返回完整区间因子；禁止只返回总系数和总分。",
      "前四个维度只要得分低于 25，就必须在该维度 issues 中提供对应失分原因，并包含固定 subcriterion 代码、观察事实、证据时间点、命中档位、系数和可执行建议；禁止只给低分不给原因。",
      "evidence_source 只能使用 model、detector、demand_snapshot、human_review；ffprobe、分辨率、帧率及媒体元数据证据统一写 detector。",
      "顶层 deductions 不得重复质量扣分；只有不改变分数的其他观察可以放入其中，且必须使用 dimension=other、rule_id=OTHER.OBSERVATION、deducted_points=0。没有其他观察时返回 []。",
      "task_value_uniqueness.score 必须为 0；第五维只输出来自需求快照的 coefficient。",
    ],
  };
}

const simplifiedChinesePattern = /[\u3400-\u9fff]/u;

function chineseLanguageIssues(raw: RawVideoQcResultV1): string[] {
  const issues: string[] = [];
  const check = (path: string, value: string): void => {
    if (value.trim() && !simplifiedChinesePattern.test(value)) {
      issues.push(`${path}: 自然语言内容必须使用简体中文`);
    }
  };

  check("detected_task.task_summary", raw.detected_task.task_summary);
  check("summary", raw.summary);
  raw.recommendations.forEach((value, index) =>
    check(`recommendations.${index}`, value),
  );
  raw.review_reasons.forEach((value, index) =>
    check(`review_reasons.${index}`, value),
  );
  for (const [dimension, value] of Object.entries(raw.dimensions)) {
    value.issues.forEach((issue, index) =>
      check(`dimensions.${dimension}.issues.${index}.description`, issue.description),
    );
    value.segments.forEach((segment, index) => {
      for (const [key, field] of Object.entries(segment)) {
        if (
          typeof field === "string" &&
          ["description", "summary"].includes(key)
        ) {
          check(`dimensions.${dimension}.segments.${index}.${key}`, field);
        }
      }
    });
  }
  raw.billing_observations.candidate_invalid_segments.forEach((segment, index) =>
    check(`billing_observations.candidate_invalid_segments.${index}.description`, segment.description),
  );
  raw.billing_observations.candidate_valid_waiting_segments.forEach(
    (segment, index) =>
      check(
        `billing_observations.candidate_valid_waiting_segments.${index}.description`,
        segment.description,
      ),
  );
  raw.deductions.forEach((deduction, index) =>
    check(`deductions.${index}.description`, deduction.description),
  );
  return issues;
}

function canonicalEvidenceSource(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  if (["model", "detector", "demand_snapshot", "human_review"].includes(normalized)) {
    return normalized;
  }
  if (/ffprobe|metadata|media_info|technical|detector|probe|system|tool|元数据|检测器|技术检测/iu.test(normalized)) {
    return "detector";
  }
  if (/demand|inventory|snapshot|platform|需求|库存|快照/iu.test(normalized)) {
    return "demand_snapshot";
  }
  if (/human|manual|reviewer|人工|复核/iu.test(normalized)) {
    return "human_review";
  }
  if (/model|visual|qwen|\bai\b|frame|video|模型|视觉/iu.test(normalized)) {
    return "model";
  }
  return value;
}

function normalizeModelAliases(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const document = value as Record<string, unknown>;
  const normalizeIssues = (candidate: unknown): void => {
    if (!Array.isArray(candidate)) return;
    for (const item of candidate) {
      if (!item || typeof item !== "object") continue;
      const issue = item as Record<string, unknown>;
      if (issue.evidence_source !== undefined) {
        issue.evidence_source = canonicalEvidenceSource(issue.evidence_source);
      }
    }
  };
  if (document.dimensions && typeof document.dimensions === "object") {
    for (const dimension of Object.values(document.dimensions as Record<string, unknown>)) {
      if (dimension && typeof dimension === "object") {
        normalizeIssues((dimension as Record<string, unknown>).issues);
      }
    }
  }
  normalizeIssues(document.deductions);
  return value;
}

function parseChineseRawVideoQcResult(value: unknown): RawVideoQcResultV1 {
  const raw = parseRawVideoQcResult(normalizeModelAliases(value));
  for (const dimension of Object.values(raw.dimensions)) {
    for (const issue of dimension.issues) {
      // description 已经是必填的事实说明；observed_value 是展示用的规范化别名，
      // 不应因为模型漏写同义字段而丢弃一整次有效评分。
      if (!issue.observed_value?.trim() && issue.description.trim()) {
        issue.observed_value = issue.description.trim();
      }
    }
  }
  const allowedSubcriteria: Record<string, readonly string[]> = {
    first_person_and_composition: ["POV", "ANGLE", "ORIENTATION", "ARM_ENTRY"],
    hand_forearm_object_integrity: ["COMPLETENESS", "EDGE", "SCALE", "OCCLUSION", "OBJECT_VISIBILITY"],
    frame_and_video_quality: ["RESOLUTION", "FPS", "SHARPNESS", "EXPOSURE", "STABILITY", "CONTINUITY"],
    task_authenticity_completeness: ["LEVEL", "AUTHENTICITY", "PROGRESS", "COMPLETION"],
  };
  const qualityKeys = Object.keys(raw.dimensions).slice(0, 4);
  const explanationIssues = qualityKeys.flatMap((key) => {
    const dimension = raw.dimensions[key as keyof typeof raw.dimensions];
    if (dimension.score >= 24.95) return [];
    if (dimension.issues.length === 0) {
      return [`dimensions.${key}: 得分 ${dimension.score}/25，但没有扣分原因；必须补充观察事实、证据时间点、命中档位和建议`];
    }
    const issues: string[] = [];
    dimension.issues.forEach((item, index) => {
      const path = `dimensions.${key}.issues.${index}`;
      if (item.evidence_timestamps_ms.length === 0) issues.push(`${path}: 缺少证据时间点`);
      if (!item.subcriterion || !allowedSubcriteria[key]?.includes(item.subcriterion)) issues.push(`${path}.subcriterion: 必须使用该维度规定的固定代码`);
      if (!item.observed_value?.trim()) issues.push(`${path}.observed_value: 缺少可观察事实`);
      if (!item.matched_level?.trim()) issues.push(`${path}.matched_level: 缺少命中档位`);
      if (typeof item.coefficient !== "number") issues.push(`${path}.coefficient: 缺少档位系数`);
      if (!item.recommendation?.trim()) issues.push(`${path}.recommendation: 缺少可执行建议`);
      if (!item.evidence_source) issues.push(`${path}.evidence_source: 缺少证据来源`);
    });
    if (issues.length > 0) {
      return issues;
    }
    return [];
  });
  const contractIssues = [
    ...raw.deductions.flatMap((issue, index) =>
      issue.dimension === "other" &&
      issue.rule_id === "OTHER.OBSERVATION" &&
      Number(issue.deducted_points ?? 0) === 0
        ? []
        : [`deductions.${index}: 顶层只能保存不计分的 OTHER.OBSERVATION，质量失分必须写在所属维度 issues 中`],
    ),
    ...(!nearlyZero(raw.dimensions.task_value_uniqueness.score)
      ? ["dimensions.task_value_uniqueness.score: 第五维是乘数，兼容分数字段必须为 0"]
      : []),
    ...(/25\s*[×x*]|\/\s*25/iu.test(raw.dimensions.task_value_uniqueness.calculation_trace)
      ? ["dimensions.task_value_uniqueness.calculation_trace: 第五维不得使用 25 分公式"]
      : []),
  ];
  const issues = [...chineseLanguageIssues(raw), ...explanationIssues, ...contractIssues];
  if (issues.length > 0) {
    throw new VideoQcSchemaError("模型结果不符合可审计输出约束", issues);
  }
  return raw;
}

function nearlyZero(value: number): boolean {
  return Math.abs(value) <= 0.001;
}

export class QwenVideoQualityProvider {
  private readonly config: VideoQualityModelConfig;
  private readonly prompt: LoadedVideoQualityPrompt;
  private readonly fetcher: Fetcher;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly endpoint: string;
  private readonly diagnosticSink: (diagnostic: BailianCallDiagnostic) => void;

  constructor(options: ProviderOptions) {
    this.config = options.config;
    this.prompt = options.prompt;
    this.fetcher = options.fetcher ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.endpoint = `${stripTrailingSlash(this.config.baseUrl)}/chat/completions`;
    this.diagnosticSink = options.diagnosticSink ?? (() => undefined);
  }

  async analyze(
    request: AnalyzeVideoQualityRequest,
    signal?: AbortSignal,
  ): Promise<ModelRunResult> {
    const messages = this.messagesForAnalysis(request);
    return this.run({
      model: this.config.initialModel,
      stage: "initial",
      messages,
      frameCount: request.frames.length,
      taskId: request.input.video_id,
      signal,
    });
  }

  async review(
    request: ReviewVideoQualityRequest,
    signal?: AbortSignal,
  ): Promise<ModelRunResult> {
    const messages = this.messagesForReview(request);
    return this.run({
      model: this.config.reviewModel,
      stage: "review",
      messages,
      frameCount: request.frames.length,
      taskId: request.input.video_id,
      signal,
    });
  }

  private messagesForAnalysis(
    request: AnalyzeVideoQualityRequest,
  ): ChatMessage[] {
    return [
      { role: "system", content: this.prompt.systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "video",
            video: request.frames.map((frame) => frame.dataUrl),
          },
          {
            type: "text",
            text: JSON.stringify({
              ...request.input,
              frame_timestamps_ms: request.frames.map(
                (frame) => frame.timestampMs,
              ),
              ...outputInstructions(this.prompt),
            }),
          },
        ],
      },
    ];
  }

  private messagesForReview(request: ReviewVideoQualityRequest): ChatMessage[] {
    return [
      { role: "system", content: this.prompt.systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "video",
            video: request.frames.map((frame) => frame.dataUrl),
          },
          {
            type: "text",
            text: JSON.stringify({
              review_request: {
                input: request.input,
                initial_result: request.initialResult,
                review_reasons: request.reviewReasons,
                controversy_frame_timestamps_ms: request.frames.map(
                  (frame) => frame.timestampMs,
                ),
              },
              ...outputInstructions(this.prompt),
            }),
          },
        ],
      },
    ];
  }

  private async run(input: {
    model: string;
    stage: "initial" | "review";
    messages: ChatMessage[];
    frameCount: number;
    taskId: string;
    signal?: AbortSignal;
  }): Promise<ModelRunResult> {
    const startedAt = Date.now();
    const first = await this.call({
      taskId: input.taskId,
      model: input.model,
      modelStage: input.stage,
      operation: input.stage === "initial" ? "analysis" : "review",
      messages: input.messages,
      signal: input.signal,
    });
    let raw: RawVideoQcResultV1;
    let finalRequestId = first.requestId;
    try {
      raw = parseChineseRawVideoQcResult(extractJson(first.content));
    } catch (error) {
      const validationIssues =
        error instanceof VideoQcSchemaError
          ? error.validationIssues
          : [error instanceof Error ? error.message : "JSON 解析失败"];
      const repairMessages: ChatMessage[] = [
        ...input.messages,
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "上一个输出不符合 video_qc_result_v2。请只返回修正后的合法 JSON。",
                "必须严格保留下面 output_contract 的所有字段名和嵌套层级；没有内容的数组返回 []。",
                "所有自然语言字段必须改写为简体中文；calculation_trace 可以只写公式；字段名、枚举和 reason_code 保持原值。",
                "evidence_source 只能使用 model、detector、demand_snapshot、human_review；ffprobe、分辨率、帧率及媒体元数据证据统一写 detector。",
                ...validationIssues.slice(0, 20),
                `output_contract=${JSON.stringify(this.prompt.outputExample)}`,
                `issue_contract=${JSON.stringify(qualityIssueContract)}`,
              ].join("\n"),
            },
          ],
        },
      ];
      const repaired = await this.call({
        taskId: input.taskId,
        model: input.model,
        modelStage: input.stage,
        operation: "repair",
        messages: repairMessages,
        signal: input.signal,
      });
      finalRequestId = repaired.requestId;
      try {
        raw = parseChineseRawVideoQcResult(extractJson(repaired.content));
      } catch (repairError) {
        const issues =
          repairError instanceof VideoQcSchemaError
            ? repairError.validationIssues.join("; ")
            : repairError instanceof Error
              ? repairError.message
              : "unknown";
        throw new BailianRequestError(
          `模型结构化结果修复失败：${issues.slice(0, 1_000)}`,
          null,
          finalRequestId,
        );
      }
    }

    return {
      raw,
      metadata: {
        stage: input.stage,
        model: input.model,
        requestId: finalRequestId,
        durationMs: Date.now() - startedAt,
        frameCount: input.frameCount,
      },
    };
  }

  private emitDiagnostic(diagnostic: BailianCallDiagnostic): void {
    try {
      this.diagnosticSink(diagnostic);
    } catch {
      // Diagnostic persistence must never change a model-call outcome.
    }
  }

  private async call(
    input: CallInput,
  ): Promise<{ content: string; requestId: string | null }> {
    const delays = [0, 500, 1_500];
    let lastError: unknown;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (input.signal?.aborted) throw input.signal.reason;
      const delay = delays[attempt] ?? 0;
      if (delay > 0) await this.sleep(delay);
      const attemptStartedAt = new Date();
      try {
        const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
        const signal = input.signal
          ? AbortSignal.any([input.signal, timeoutSignal])
          : timeoutSignal;
        const response = await this.fetcher(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            messages: input.messages,
            stream: false,
            enable_thinking: false,
            temperature: 0,
            response_format: { type: "json_object" },
          }),
          signal,
        });
        if (!response.ok) {
          const id = response.headers.get("x-request-id");
          const retryable = response.status === 429 || response.status >= 500;
          this.emitDiagnostic({
            taskId: input.taskId,
            modelStage: input.modelStage,
            operation: input.operation,
            model: input.model,
            attempt: attempt + 1,
            startedAt: attemptStartedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - attemptStartedAt.getTime(),
            outcome: "http_error",
            httpStatus: response.status,
            requestId: id,
            retryable: retryable && attempt < delays.length - 1,
            errorName: "BailianRequestError",
            errorCode: `HTTP_${response.status}`,
            errorMessage: `百炼请求失败（HTTP ${response.status}）`,
          });
          const error = new BailianRequestError(
            `百炼请求失败（HTTP ${response.status}）`,
            response.status,
            id,
          );
          if (retryable && attempt < delays.length - 1) {
            lastError = error;
            continue;
          }
          throw error;
        }
        let document: unknown;
        let content: string;
        try {
          document = (await response.json()) as unknown;
          content = messageContent(document);
        } catch (error) {
          const details = errorDetails(error);
          this.emitDiagnostic({
            taskId: input.taskId,
            modelStage: input.modelStage,
            operation: input.operation,
            model: input.model,
            attempt: attempt + 1,
            startedAt: attemptStartedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - attemptStartedAt.getTime(),
            outcome: "invalid_response",
            httpStatus: response.status,
            requestId: requestId(response, document),
            retryable: false,
            ...details,
          });
          throw new BailianRequestError(
            `百炼响应无法解析：${details.errorName}`,
            response.status,
            requestId(response, document),
          );
        }
        const finalRequestId = requestId(response, document);
        this.emitDiagnostic({
          taskId: input.taskId,
          modelStage: input.modelStage,
          operation: input.operation,
          model: input.model,
          attempt: attempt + 1,
          startedAt: attemptStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartedAt.getTime(),
          outcome: "success",
          httpStatus: response.status,
          requestId: finalRequestId,
          retryable: false,
        });
        return {
          content,
          requestId: finalRequestId,
        };
      } catch (error) {
        if (input.signal?.aborted) throw input.signal.reason;
        if (error instanceof BailianRequestError) throw error;
        lastError = error;
        const details = errorDetails(error);
        this.emitDiagnostic({
          taskId: input.taskId,
          modelStage: input.modelStage,
          operation: input.operation,
          model: input.model,
          attempt: attempt + 1,
          startedAt: attemptStartedAt.toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - attemptStartedAt.getTime(),
          outcome: "network_error",
          httpStatus: null,
          requestId: null,
          retryable: attempt < delays.length - 1,
          ...details,
        });
        if (attempt >= delays.length - 1) break;
      }
    }
    const finalDetails = errorDetails(lastError);
    throw new BailianRequestError(
      `百炼网络请求失败：${finalDetails.errorName}${
        finalDetails.errorCode ? `（${finalDetails.errorCode}）` : ""
      } · ${finalDetails.errorMessage}`,
      null,
      null,
    );
  }
}
