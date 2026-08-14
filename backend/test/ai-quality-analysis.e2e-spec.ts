import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import type { DataSource } from "typeorm";
import { vi } from "vitest";

import { AiQualityAnalysisService } from "../src/ai-quality/ai-quality-analysis.service.js";
import { AiQualityPromptService } from "../src/ai-quality/ai-quality-prompt.service.js";
import type { AiQualityEvaluatorFactory } from "../src/ai-quality/ai-quality.tokens.js";
import type { AuditService } from "../src/audit/audit.service.js";
import { createDataSource } from "../src/database/data-source.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { SubmissionEntity } from "../src/database/entities/submission.entity.js";
import { TeamEntity } from "../src/database/entities/team.entity.js";
import { UserEntity } from "../src/database/entities/user.entity.js";
import { VideoQualityPromptVersionEntity } from "../src/database/entities/video-quality-prompt-version.entity.js";
import { VideoQualityResultEntity } from "../src/database/entities/video-quality-result.entity.js";
import type { ObjectStoragePort } from "../src/storage/object-storage.port.js";
import type { NormalizedVideoQcResultV1 } from "../src/video-quality/video-quality.types.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://evdp:evdp_local_postgres_password@127.0.0.1:55432/evdp_test";
const VIDEO_BYTES = Buffer.from("ai-quality-test-video", "utf8");

class TestStorage implements ObjectStoragePort {
  async downloadObject(input: { destinationPath: string }): Promise<void> {
    await writeFile(input.destinationPath, VIDEO_BYTES);
  }
  async createMultipartUpload(): Promise<never> {
    throw new Error("not used");
  }
  async presignUploadPart(): Promise<never> {
    throw new Error("not used");
  }
  async completeMultipartUpload(): Promise<never> {
    throw new Error("not used");
  }
  async headObject(): Promise<never> {
    throw new Error("not used");
  }
  async abortMultipartUpload(): Promise<never> {
    throw new Error("not used");
  }
}

function scored(videoId: string): NormalizedVideoQcResultV1 {
  return {
    schemaVersion: "video_qc_result_v2",
    ruleVersion: "video_qc_v2_traceable",
    promptVersion: "qwen_video_qc_prompt_v2_traceable",
    videoId,
    evaluationStatus: "scored",
    dimensions: {} as NormalizedVideoQcResultV1["dimensions"],
    rawTotalScore: 88.5,
    finalScore: 86,
    settlementRatio: 0.9,
    analysisDurationMs: 10_000,
    invalidDurationMs: 1_000,
    billableDurationMs: 9_000,
    invalidSegments: [],
    hardVeto: { triggered: false, reasons: [] },
    detectedTask: {
      scene_id: "scene",
      task_id: "task",
      variant_id: "variant",
      task_summary: "完成桌面整理",
      confidence: 0.95,
    },
    deductions: [],
    recommendations: ["保持当前拍摄角度"],
    summary: "视频质量合格",
    reviewRequired: false,
    reviewReasons: [],
    missingInputs: [],
    validation: { warnings: [], errors: [] },
    rawModelResult: {} as NormalizedVideoQcResultV1["rawModelResult"],
    modelRuns: [
      {
        stage: "initial",
        model: "qwen3.7-plus",
        requestId: "request-test",
        durationMs: 10,
        frameCount: 4,
      },
    ],
    media: {
      metadata: {} as NormalizedVideoQcResultV1["media"]["metadata"],
      technicalMetrics:
        {} as NormalizedVideoQcResultV1["media"]["technicalMetrics"],
      fullVideoSamplingFps: 0.2,
      fullVideoFrameCount: 4,
    },
  };
}

describe("AI quality analysis persistence", () => {
  let dataSource: DataSource;
  let submissionId: string;
  let evaluate: ReturnType<typeof vi.fn>;
  let service: AiQualityAnalysisService;

  beforeAll(async () => {
    dataSource = createDataSource(TEST_DATABASE_URL);
    await dataSource.initialize();
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    await dataSource.getRepository(TeamEntity).save({
      id: "TEAM-AI",
      name: "AI 测试团队",
    });
    await dataSource.getRepository(UserEntity).save([
      {
        id: "U-AI-ADMIN",
        displayName: "管理员",
        username: "admin-ai",
        usernameNormalized: "admin-ai",
        passwordHash: "argon-hash",
        role: "admin",
        teamId: null,
        status: "active",
      },
      {
        id: "U-AI-COLLECTOR",
        displayName: "数采",
        username: "collector-ai",
        usernameNormalized: "collector-ai",
        passwordHash: "argon-hash",
        role: "collector",
        teamId: "TEAM-AI",
        status: "active",
      },
    ]);
    submissionId = `SUB-${randomUUID()}`;
    await dataSource.getRepository(SubmissionEntity).save({
      id: submissionId,
      ownerId: "U-AI-COLLECTOR",
      teamId: "TEAM-AI",
      originalFileName: "quality.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: String(VIDEO_BYTES.length),
      checksumSha256: createHash("sha256").update(VIDEO_BYTES).digest("hex"),
      objectKey: `uploads/${submissionId}/quality.mp4`,
      uploadStatus: "uploaded",
      processingStatus: "awaiting_ai",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId,
      durationSeconds: "10.000",
      width: 1920,
      height: 1080,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: String(VIDEO_BYTES.length),
      rawProbe: {},
    });
    const promptService = new AiQualityPromptService(
      dataSource,
      dataSource.getRepository(VideoQualityPromptVersionEntity),
      {} as AuditService,
    );
    evaluate = vi.fn(async (input: { videoId: string }) => scored(input.videoId));
    const evaluatorFactory: AiQualityEvaluatorFactory = () => ({
      evaluate: evaluate as never,
    });
    service = new AiQualityAnalysisService(
      dataSource,
      dataSource.getRepository(SubmissionEntity),
      dataSource.getRepository(VideoQualityResultEntity),
      promptService,
      new TestStorage(),
      evaluatorFactory,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it("locks Qwen3.7 routing, persists the real result, and skips duplicates", async () => {
    await expect(service.process({ submissionId })).resolves.toBe("processed");
    const quality = await dataSource
      .getRepository(VideoQualityResultEntity)
      .findOneByOrFail({ submissionId });
    expect(quality).toMatchObject({
      status: "scored",
      attempts: 1,
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      finalScore: "86.0",
      settlementRatio: "0.9000",
      summary: "视频质量合格",
    });
    expect(
      await dataSource.getRepository(SubmissionEntity).findOneByOrFail({
        id: submissionId,
      }),
    ).toMatchObject({ processingStatus: "completed" });

    await expect(service.process({ submissionId })).resolves.toBe("skipped");
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
