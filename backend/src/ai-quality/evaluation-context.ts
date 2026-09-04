import { createHash } from "node:crypto";

import type { NormalizedTaskRequirements } from "../database/entities/collection-task.entity.js";
import type {
  LabelSetSnapshot,
  QualityRuleSnapshot,
} from "../rules/rule-calculator.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

/**
 * 解析提交时锁定的任务要求快照（submissions.task_requirements_snapshot）。
 * 快照两种形态：
 * - 任务流：{ scene_name, scene_description, requirements: [{type, content, rationale?}], quality_notes }
 * - guide 流（任务卡）：{ scene_name, scene_id, category_key, task_card: { success_criteria, fail_criteria, steps, end_condition } }
 * 非法结构返回 null（按无任务模式处理），不抛错。
 */
export function parseTaskRequirementsSnapshot(
  value: unknown,
): { sceneName: string; snapshot: NormalizedTaskRequirements } | null {
  if (!isRecord(value)) return null;
  const sceneName = cleanString(value.scene_name, 120);
  if (!sceneName) return null;
  const sceneDescription = cleanString(value.scene_description, 2_000);
  const requirements: NormalizedTaskRequirements["requirements"] = [];
  if (Array.isArray(value.requirements)) {
    for (const item of value.requirements) {
      if (!isRecord(item)) continue;
      const content = cleanString(item.content, 2_000);
      if (!content) continue;
      requirements.push({
        type: item.type === "hard" ? "hard" : "soft",
        content,
        ...(cleanString(item.rationale, 2_000)
          ? { rationale: cleanString(item.rationale, 2_000) }
          : {}),
      });
      if (requirements.length >= 100) break;
    }
  } else if (isRecord(value.task_card)) {
    // guide 流：从 AI 任务卡派生硬性/一般要求（成功/失败判定=硬性，步骤/结束条件=一般）
    const card = value.task_card;
    if (Array.isArray(card.success_criteria)) {
      for (const item of card.success_criteria) {
        const content = cleanString(item, 2_000);
        if (content) requirements.push({ type: "hard", content: `成功判定：${content}` });
        if (requirements.length >= 100) break;
      }
    }
    if (Array.isArray(card.fail_criteria)) {
      for (const item of card.fail_criteria) {
        const content = cleanString(item, 2_000);
        if (content) requirements.push({ type: "hard", content: `失败判定：${content}` });
        if (requirements.length >= 100) break;
      }
    }
    const endCondition = cleanString(card.end_condition, 2_000);
    if (endCondition) requirements.push({ type: "soft", content: `结束条件：${endCondition}` });
    if (Array.isArray(card.steps)) {
      for (const item of card.steps) {
        const content = cleanString(item, 2_000);
        if (content) requirements.push({ type: "soft", content: `操作步骤：${content}` });
        if (requirements.length >= 100) break;
      }
    }
  }
  if (requirements.length === 0) return null;
  const qualityNotes: string[] = [];
  if (Array.isArray(value.quality_notes)) {
    for (const note of value.quality_notes) {
      const cleaned = cleanString(note, 2_000);
      if (cleaned) qualityNotes.push(cleaned);
      if (qualityNotes.length >= 20) break;
    }
  }
  return {
    sceneName,
    snapshot: {
      scene_description:
        sceneDescription || "（任务未提供场景描述）",
      requirements,
      quality_notes: qualityNotes,
    },
  };
}

/**
 * 任务要求区块：把提交时锁定的任务要求快照渲染进系统提示词，
 * 供质检模型逐条判定「任务符合度」。
 */
export function taskRequirementsBlock(input: {
  sceneName: string;
  snapshot: NormalizedTaskRequirements;
}): string {
  return [
    "",
    "# 任务要求（提交时锁定，服务端权威）",
    "本次视频属于以下采集任务，必须逐条判定任务符合度并输出 task_compliance 区块：",
    JSON.stringify({
      scene_name: input.sceneName,
      scene_description: input.snapshot.scene_description,
      requirements: input.snapshot.requirements,
      quality_notes: input.snapshot.quality_notes ?? [],
    }),
  ].join("\n");
}

export function evaluationSystemPrompt(input: {
  basePrompt: string;
  qualityRule: QualityRuleSnapshot;
  labelSet: LabelSetSnapshot;
  /** 任务要求快照；缺省表示无任务模式（D4 按通用任务真实性判定） */
  taskRequirements?: {
    sceneName: string;
    snapshot: NormalizedTaskRequirements;
  } | null;
}): string {
  const enabledLabels = input.labelSet.labels.filter((label) => label.enabled);
  const parts = [
    input.basePrompt.trim(),
    "",
    "# 平台运行时规则快照（服务端锁定）",
    "以下 JSON 是本次任务的权威规则与标签上下文。通过阈值由服务端复算；标签仅可从 enabled_labels 中选择，停用标签不得输出。",
    JSON.stringify({
      quality_rule: input.qualityRule,
      label_set: {
        id: input.labelSet.id,
        revision: input.labelSet.revision,
        version: input.labelSet.version,
        enabled_labels: enabledLabels,
      },
    }),
  ];
  if (input.taskRequirements) {
    parts.push(
      taskRequirementsBlock({
        sceneName: input.taskRequirements.sceneName,
        snapshot: input.taskRequirements.snapshot,
      }),
    );
  }
  return parts.join("\n");
}

export function promptContentSha256(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}
