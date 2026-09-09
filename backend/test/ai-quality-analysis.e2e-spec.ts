import { PointCyclesService, nextSettlementAt } from "../src/points/point-cycles.service.js";
import { PointCyclesPolicy } from "../src/points/point-cycles.policy.js";
import { PointRulesService } from "../src/points/point-rules.service.js";
import { PointCycleEntity } from "../src/database/entities/point-cycle.entity.js";
import { PointRuleVersionEntity } from "../src/database/entities/point-rule-version.entity.js";
import { PointCycleItemEntity } from "../src/database/entities/point-cycle-item.entity.js";
import { WalletBalanceEntity, WalletTransactionEntity } from "../src/database/entities/wallet.entity.js";
import { WalletService } from "../src/wallet/wallet.service.js";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import type { DataSource } from "typeorm";
import { vi } from "vitest";

import {
  AiQualityAnalysisService,
  RetryableAiQualityError,
} from "../src/ai-quality/ai-quality-analysis.service.js";
import { AiQualityPromptService } from "../src/ai-quality/ai-quality-prompt.service.js";
import type { AiQualityEvaluatorFactory } from "../src/ai-quality/ai-quality.tokens.js";
import { LabelSetService } from "../src/ai-quality/label-set.service.js";
import { QualityRuleService } from "../src/ai-quality/quality-rule.service.js";
import type { AuditService } from "../src/audit/audit.service.js";
import { createDataSource } from "../src/database/data-source.js";
import { LabelSetVersionEntity } from "../src/database/entities/label-set-version.entity.js";
import { MediaMetadataEntity } from "../src/database/entities/media-metadata.entity.js";
import { QualityRuleVersionEntity } from "../src/database/entities/quality-rule-version.entity.js";
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
  async readObject(): Promise<never> {
    throw new Error("not used");
  }
  async uploadObject(): Promise<never> {
    throw new Error("not used");
  }
  async createMultipartUpload(): Promise<never> {
    throw new Error("not used");
  }
  async presignUploadPart(): Promise<never> {
    throw new Error("not used");
  }
  async presignDownloadObject(): Promise<never> {
    throw new Error("not used");
  }
  async deleteObject(): Promise<never> {
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
    schemaVersion: "video_qc_v2",
    ruleVersion: "video_qc_v2",
    promptVersion: "qwen_video_qc_prompt_v4",
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
    hardVeto: { triggered: false, reasons: [], candidates: [] },
    detectedTask: { task_id: "task", task_summary: "完成桌面整理", confidence: null },
    taskCompliance: null,
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

function privacyHardReject(videoId: string): NormalizedVideoQcResultV1 {
  return {
    ...scored(videoId),
    evaluationStatus: "hard_reject",
    finalScore: 61,
    settlementRatio: 0,
    hardVeto: { triggered: true, reasons: ["PRIVACY_OR_SAFETY"], candidates: [] },
    reviewReasons: ["明确包含隐私信息"],
    summary: "画面包含平台禁止收集的隐私内容",
  };
}

describe("AI quality analysis persistence", () => {
  let dataSource: DataSource;
  let submissionId: string;
  let evaluate: ReturnType<typeof vi.fn>;
  let service: AiQualityAnalysisService;
  const evaluatorPrompts: Parameters<AiQualityEvaluatorFactory>[0][] = [];

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
    const qualityRuleService = new QualityRuleService(
      dataSource,
      dataSource.getRepository(QualityRuleVersionEntity),
      {} as AuditService,
    );
    const labelSetService = new LabelSetService(
      dataSource,
      dataSource.getRepository(LabelSetVersionEntity),
      {} as AuditService,
    );
    const scarcityConfigService = {
      getActive: async () => ({
        id: "SC-test",
        revision: 1,
        version: "SCARCITY-TEST",
        enabled: true,
        tiers: [
          { id: "t1", minCount: 0, maxCount: 5, coefficient: 1, label: "稀缺" },
          { id: "t2", minCount: 6, maxCount: null, coefficient: 0.9, label: "较多" },
        ],
        weights: { scene: 0.2, standardTask: 0.5, variant: 0.3 },
        description: "test",
        createdByAccountId: "u",
        createdByName: "t",
        createdAt: new Date(),
      }),
    };
    const inventoryService = {
      buildInventoryContext: async () => ({
        snapshot_id: "inventory-test",
        mode: "cold_start",
        authoritative_coefficient: 1,
        c_scene: 1,
        c_standard_task: 1,
        c_variant: 1,
        current_video_excluded: true,
        scene_inventory_count: null,
        task_inventory_count: null,
        variant_inventory_count: null,
        scene_name: null,
        task_name: null,
        variant_name: null,
      }),
    };
    evaluate = vi.fn(async (input: { videoId: string }) => scored(input.videoId));
    const evaluatorFactory: AiQualityEvaluatorFactory = (prompt) => {
      evaluatorPrompts.push(prompt);
      return { evaluate: evaluate as never };
    };
    service = new AiQualityAnalysisService(
      dataSource,
      dataSource.getRepository(SubmissionEntity),
      dataSource.getRepository(VideoQualityResultEntity),
      promptService,
      qualityRuleService,
      labelSetService,
      scarcityConfigService as never,
      inventoryService as never,
      new TestStorage(),
      evaluatorFactory,
      new PointCyclesService(
        dataSource.getRepository(PointCycleEntity),
        dataSource,
        new PointCyclesPolicy(),
        {} as AuditService,
        new PointRulesService(dataSource, dataSource.getRepository(PointRuleVersionEntity), {} as AuditService),
        new WalletService(dataSource.getRepository(WalletBalanceEntity), dataSource.getRepository(WalletTransactionEntity), dataSource.getRepository(UserEntity)),
        new TestStorage(),
      ),
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
      qualityRuleRevision: 1,
      labelSetRevision: 1,
      finalScore: "86.0",
      settlementRatio: "1.0000",
      passed: true,
      summary: "视频质量合格",
    });
    expect(quality.qualityRuleSnapshot).toMatchObject({
      revision: 1,
      passThreshold: 60,
    });
    expect(quality.labelSetSnapshot).toMatchObject({ revision: 1 });
    expect(evaluatorPrompts[0]?.systemPrompt).toContain("平台运行时规则快照");
    expect(evaluatorPrompts[0]?.systemPrompt).toContain("家庭厨房");
    expect(
      await dataSource.getRepository(SubmissionEntity).findOneByOrFail({
        id: submissionId,
      }),
    ).toMatchObject({ processingStatus: "completed" });

    await expect(service.process({ submissionId })).resolves.toBe("skipped");
    expect(evaluate).toHaveBeenCalledTimes(1);
    const item = await dataSource.getRepository(PointCycleItemEntity).findOneByOrFail({ submissionId });
    const cycle = await dataSource.getRepository(PointCycleEntity).findOneByOrFail({ id: item.cycleId });
    expect(cycle.settleDueAt).toEqual(nextSettlementAt(quality.completedAt!));
    expect(await dataSource.getRepository(WalletBalanceEntity).findOneByOrFail({ ownerId: "U-AI-COLLECTOR" }))
      .toMatchObject({ settlingBalance: item.points, availableBalance: "0.00" });
    expect(await dataSource.getRepository(WalletTransactionEntity).countBy({ submissionId, type: "lock" })).toBe(1);
  });

  it("detects the later authoritative upload even when duplicate AI tasks start together", async () => {
    const checksumSha256 = "e".repeat(64);
    const canonicalId = `SUB-${randomUUID()}`;
    const duplicateId = `SUB-${randomUUID()}`;
    await dataSource.getRepository(SubmissionEntity).save([
      {
        id: canonicalId,
        ownerId: "U-AI-COLLECTOR",
        teamId: "TEAM-AI",
        originalFileName: "canonical.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: String(VIDEO_BYTES.length),
        checksumSha256,
        objectKey: `uploads/${canonicalId}/canonical.mp4`,
        uploadStatus: "uploaded",
        processingStatus: "awaiting_ai",
        uploadedAt: new Date("2026-08-14T01:00:00Z"),
      },
      {
        id: duplicateId,
        ownerId: "U-AI-COLLECTOR",
        teamId: "TEAM-AI",
        originalFileName: "duplicate.mp4",
        contentType: "video/mp4",
        expectedSizeBytes: String(VIDEO_BYTES.length),
        checksumSha256,
        objectKey: `uploads/${duplicateId}/duplicate.mp4`,
        uploadStatus: "uploaded",
        processingStatus: "awaiting_ai",
        uploadedAt: new Date("2026-08-14T01:01:00Z"),
      },
    ]);
    await dataSource.getRepository(MediaMetadataEntity).save(
      [canonicalId, duplicateId].map((id) => ({
        submissionId: id,
        durationSeconds: "10.000",
        width: 1920,
        height: 1080,
        frameRate: "30.000",
        codec: "h264",
        bitrate: "1000000",
        sizeBytes: String(VIDEO_BYTES.length),
        rawProbe: {},
      })),
    );
    const duplicateFlags = new Map<string, boolean>();
    for (let index = 0; index < 2; index += 1) {
      evaluate.mockImplementationOnce(
        async (input: {
          videoId: string;
          registerSha256: (checksum: string) => boolean;
        }) => {
          duplicateFlags.set(
            input.videoId,
            input.registerSha256(checksumSha256),
          );
          return scored(input.videoId);
        },
      );
    }

    await expect(
      Promise.all([
        service.process({ submissionId: canonicalId }),
        service.process({ submissionId: duplicateId }),
      ]),
    ).resolves.toEqual(["processed", "processed"]);
    expect(duplicateFlags).toEqual(
      new Map([
        [canonicalId, false],
        [duplicateId, true],
      ]),
    );
    expect(
      await dataSource
        .getRepository(VideoQualityResultEntity)
        .findOneByOrFail({ submissionId: canonicalId }),
    ).toMatchObject({
      status: "scored",
      settlementRatio: "1.0000",
      passed: true,
    });
    expect(
      await dataSource
        .getRepository(VideoQualityResultEntity)
        .findOneByOrFail({ submissionId: duplicateId }),
    ).toMatchObject({
      status: "hard_reject",
      settlementRatio: "0.0000",
      passed: false,
    });
    const duplicateResult = await dataSource
      .getRepository(VideoQualityResultEntity)
      .findOneByOrFail({ submissionId: duplicateId });
    expect(duplicateResult.normalizedResult).toMatchObject({
      evaluationStatus: "hard_reject",
      settlementRatio: 0,
      hardVeto: {
        triggered: true,
        reasons: expect.arrayContaining(["EXACT_DUPLICATE"]),
      },
    });
  });

  it("only applies a newly published threshold to newly started tasks", async () => {
    const rules = dataSource.getRepository(QualityRuleVersionEntity);
    await rules.update({ active: true }, { active: false });
    await rules.save({
      id: "QRV-AI-STRICT",
      revision: 2,
      version: "RULE-AI-STRICT",
      passThreshold: 90,
      description: "新任务九十分通过",
      active: true,
      createdByAccountId: "U-AI-ADMIN",
      createdByName: "管理员",
    });
    const nextSubmissionId = `SUB-${randomUUID()}`;
    await dataSource.getRepository(SubmissionEntity).save({
      id: nextSubmissionId,
      ownerId: "U-AI-COLLECTOR",
      teamId: "TEAM-AI",
      originalFileName: "strict-rule.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: String(VIDEO_BYTES.length),
      checksumSha256: createHash("sha256")
        .update(Buffer.from(nextSubmissionId))
        .digest("hex"),
      objectKey: `uploads/${nextSubmissionId}/strict-rule.mp4`,
      uploadStatus: "uploaded",
      processingStatus: "awaiting_ai",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: nextSubmissionId,
      durationSeconds: "10.000",
      width: 1920,
      height: 1080,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: String(VIDEO_BYTES.length),
      rawProbe: {},
    });

    await expect(service.process({ submissionId: nextSubmissionId })).resolves.toBe(
      "processed",
    );
    expect(
      await dataSource
        .getRepository(VideoQualityResultEntity)
        .findOneByOrFail({ submissionId: nextSubmissionId }),
    ).toMatchObject({
      qualityRuleRevision: 2,
      qualityRuleSnapshot: { passThreshold: 90 },
      finalScore: "86.0",
      settlementRatio: "0.0000",
      passed: false,
    });
    expect(
      await dataSource
        .getRepository(VideoQualityResultEntity)
        .findOneByOrFail({ submissionId }),
    ).toMatchObject({
      qualityRuleRevision: 1,
      qualityRuleSnapshot: { passThreshold: 60 },
      settlementRatio: "1.0000",
      passed: true,
    });
  });

  it("quarantines AI results that hit privacy or sensitive-content risks", async () => {
    const nextSubmissionId = `SUB-${randomUUID()}`;
    await dataSource.getRepository(SubmissionEntity).save({
      id: nextSubmissionId,
      ownerId: "U-AI-COLLECTOR",
      teamId: "TEAM-AI",
      originalFileName: "privacy.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: String(VIDEO_BYTES.length),
      checksumSha256: createHash("sha256")
        .update(Buffer.from(`${nextSubmissionId}-video`))
        .digest("hex"),
      objectKey: `uploads/${nextSubmissionId}/privacy.mp4`,
      uploadStatus: "uploaded",
      processingStatus: "awaiting_ai",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: nextSubmissionId,
      durationSeconds: "10.000",
      width: 1920,
      height: 1080,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: String(VIDEO_BYTES.length),
      rawProbe: {},
    });
    evaluate.mockResolvedValueOnce(privacyHardReject(nextSubmissionId));

    await expect(service.process({ submissionId: nextSubmissionId })).resolves.toBe(
      "processed",
    );

    expect(
      await dataSource.getRepository(SubmissionEntity).findOneByOrFail({
        id: nextSubmissionId,
      }),
    ).toMatchObject({
      processingStatus: "completed",
      assetStatus: "quarantined",
      quarantineReason: "AI 命中敏感或隐私风险",
      quarantinedByName: "AI 质检",
    });
  });

  it("releases the submission lock when an old evaluator ignores abort", async () => {
    const nextSubmissionId = `SUB-${randomUUID()}`;
    await dataSource.getRepository(SubmissionEntity).save({
      id: nextSubmissionId,
      ownerId: "U-AI-COLLECTOR",
      teamId: "TEAM-AI",
      originalFileName: "ignored-abort.mp4",
      contentType: "video/mp4",
      expectedSizeBytes: String(VIDEO_BYTES.length),
      checksumSha256: createHash("sha256")
        .update(Buffer.from(`${nextSubmissionId}-video`))
        .digest("hex"),
      objectKey: `uploads/${nextSubmissionId}/ignored-abort.mp4`,
      uploadStatus: "uploaded",
      processingStatus: "awaiting_ai",
      uploadedAt: new Date(),
    });
    await dataSource.getRepository(MediaMetadataEntity).save({
      submissionId: nextSubmissionId,
      durationSeconds: "10.000",
      width: 1920,
      height: 1080,
      frameRate: "30.000",
      codec: "h264",
      bitrate: "1000000",
      sizeBytes: String(VIDEO_BYTES.length),
      rawProbe: {},
    });
    let markEvaluatorStarted: () => void = () => undefined;
    const evaluatorStarted = new Promise<void>((resolve) => {
      markEvaluatorStarted = resolve;
    });
    evaluate.mockImplementationOnce(() => {
      markEvaluatorStarted();
      return new Promise<NormalizedVideoQcResultV1>(() => undefined);
    });
    const controller = new AbortController();
    const processing = service.process({
      submissionId: nextSubmissionId,
      signal: controller.signal,
      terminalOnRetryableFailure: true,
    });
    await evaluatorStarted;

    await expect(
      service.process({ submissionId: nextSubmissionId }),
    ).resolves.toBe("lock_busy");
    controller.abort(new RetryableAiQualityError("forced evaluator timeout"));
    await expect(processing).rejects.toThrow("forced evaluator timeout");
    await expect(
      dataSource.getRepository(SubmissionEntity).findOneByOrFail({
        id: nextSubmissionId,
      }),
    ).resolves.toMatchObject({ processingStatus: "awaiting_ai" });
    await expect(
      dataSource.getRepository(VideoQualityResultEntity).findOneByOrFail({
        submissionId: nextSubmissionId,
      }),
    ).resolves.toMatchObject({ status: "queued", attempts: 1 });

    evaluate.mockImplementationOnce(async (input: { videoId: string }) =>
      scored(input.videoId),
    );
    await expect(
      service.process({ submissionId: nextSubmissionId }),
    ).resolves.toBe("processed");
  });
});
