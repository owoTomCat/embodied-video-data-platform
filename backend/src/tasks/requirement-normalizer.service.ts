import { Injectable } from "@nestjs/common";

import type {
  NormalizedRequirementItem,
  NormalizedTaskRequirements,
} from "../database/entities/collection-task.entity.js";
import {
  qwenApiKey,
  qwenBaseUrl,
  taskRequirementNormalizerModel,
  taskRequirementNormalizerTimeoutMs,
} from "./tasks.config.js";
import {
  TextModelProvider,
  TextModelRequestError,
} from "./text-model.provider.js";
import { TaskFailure } from "./tasks.failure.js";

const NORMALIZER_SYSTEM_PROMPT = [
  "你是具身视频数据采集任务的「要求规范化助手」。",
  "把管理员用自然语言填写的任务要求，转换为结构化 JSON，供 AI 质检逐条判定视频符合度。",
  "输出必须是 JSON 对象，字段如下：",
  '1. "scene_description"：对任务场景边界的一段标准中文描述（80~300 字），说明该场景应出现什么、不应出现什么，供质检模型理解场景边界。',
  '2. "requirements"：要求条目数组，每条包含：',
  '   - "type"："hard" 表示硬性要求（不满足应否决或必须人工复核），"soft" 表示一般要求（不满足仅影响评分）；',
  '   - "content"：单条要求的清晰、可判定表述（中文，30~120 字），必须能通过观看视频判定是否符合；',
  '   - "rationale"（可省略）：该要求的判定依据或说明。',
  "   规则：必须把「禁止类」要求显式转为「不允许出现……」，把「必须类」要求转为「必须出现/完成……」；不要合并含义不同的要求；不要编造管理员未提出的要求；总条数控制在 3~20 条。",
  "   重要：关于画面清晰度与画质、操作者手部出镜、操作对象被遮挡或部分遮挡这类要求，应判为「soft」（一般要求，仅影响评分），不要判为「hard」（硬性要求）。只有真正决定数据是否可用的要求（如任务真实性、必须的隐私禁止、必须的视角）才判为「hard」。",
  '3. "quality_notes"：其他影响评分或复核的补充说明数组（可省略或为空）。',
  "输出前自查：每条要求都可判定、无歧义、无重复；场景描述与要求一致。只输出 JSON，不要输出 Markdown 或解释文字。",
].join("\n");

const MAX_REQUIREMENTS = 100;
const MAX_QUALITY_NOTES = 20;
const MAX_CONTENT_LENGTH = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/**
 * 把模型输出规整为受控结构；对缺失/类型错误字段做容错，而不是直接失败。
 * 导出供单元测试直接验证。
 */
export function shapeNormalizedOutput(
  raw: unknown,
): NormalizedTaskRequirements {
  const root = isRecord(raw) ? raw : {};
  const requirements: NormalizedRequirementItem[] = [];
  if (Array.isArray(root.requirements)) {
    for (const item of root.requirements) {
      if (!isRecord(item)) continue;
      const content = cleanString(item.content, MAX_CONTENT_LENGTH);
      if (!content) continue;
      const type = item.type === "hard" ? "hard" : "soft";
      const rationale = cleanString(item.rationale, MAX_CONTENT_LENGTH);
      requirements.push({
        type,
        content,
        ...(rationale ? { rationale } : {}),
      });
      if (requirements.length >= MAX_REQUIREMENTS) break;
    }
  }
  const qualityNotes: string[] = [];
  if (Array.isArray(root.quality_notes)) {
    for (const note of root.quality_notes) {
      const cleaned = cleanString(note, MAX_CONTENT_LENGTH);
      if (!cleaned) continue;
      qualityNotes.push(cleaned);
      if (qualityNotes.length >= MAX_QUALITY_NOTES) break;
    }
  }
  const sceneDescription = cleanString(
    root.scene_description,
    2_000,
  ) || "（管理员未提供场景描述）";
  return { scene_description: sceneDescription, requirements, quality_notes: qualityNotes };
}

@Injectable()
export class RequirementNormalizerService {
  async normalize(input: {
    sceneName: string;
    description: string;
    rawRequirements: string;
    signal?: AbortSignal;
  }): Promise<NormalizedTaskRequirements> {
    const apiKey = qwenApiKey();
    const baseUrl = qwenBaseUrl();
    if (!apiKey || !baseUrl) {
      throw new TaskFailure(
        "NORMALIZER_NOT_CONFIGURED",
        "AI 要求规范化服务未配置（缺少 QWEN_API_KEY 或 QWEN_BASE_URL）",
        503,
      );
    }
    const provider = new TextModelProvider({
      baseUrl,
      apiKey,
      model: taskRequirementNormalizerModel(),
      timeoutMs: taskRequirementNormalizerTimeoutMs(),
    });
    const userPayload = JSON.stringify({
      scene_name: input.sceneName,
      task_description: input.description,
      raw_requirements: input.rawRequirements,
    });
    let result;
    try {
      result = await provider.generateJson<unknown>({
        system: NORMALIZER_SYSTEM_PROMPT,
        user: userPayload,
        signal: input.signal,
      });
    } catch (error) {
      if (error instanceof TextModelRequestError) {
        throw new TaskFailure(
          "NORMALIZER_CALL_FAILED",
          `AI 要求规范化失败：${error.message}`,
          502,
        );
      }
      throw error;
    }
    const shaped = shapeNormalizedOutput(result.data);
    if (shaped.requirements.length === 0) {
      throw new TaskFailure(
        "NORMALIZER_EMPTY_RESULT",
        "AI 要求规范化结果为空，请检查要求描述后重试",
        422,
      );
    }
    return shaped;
  }
}
