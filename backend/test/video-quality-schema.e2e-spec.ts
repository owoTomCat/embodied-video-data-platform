import { randomUUID } from "node:crypto";

import type { DataSource } from "typeorm";

import { createDataSource } from "../src/database/data-source.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { VideoQualityPromptVersionEntity } from "../src/database/entities/video-quality-prompt-version.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";

describe("AI video quality database schema", () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-AI",
      name: "AI 测试团队",
    });
    await dataSource.getRepository(UserEntity).save({
      id: "U-AI-ADMIN",
      displayName: "AI 管理员",
      username: "ai-admin",
      usernameNormalized: "ai-admin",
      passwordHash: "argon-hash",
      role: "admin",
      status: "active",
    });
    await dataSource.getRepository(UserEntity).save({
      id: "U-AI-COLLECTOR",
      displayName: "AI 数采",
      username: "ai-collector",
      usernameNormalized: "ai-collector",
      passwordHash: "argon-hash",
      role: "collector",
      teamId: "TEAM-AI",
      status: "active",
    });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("stores one active prompt version and rejects a second active version", async () => {
    const prompts = dataSource.getRepository(VideoQualityPromptVersionEntity);
    await prompts.save({
      id: "VQP-1",
      revision: 1,
      systemPrompt: "返回 video_qc_result_v2 JSON。",
      contentSha256: "a".repeat(64),
      promptVersion: "qwen_video_qc_prompt_v2_traceable",
      ruleVersion: "video_qc_v2_traceable",
      outputSchema: "video_qc_result_v2",
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      active: true,
      createdByAccountId: "U-AI-ADMIN",
      createdByName: "AI 管理员",
    });

    await expect(
      prompts.save({
        id: "VQP-2",
        revision: 2,
        systemPrompt: "另一个提示词",
        contentSha256: "b".repeat(64),
        promptVersion: "qwen_video_qc_prompt_v2_traceable",
        ruleVersion: "video_qc_v2_traceable",
        outputSchema: "video_qc_result_v2",
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        active: true,
        createdByAccountId: "U-AI-ADMIN",
        createdByName: "AI 管理员",
      }),
    ).rejects.toThrow();
  });

  it("stores a prompt snapshot and persisted normalized result", async () => {
    const submissionId = `SUB-${randomUUID()}`;
    await dataSource.getRepository(SubmissionEntity).save({
      id: submissionId,
      ownerId: "U-AI-COLLECTOR",
      teamId: "TEAM-AI",
      originalFileName: "quality.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: "2048",
      checksumSha256: "c".repeat(64),
      objectKey: `uploads/${submissionId}/quality.mp4`,
      uploadStatus: "uploaded",
      processingStatus: "ai_processing",
      isTestData: false,
    });

    const results = dataSource.getRepository(VideoQualityResultEntity);
    await results.save({
      submissionId,
      status: "scored",
      attempts: 1,
      promptVersionId: "VQP-1",
      promptRevision: 1,
      promptContentSha256: "a".repeat(64),
      systemPromptSnapshot: "返回 video_qc_result_v2 JSON。",
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      modelRuns: [{ stage: "initial", model: "qwen3.7-plus" }],
      finalScore: "88.5",
      rawTotalScore: "88.5",
      settlementRatio: "1.0000",
      invalidDurationMs: "1000",
      billableDurationMs: "59000",
      summary: "质量合格",
      recommendations: ["保持稳定拍摄"],
      deductions: [],
      reviewRequired: false,
      reviewReasons: [],
      normalizedResult: { finalScore: 88.5 },
      rawModelResult: { final_score: 88.5 },
      startedAt: new Date(),
      completedAt: new Date(),
    });

    expect(await results.findOneByOrFail({ submissionId })).toMatchObject({
      status: "scored",
      promptRevision: 1,
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      finalScore: "88.5",
      systemPromptSnapshot: "返回 video_qc_result_v2 JSON。",
    });
  });
});
