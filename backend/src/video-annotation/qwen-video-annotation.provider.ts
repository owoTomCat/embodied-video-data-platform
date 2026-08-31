import { ZodError } from "zod";

import type { TimestampedFrame } from "../video-quality/video-quality.types.js";
import type { LoadedVideoAnnotationPrompt } from "./prompt-loader.js";
import {
  canonicalizeVideoAnnotation,
  unresolvedRetryableIssues,
  type AnnotationGateIssue,
} from "./annotation-auto-gate.js";
import {
  VIDEO_ANNOTATION_POLICY_VERSION,
  VIDEO_ANNOTATION_SCHEMA_VERSION,
  normalizeVideoAnnotation,
  parseRawVideoAnnotation,
  type VideoAnnotationCandidate,
  type VideoAnnotationCandidateSuccess,
} from "./video-annotation.js";

type Fetcher = typeof fetch;
const MAX_ANNOTATION_FRAME_COUNT = 80;

type ModelUsage = {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
};

type ModelCallResult = {
  content: string;
  requestId: string | null;
  responseModel: string | null;
  usage?: ModelUsage;
};

export type AnnotationModelCallTelemetry = {
  logicalFullAttempt: number;
  callKind: "full" | "schema_repair" | "targeted_repair";
  callStatus: "succeeded" | "failed";
  httpStatus: number | null;
  providerRequestId: string | null;
  responseModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  errorCode: string | null;
  errorMessage: string | null;
};

export type AnnotationModelCallContext = {
  logicalFullAttempt: number;
  onModelCall?: (call: AnnotationModelCallTelemetry) => Promise<void>;
};

type ChatContentPart =
  | { type: "video"; video: string[] }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "text"; text: string };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

export type VideoAnnotationRequest = {
  videoId: string;
  durationMs: number;
  frames: TimestampedFrame[];
  enabledLabels: Array<{
    id: string;
    name: string;
    type: "scene" | "action" | "object";
  }>;
};

export interface VideoAnnotationProvider {
  annotate(
    request: VideoAnnotationRequest,
    signal?: AbortSignal,
  ): Promise<VideoAnnotationCandidate>;
}

export class VideoAnnotationProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly requestId: string | null,
    readonly kind: "transport" | "invalid_output" = "transport",
  ) {
    super(message);
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

function annotationFrames(frames: TimestampedFrame[]): TimestampedFrame[] {
  if (frames.length <= MAX_ANNOTATION_FRAME_COUNT) return frames;
  const selected = new Set<number>();
  for (let index = 0; index < MAX_ANNOTATION_FRAME_COUNT; index += 1) {
    selected.add(
      Math.round((index * (frames.length - 1)) / (MAX_ANNOTATION_FRAME_COUNT - 1)),
    );
  }
  return [...selected].map((index) => frames[index]!);
}

function safeError(value: unknown): string {
  return (value instanceof Error ? value.message : String(value))
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer <redacted>")
    .replace(/sk-(?:ws-)?[A-Za-z0-9._-]+/gu, "<redacted>")
    .replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=]+/gu, "<data-url-redacted>")
    .slice(0, 1_500);
}

