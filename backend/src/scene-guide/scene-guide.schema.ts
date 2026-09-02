import { z } from "zod";

export const SCENE_GUIDE_SCHEMA_VERSION = "scene_guide_v1" as const;
export const SCENE_GUIDE_PROMPT_VERSION = "scene_guide_v1" as const;

const objectCategory = z.enum([
  "appliance",
  "furniture",
  "object",
  "surface",
  "other",
]);

const confident = z.number().min(0).max(1);

/** Qwen-VL 环境物体识别输出 */
export const envelopeEnvRecognitionSchema = z.object({
  objects: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        category: objectCategory.optional(),
        confidence: confident.optional(),
      }),
    )
    .max(50),
  scene_summary: z.string().min(1).max(2_000).optional(),
});

export type EnvRecognitionRaw = z.infer<
  typeof envelopeEnvRecognitionSchema
>;

/** LLM 结构化任务卡输出 */
export const envelopeTaskCardSchema = z.object({
  target_objects: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        action: z.string().min(1).max(500).optional(),
      }),
    )
    .min(1)
    .max(10),
  steps: z.array(z.string().min(1).max(500)).min(1).max(12),
  end_condition: z.string().min(1).max(500),
  success_criteria: z.array(z.string().min(1).max(500)).min(1).max(10),
  fail_criteria: z.array(z.string().min(1).max(500)).min(1).max(10),
});

export type TaskCardRaw = z.infer<typeof envelopeTaskCardSchema>;
