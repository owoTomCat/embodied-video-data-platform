import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadVideoQualityPrompt } from "../src/video-quality/prompt-loader.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("video quality prompt loader", () => {
  it("loads the committed V1 system prompt and model metadata", async () => {
    const prompt = await loadVideoQualityPrompt(
      resolve(
        process.cwd(),
        "../docs/quality/qwen-video-ai-quality-prompt-v1.md",
      ),
    );

    expect(prompt.promptVersion).toBe("qwen_video_qc_prompt_v2_traceable");
    expect(prompt.ruleVersion).toBe("video_qc_v2_traceable");
    expect(prompt.outputSchema).toBe("video_qc_result_v2");
    expect(prompt.initialModel).toBe("qwen3.7-plus");
    expect(prompt.reviewModel).toBe("qwen3.7-flash");
    expect(prompt.systemPrompt).toContain("具身视频数据质量评估器");
    expect(prompt.systemPrompt).toContain("简体中文");
    expect(prompt.systemPrompt).toContain("task_summary");
    expect(prompt.systemPrompt).toContain("recommendations");
    expect(prompt.systemPrompt).not.toContain("## 用户输入模板");
    expect(prompt.outputExample.schema_version).toBe("video_qc_result_v2");
    expect(prompt.outputExample).toHaveProperty("hard_veto.triggered", false);
    expect(prompt.outputExample).toHaveProperty(
      "dimensions.task_value_uniqueness",
    );
    expect(prompt.contentSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects a prompt document without the system prompt block", async () => {
    const directory = await mkdtemp(join(tmpdir(), "evdp-prompt-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "bad.md");
    await writeFile(
      path,
      [
        "提示词版本：`qwen_video_qc_prompt_v2_traceable`",
        "适配规则：`video_qc_v2_traceable`",
        "推荐模型：`qwen3.7-plus`",
        "复核模型：`qwen3.7-flash`",
      ].join("\n"),
      "utf8",
    );

    await expect(loadVideoQualityPrompt(path)).rejects.toThrow("系统提示词");
  });

  it("rejects unsupported prompt and rule versions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "evdp-prompt-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "bad-version.md");
    await writeFile(
      path,
      [
        "提示词版本：`qwen_video_qc_prompt_v2`",
        "适配规则：`video_qc_v2`",
        "推荐模型：`qwen3.7-plus`",
        "复核模型：`qwen3.7-flash`",
        "## 系统提示词",
        "```text",
        "system prompt",
        "```",
        "requested_output_schema: video_qc_result_v2",
      ].join("\n"),
      "utf8",
    );

    await expect(loadVideoQualityPrompt(path)).rejects.toThrow("不支持");
  });

  it("rejects a supported prompt without its standard output contract", async () => {
    const directory = await mkdtemp(join(tmpdir(), "evdp-prompt-test-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "missing-output.md");
    await writeFile(
      path,
      [
        "提示词版本：`qwen_video_qc_prompt_v2_traceable`",
        "适配规则：`video_qc_v2_traceable`",
        "推荐模型：`qwen3.7-plus`",
        "复核模型：`qwen3.7-flash`",
        "## 系统提示词",
        "```text",
        "system prompt",
        "```",
        '"requested_output_schema": "video_qc_result_v2"',
      ].join("\n"),
      "utf8",
    );

    await expect(loadVideoQualityPrompt(path)).rejects.toThrow("标准输出结构");
  });
});