function extractJson(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function responseRequestId(response: Response, document?: unknown): string | null {
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

function responseContent(document: unknown): string {
  if (!document || typeof document !== "object" || !("choices" in document)) {
    throw new Error("百炼候选标注响应缺少 choices");
  }
  const choices = document.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("百炼候选标注响应 choices 为空");
  }
  const message = choices[0];
  if (
    !message ||
    typeof message !== "object" ||
    !("message" in message) ||
    !message.message ||
    typeof message.message !== "object" ||
    !("content" in message.message)
  ) {
    throw new Error("百炼候选标注响应缺少 message.content");
  }
  const content = message.message.content;
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
  throw new Error("百炼候选标注响应 content 类型无效");
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function responseModel(document: unknown): string | null {
  return document &&
    typeof document === "object" &&
    "model" in document &&
    typeof document.model === "string"
    ? document.model
    : null;
}

function responseUsage(document: unknown): ModelUsage | undefined {
  if (
    !document ||
    typeof document !== "object" ||
    !("usage" in document) ||
    !document.usage ||
    typeof document.usage !== "object"
  ) {
    return undefined;
  }
  const usage = document.usage;
  return {
    promptTokens:
      "prompt_tokens" in usage
        ? nonNegativeInteger(usage.prompt_tokens)
        : null,
    completionTokens:
      "completion_tokens" in usage
        ? nonNegativeInteger(usage.completion_tokens)
        : null,
    totalTokens:
      "total_tokens" in usage
        ? nonNegativeInteger(usage.total_tokens)
        : null,
  };
}

function mergeUsage(
  first: ModelUsage | undefined,
  second: ModelUsage | undefined,
): ModelUsage | undefined {
  if (!first) return second;
  if (!second) return undefined;
  const sum = (left: number | null, right: number | null): number | null =>
    left === null || right === null ? null : left + right;
  return {
    promptTokens: sum(first.promptTokens, second.promptTokens),
    completionTokens: sum(first.completionTokens, second.completionTokens),
    totalTokens: sum(first.totalTokens, second.totalTokens),
  };
}

function schemaIssues(error: unknown): string[] {
  if (error instanceof ZodError) {
    return error.issues.map(
      (issue) => `${issue.path.join(".") || "result"}: ${issue.message}`,
    );
  }
  return [safeError(error)];
}

export class QwenVideoAnnotationProvider implements VideoAnnotationProvider {
  private readonly endpoint: string;
  private readonly fetcher: Fetcher;
  private readonly pendingPermits: Array<() => void> = [];
  private activeCalls = 0;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
      prompt: LoadedVideoAnnotationPrompt;
      maxConcurrency?: number;
      fetcher?: Fetcher;
      /** Kept for older tests; transport retries are owned by the queue worker. */
      sleep?: (milliseconds: number) => Promise<void>;
    },
  ) {
    this.endpoint = `${stripTrailingSlash(options.baseUrl)}/chat/completions`;
    this.fetcher = options.fetcher ?? fetch;
  }

  async annotate(
    request: VideoAnnotationRequest,
    signal?: AbortSignal,
  ): Promise<VideoAnnotationCandidate> {
    try {
      return await this.annotateStrict(request, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        status: "system_failed",
        schemaVersion: VIDEO_ANNOTATION_SCHEMA_VERSION,
        policyVersion: VIDEO_ANNOTATION_POLICY_VERSION,
        promptVersion: this.options.prompt.promptVersion,
        promptContentSha256: this.options.prompt.contentSha256,
        model: this.options.prompt.model,
        error: safeError(error),
      };
    }
  }

  /** 独立 Worker 使用：保留 Provider 错误类型，交由运行状态机决定重试或终止。 */
  async annotateStrict(
    request: VideoAnnotationRequest,
    signal?: AbortSignal,
    context: AnnotationModelCallContext = { logicalFullAttempt: 1 },
  ): Promise<VideoAnnotationCandidateSuccess> {
    let release: (() => void) | undefined;
    try {
      release = await this.acquirePermit(signal);
      return await this.annotateOrThrow(request, signal, context);
    } finally {
      release?.();
    }
  }

  private acquirePermit(signal?: AbortSignal): Promise<() => void> {
    const maxConcurrency = this.options.maxConcurrency ?? 1;
    if (this.activeCalls < maxConcurrency) {
      this.activeCalls += 1;
      return Promise.resolve(this.releasePermit());
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const grant = () => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        this.activeCalls += 1;
        resolve(this.releasePermit());
      };
      const abort = () => {
        if (settled) return;
        settled = true;
        const index = this.pendingPermits.indexOf(grant);
        if (index >= 0) this.pendingPermits.splice(index, 1);
        reject(signal?.reason ?? new Error("候选标注已取消"));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      this.pendingPermits.push(grant);
    });
  }

  private releasePermit(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCalls = Math.max(0, this.activeCalls - 1);
      this.pendingPermits.shift()?.();
    };
  }

  private async annotateOrThrow(
    request: VideoAnnotationRequest,
    signal?: AbortSignal,
    context: AnnotationModelCallContext = { logicalFullAttempt: 1 },
  ): Promise<VideoAnnotationCandidateSuccess> {
    if (request.frames.length < 4 || request.frames.length > 8_000) {
      throw new VideoAnnotationProviderError(
        `候选标注需要 4–8000 帧，实际 ${request.frames.length} 帧`,
        400,
        null,
      );
    }
    const selectedFrames = annotationFrames(request.frames);
    const selectedRequest = { ...request, frames: selectedFrames };
    const startedAt = Date.now();
    const messages = this.analysisMessages(selectedRequest);
    const first = await this.call(messages, "full", context, signal);
    let raw;
    let finalContent = first.content;
    let finalRequestId = first.requestId;
    let finalResponseModel = first.responseModel;
    let totalUsage = first.usage;
    try {
      raw = parseRawVideoAnnotation(extractJson(first.content));
    } catch (error) {
      const repairMessages: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: first.content },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `上一个输出不符合 ${this.options.prompt.outputSchema}。只返回修正后的合法 JSON。`,
                ...schemaIssues(error).slice(0, 20),
                `output_contract=${JSON.stringify(this.options.prompt.outputExample)}`,
              ].join("\n"),
            },
          ],
        },
      ];
      const repaired = await this.call(
        repairMessages,
        "schema_repair",
        context,
        signal,
      );
      finalContent = repaired.content;
      finalRequestId = repaired.requestId;
      finalResponseModel = repaired.responseModel;
      totalUsage = mergeUsage(first.usage, repaired.usage);
      try {
        raw = parseRawVideoAnnotation(extractJson(repaired.content));
      } catch (repairError) {
        throw new VideoAnnotationProviderError(
          `候选标注结构修复失败：${schemaIssues(repairError).join("; ").slice(0, 1_500)}`,
          null,
          finalRequestId,
          "invalid_output",
        );
      }
    }
    if (raw.video_id !== request.videoId) {
      throw new VideoAnnotationProviderError(
        "候选标注返回的 video_id 与请求不一致",
        null,
        finalRequestId,
        "invalid_output",
      );
    }
    let canonical = canonicalizeVideoAnnotation(raw);
    let normalized = normalizeVideoAnnotation({
      raw: canonical.raw,
      frames: selectedFrames,
      durationMs: request.durationMs,
      promptVersion: this.options.prompt.promptVersion,
      promptContentSha256: this.options.prompt.contentSha256,
      model: this.options.prompt.model,
      responseModel: finalResponseModel,
      requestId: finalRequestId,
      modelDurationMs: Date.now() - startedAt,
      ...(totalUsage ? { usage: totalUsage } : {}),
      repairs: canonical.repairs,
      enabledLabels: request.enabledLabels,
    });
    const retryableIssues = unresolvedRetryableIssues(normalized.gate);
    if (retryableIssues.length > 0) {
      const targetedMessages: ChatMessage[] = [
        ...messages,
        { role: "assistant", content: finalContent },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "上一个JSON已通过Schema，但存在以下结构化证据一致性错误。只修复列出的问题并返回完整合法JSON；不得改变无关任务语义。",
                ...retryableIssues.slice(0, 20).map(
                  (issue) =>
                    `${issue.code} | ${issue.fieldPath ?? "result"} | ${issue.message}`,
                ),
                `output_contract=${JSON.stringify(this.options.prompt.outputExample)}`,
              ].join("\n"),
            },
          ],
        },
      ];
      const repaired = await this.call(
        targetedMessages,
        "targeted_repair",
        context,
        signal,
      );
      finalRequestId = repaired.requestId;
      finalResponseModel = repaired.responseModel;
      totalUsage = mergeUsage(totalUsage, repaired.usage);
      let repairedRaw;
      try {
        repairedRaw = parseRawVideoAnnotation(extractJson(repaired.content));
      } catch (error) {
        throw new VideoAnnotationProviderError(
          `候选标注定向修复返回无效Schema：${schemaIssues(error).join("; ").slice(0, 1_500)}`,
          null,
          finalRequestId,
          "invalid_output",
        );
      }
      if (repairedRaw.video_id !== request.videoId) {
        throw new VideoAnnotationProviderError(
          "候选标注定向修复返回的 video_id 与请求不一致",
          null,
          finalRequestId,
          "invalid_output",
        );
      }
      canonical = canonicalizeVideoAnnotation(repairedRaw);
      const resolvedIssues: AnnotationGateIssue[] = retryableIssues.map((issue) => ({
        ...issue,
        resolution: "retried",
      }));
      normalized = normalizeVideoAnnotation({
        raw: canonical.raw,
        frames: selectedFrames,
        durationMs: request.durationMs,
        promptVersion: this.options.prompt.promptVersion,
        promptContentSha256: this.options.prompt.contentSha256,
        model: this.options.prompt.model,
        responseModel: finalResponseModel,
        requestId: finalRequestId,
        modelDurationMs: Date.now() - startedAt,
        ...(totalUsage ? { usage: totalUsage } : {}),
        repairs: [...resolvedIssues, ...canonical.repairs],
        enabledLabels: request.enabledLabels,
      });
      if (unresolvedRetryableIssues(normalized.gate).length > 0) {
        throw new VideoAnnotationProviderError(
          `候选标注定向修复后仍存在结构化证据错误：${unresolvedRetryableIssues(normalized.gate)
            .map((issue) => issue.code)
            .join(",")}`,
          null,
          finalRequestId,
          "invalid_output",
        );
      }
    }
    return normalized;
  }

  private analysisMessages(request: VideoAnnotationRequest): ChatMessage[] {
    const frameContent: ChatContentPart[] = request.frames.flatMap(
      (frame, frameIndex): ChatContentPart[] => [
        {
          type: "text",
          text: `FRAME ${frameIndex} | timestamp_ms=${frame.timestampMs}`,
        },
        { type: "image_url", image_url: { url: frame.dataUrl } },
      ],
    );
    return [
      { role: "system", content: this.options.prompt.systemPrompt },
      {
        role: "user",
        content: [
          ...frameContent,
          {
            type: "text",
            text: JSON.stringify({
              video_id: request.videoId,
              duration_ms: request.durationMs,
              frame_manifest: request.frames.map((frame, frameIndex) => ({
                frame_index: frameIndex,
                timestamp_ms: frame.timestampMs,
              })),
              frame_timestamps_ms: request.frames.map(
                (frame) => frame.timestampMs,
              ),
              annotation_context: {
                enabled_labels: request.enabledLabels,
              },
              requested_output_schema: this.options.prompt.outputSchema,
              output_contract: this.options.prompt.outputExample,
              output_requirements: [
                "只返回一个合法 JSON 对象。",
                "不得输出通过、拒绝、结算或任务符合度判断。",
                "不得引用 frame_timestamps_ms 之外的证据时间点。",
              ],
            }),
          },
        ],
      },
    ];
  }

  private async call(
    messages: ChatMessage[],
    callKind: AnnotationModelCallTelemetry["callKind"],
    context: AnnotationModelCallContext,
    signal?: AbortSignal,
  ): Promise<ModelCallResult> {
    if (signal?.aborted) throw signal.reason;
    const startedAt = Date.now();
    let telemetrySent = false;
    const report = async (
      input: Omit<AnnotationModelCallTelemetry, "logicalFullAttempt" | "callKind" | "latencyMs">,
    ) => {
      telemetrySent = true;
      await context.onModelCall?.({
        logicalFullAttempt: context.logicalFullAttempt,
        callKind,
        latencyMs: Date.now() - startedAt,
        ...input,
      });
    };
    try {
        const timeout = AbortSignal.timeout(this.options.timeoutMs);
        const requestSignal = signal
          ? AbortSignal.any([signal, timeout])
          : timeout;
        const response = await this.fetcher(this.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.options.prompt.model,
            messages,
            stream: false,
            enable_thinking: false,
            temperature: 0,
            max_tokens: 8_000,
            response_format: { type: "json_object" },
          }),
          signal: requestSignal,
        });
        if (!response.ok) {
          const requestId = responseRequestId(response);
          await report({
            callStatus: "failed",
            httpStatus: response.status,
            providerRequestId: requestId,
            responseModel: null,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            errorCode: `MODEL_HTTP_${response.status}`,
            errorMessage: `百炼候选标注请求失败（HTTP ${response.status}）`,
          });
          const error = new VideoAnnotationProviderError(
            `百炼候选标注请求失败（HTTP ${response.status}）`,
            response.status,
            requestId,
          );
          throw error;
        }
        let document: unknown;
        try {
          document = (await response.json()) as unknown;
        } catch (error) {
          const message = `百炼候选标注响应不是合法JSON：${safeError(error)}`;
          await report({
            callStatus: "failed",
            httpStatus: response.status,
            providerRequestId: responseRequestId(response),
            responseModel: null,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            errorCode: "MODEL_RESPONSE_INVALID",
            errorMessage: message,
          });
          throw new VideoAnnotationProviderError(
            message,
            null,
            responseRequestId(response),
            "invalid_output",
          );
        }
        const usage = responseUsage(document);
        const requestId = responseRequestId(response, document);
        const model = responseModel(document);
        let content: string;
        try {
          content = responseContent(document);
        } catch (error) {
          const message = `百炼候选标注响应无效：${safeError(error)}`;
          await report({
            callStatus: "failed",
            httpStatus: response.status,
            providerRequestId: requestId,
            responseModel: model,
            inputTokens: usage?.promptTokens ?? null,
            outputTokens: usage?.completionTokens ?? null,
            totalTokens: usage?.totalTokens ?? null,
            errorCode: "MODEL_RESPONSE_INVALID",
            errorMessage: message,
          });
          throw new VideoAnnotationProviderError(
            message,
            null,
            requestId,
            "invalid_output",
          );
        }
        await report({
          callStatus: "succeeded",
          httpStatus: response.status,
          providerRequestId: requestId,
          responseModel: model,
          inputTokens: usage?.promptTokens ?? null,
          outputTokens: usage?.completionTokens ?? null,
          totalTokens: usage?.totalTokens ?? null,
          errorCode: null,
          errorMessage: null,
        });
        return {
          content,
          requestId,
          responseModel: model,
          ...(usage ? { usage } : {}),
        };
    } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof VideoAnnotationProviderError) throw error;
        const status =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError")
            ? 408
            : null;
        const message =
          status === 408
            ? `百炼候选标注请求超时：${safeError(error)}`
            : `百炼候选标注网络请求失败：${safeError(error)}`;
        if (!telemetrySent) {
          await report({
            callStatus: "failed",
            httpStatus: status,
            providerRequestId: null,
            responseModel: null,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            errorCode: status === 408 ? "MODEL_HTTP_408" : "MODEL_NETWORK",
            errorMessage: message,
          });
        }
        if (
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError")
        ) {
          throw new VideoAnnotationProviderError(
            `百炼候选标注请求超时：${safeError(error)}`,
            408,
            null,
          );
        }
        throw new VideoAnnotationProviderError(message, null, null);
    }
  }
}
