import { describe, expect, it, vi } from "vitest";

import type { LoadedSceneGuidePrompt } from "../src/scene-guide/scene-guide.prompt.js";
import { QwenSceneGuideProvider } from "../src/scene-guide/qwen-scene-guide.provider.js";

const prompt: LoadedSceneGuidePrompt = {
  promptVersion: "test",
  envRecognitionSystemPrompt: "recognize environment objects",
  envRecognitionOutputExample: {},
  envRecognitionModel: "qwen-vl-test",
  taskCardSystemPrompt: "generate task cards",
  taskCardOutputExample: {},
  taskCardModel: "qwen-text-test",
  contentSha256: "test",
};

describe("qwen scene-guide provider configuration", () => {
  it.each([
    { label: "API key", apiKey: "", baseUrl: "https://example.invalid/v1" },
    { label: "base URL", apiKey: "test-key", baseUrl: "" },
  ])(
    "starts without $label and returns a not-configured failure only when called",
    async ({ apiKey, baseUrl }) => {
      const fetcher = vi.fn<typeof fetch>();
      const provider = new QwenSceneGuideProvider({
        apiKey,
        baseUrl,
        timeoutMs: 1_000,
        prompt,
        fetcher,
      });

      await expect(
        provider.recognizeEnvObjects(["data:image/jpeg;base64,AA=="]),
      ).rejects.toMatchObject({
        status: 503,
        kind: "not_configured",
        message: expect.stringContaining("未配置"),
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
