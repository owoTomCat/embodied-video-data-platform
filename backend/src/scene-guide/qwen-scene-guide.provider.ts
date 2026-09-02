import { ZodError } from "zod";

import type { LoadedSceneGuidePrompt } from "./scene-guide.prompt.js";
import {
  envelopeEnvRecognitionSchema,
  envelopeTaskCardsSchema,
  type EnvRecognitionRaw,
  type TaskCardsRaw,
} from "./scene-guide.schema.js";

type Fetcher = typeof fetch;

type ChatContentPart =
  | { type: "image_url"; image_url: { url: string } }
  | { type: "text"; text: string };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

export class SceneGuideProviderError extends Error {
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

function schemaIssues(error: unknown): string[] {
  if (error instanceof ZodError) {
    return error.issues.map(
      (issue) => `${issue.path.join(".") || "result"}: ${issue.message}`,
    );
  }
  return [safeError(error)];
}

function responseContent(document: unknown): string {
  if (!document || typeof document !== "object" || !("choices" in document)) {
    throw new Error("场景指导响应缺少 choices");
  }
  const choices = document.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("场景指导响应 choices 为空");
  }
  const choice = choices[0];
  if (
    !choice ||
    typeof choice !== "object" ||
    !("message" in choice) ||
    !choice.message ||
    typeof choice.message !== "object" ||
    !("content" in choice.message)
  ) {
    throw new Error("场景指导响应缺少 message.content");
  }
  const content: unknown = choice.message.content;
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
  throw new Error("场景指导响应 content 类型无效");
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

function responseModel(document: unknown): string | null {
  return document &&
    typeof document === "object" &&
    "model" in document &&
    typeof document.model === "string"
    ? document.model
    : null;
}

type ModelCallResult = {
  content: string;
  requestId: string | null;
  responseModel: string | null;
  latencyMs: number;
};

/** 场景指导 AI：Qwen-VL 环境物体识别 + LLM 任务卡生成。复用百炼 OpenAI 兼容 chat/completions。 */
export class QwenSceneGuideProvider {
  private readonly endpoint: string;
  private readonly fetcher: Fetcher;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      timeoutMs: number;
      prompt: LoadedSceneGuidePrompt;
      fetcher?: Fetcher;
    },
  ) {
    this.endpoint = `${stripTrailingSlash(options.baseUrl)}/chat/completions`;
    this.fetcher = options.fetcher ?? fetch;
  }

  /** 视觉识别环境物体：传照片 dataUrl（image_url）给 Qwen-VL */
  async recognizeEnvObjects(
    photoDataUrls: string[],
    signal?: AbortSignal,
  ): Promise<EnvRecognitionRaw & { model: string }> {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: this.options.prompt.envRecognitionSystemPrompt,
      },
      {
        role: "user",
        content: [
          ...photoDataUrls.map((url): ChatContentPart => ({
            type: "image_url",
            image_url: { url },
          })),
          {
            type: "text",
            text: JSON.stringify({
              requested_output_schema: this.options.prompt.envRecognitionOutputExample,
              output_requirements: [
                "只返回一个合法 JSON 对象，不要输出 Markdown 或解释文字。",
                "严格按示例结构输出，不得改名或遗漏字段。",
                "没有的数组返回 []，不要臆造照片中不存在的物体。",
              ],
            }),
          },
        ],
      },
    ];
    const call = await this.call(messages, this.options.prompt.envRecognitionModel, signal);
    const raw = extractJson(call.content);
    try {
      const parsed = envelopeEnvRecognitionSchema.parse(raw);
      return { ...parsed, model: call.responseModel ?? this.options.prompt.envRecognitionModel };
    } catch (error) {
      throw new SceneGuideProviderError(
        `场景指导环境识别输出不符合 Schema：${schemaIssues(error).join("; ").slice(0, 1_500)}`,
        null,
        call.requestId,
        "invalid_output",
      );
    }
  }

  /** LLM 一次生成 3-5 张结构化任务卡（按场景内可操作物体细分，任务可连续或独立） */
  async generateTaskCards(
    input: {
      sceneName: string;
      taskDescription: string;
      requirements: string[];
      envObjects: Array<{ name: string; category?: string }>;
      sceneSummary?: string;
    },
    signal?: AbortSignal,
  ): Promise<TaskCardsRaw & { model: string }> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.options.prompt.taskCardSystemPrompt },
      {
        role: "user",
        content: JSON.stringify({
          scene_name: input.sceneName,
          task_description: input.taskDescription,
          requirements: input.requirements,
          env_objects: input.envObjects,
          scene_summary: input.sceneSummary ?? "",
          requested_output_schema: this.options.prompt.taskCardOutputExample,
          output_requirements: [
            "只返回一个合法 JSON 对象，不要输出 Markdown 或解释文字。",
            "严格按示例结构输出，不得改名或遗漏字段。",
            "tasks 数组返回 3~5 张任务卡，必须基于 env_objects 中的可操作物体。",
            "每张任务卡只聚焦一个可独立完成的操作；相关操作可拆成连续子任务，无关操作拆成独立任务。",
            "每张卡的 title 用一句短语概括（如「把罐头放到锅里」）；target_objects 从 env_objects 挑选。",
            "不得臆造 env_objects 中不存在的物体。",
          ],
        }),
      },
    ];
    const call = await this.call(messages, this.options.prompt.taskCardModel, signal);
    const raw = extractJson(call.content);
    try {
      const parsed = envelopeTaskCardsSchema.parse(raw);
      return { ...parsed, model: call.responseModel ?? this.options.prompt.taskCardModel };
    } catch (error) {
      throw new SceneGuideProviderError(
        `场景指导任务卡输出不符合 Schema：${schemaIssues(error).join("; ").slice(0, 1_500)}`,
        null,
        call.requestId,
        "invalid_output",
      );
    }
  }

  private async call(
    messages: ChatMessage[],
    model: string,
    signal?: AbortSignal,
  ): Promise<ModelCallResult> {
    if (signal?.aborted) throw signal.reason;
    const startedAt = Date.now();
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
          model,
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
        const error = new SceneGuideProviderError(
          `场景指导模型请求失败（HTTP ${response.status}）`,
          response.status,
          responseRequestId(response),
        );
        throw error;
      }
      let document: unknown;
      try {
        document = (await response.json()) as unknown;
      } catch (error) {
        throw new SceneGuideProviderError(
          `场景指导响应不是合法JSON：${safeError(error)}`,
          null,
          responseRequestId(response),
          "invalid_output",
        );
      }
      const requestId = responseRequestId(response, document);
      const detectedModel = responseModel(document);
      let content: string;
      try {
        content = responseContent(document);
      } catch (error) {
        throw new SceneGuideProviderError(
          `场景指导响应无效：${safeError(error)}`,
          null,
          requestId,
          "invalid_output",
        );
      }
      return { content, requestId, responseModel: detectedModel, latencyMs: Date.now() - startedAt };
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error instanceof SceneGuideProviderError) throw error;
      const status =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
          ? 408
          : null;
      const message =
        status === 408
          ? `场景指导模型请求超时：${safeError(error)}`
          : `场景指导模型网络请求失败：${safeError(error)}`;
      throw new SceneGuideProviderError(message, status, null);
    }
  }
}
