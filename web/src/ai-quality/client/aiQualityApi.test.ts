import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAiQualityPrompt,
  updateAiQualityPrompt,
} from "./aiQualityApi";

describe("AI quality prompt API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads and updates the administrator prompt with credentials", async () => {
    const prompt = {
      id: "VQP-1",
      revision: 1,
      systemPrompt: "系统提示词",
      contentSha256: "a".repeat(64),
      promptVersion: "qwen_video_qc_prompt_v1",
      ruleVersion: "video_qc_v1",
      outputSchema: "video_qc_result_v2",
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      createdByName: "管理员",
      createdAt: 1,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ prompt }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ prompt: { ...prompt, revision: 2 } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetcher);

    await expect(getAiQualityPrompt()).resolves.toEqual(prompt);
    await expect(updateAiQualityPrompt("新提示词")).resolves.toMatchObject({
      revision: 2,
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "http://localhost:4000/api/v1/ai-quality/prompt",
      expect.objectContaining({
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ systemPrompt: "新提示词" }),
      }),
    );
  });
});
