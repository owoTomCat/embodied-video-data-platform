import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import type { BackendTaskSegmentAsset } from "../../operations/contracts";
import { getPointRule } from "../../points/client/pointCycleApi";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import {
  getSubmission,
  getSubmissionPreview,
  listActiveUploads,
  listAnnotationRuns,
  loadAllSubmissions,
  searchSubmissions,
} from "../../submissions/client/submissionApi";
import type {
  BackendAnnotationRun,
  BackendSubmission,
  BackendVideoAnnotationTask,
} from "../../submissions/contracts";
import {
  resumeUploadVideo,
  uploadVideo,
} from "../../submissions/upload/multipartUploader";

vi.mock("../../submissions/upload/multipartUploader", () => ({
  resumeUploadVideo: vi.fn(),
  uploadVideo: vi.fn(),
}));

vi.mock("../../submissions/client/submissionApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../submissions/client/submissionApi")>();
  return {
    ...actual,
    getSubmission: vi.fn(),
    getSubmissionPreview: vi.fn(),
    listActiveUploads: vi.fn(),
    listAnnotationRuns: vi.fn(),
    loadAllSubmissions: vi.fn(),
    searchSubmissions: vi.fn(),
  };
});

vi.mock("../../points/client/pointCycleApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../points/client/pointCycleApi")>();
  return {
    ...actual,
    getPointRule: vi.fn(),
  };
});

const taskSegmentApi = vi.hoisted(() => ({
  generateTaskSegments: vi.fn(),
  getTaskSegmentAssets: vi.fn(),
  getTaskSegmentPreview: vi.fn(),
  retryTaskSegment: vi.fn(),
}));

vi.mock("../../operations/client/operationsApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../operations/client/operationsApi")>();
  return {
    ...actual,
    ...taskSegmentApi,
  };
});

const taskApi = vi.hoisted(() => ({
  listTasksForCollector: vi.fn(),
}));

vi.mock("../../tasks/client/taskApi", () => ({
  listTasksForCollector: taskApi.listTasksForCollector,
  taskErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "操作失败，请重试",
}));

const publishedTask = {
  id: "TASK-1",
  title: "厨房数据采集",
  description: "拍摄厨房场景操作视频",
  sceneName: "家庭厨房",
  sceneLabelId: "SCENE-001",
  normalizedRequirements: {
    scene_description: "家庭厨房场景，第一人称双手操作。",
    requirements: [
      { type: "hard", content: "必须全程第一人称视角拍摄" },
      { type: "soft", content: "光线充足画面清晰" },
    ],
    quality_notes: [],
  },
  pricePointsPerMinute: 15.5,
  status: "published",
  revision: 1,
  publishedAt: Date.now(),
};

function backendSubmission(
  overrides: Partial<BackendSubmission> = {},
): BackendSubmission {
  return {
    id: "SUB-001",
    fileName: "kitchen_breakfast_0803.mov",
    ownerId: "U-COL-01",
    ownerName: "测试人员1",
    teamId: "TEAM-01",
    teamName: "星火一队",
    sizeBytes: String(286 * 1024 * 1024),
    uploadStatus: "uploaded",
    processingStatus: "completed",
    settlementStatus: "unsettled",
    isTestData: false,
    createdAt: Date.parse("2026-08-03T09:36:00+08:00"),
    uploadedAt: Date.parse("2026-08-03T09:37:00+08:00"),
    media: {
      durationSeconds: 152,
      width: 3840,
      height: 2160,
      frameRate: 30,
      codec: "h264",
      bitrate: "1000",
      sizeBytes: String(286 * 1024 * 1024),
    },
    segments: [],
    quality: {
      status: "scored",
      attempts: 1,
      promptRevision: 1,
      promptContentSha256: "a".repeat(64),
      initialModel: "qwen3.7-plus",
      reviewModel: "qwen3.7-flash",
      modelRuns: [],
      finalScore: 76,
      rawTotalScore: 76,
      settlementRatio: 1,
      invalidDurationMs: 12_000,
      billableDurationMs: 140_000,
      summary: "画面完整，存在短暂遮挡。",
      recommendations: ["继续保持第一视角稳定"],
      deductions: [],
      reviewRequired: false,
      reviewReasons: [],
      reviewRevision: 0,
      manualIssues: [{ label: "短暂遮挡", start: 48, end: 53 }],
      detectedTask: {
        scene_id: "家庭厨房",
        task_id: "breakfast",
        variant_id: "鸡蛋、平底锅",
        task_summary: "制作早餐",
        confidence: 0.98,
      },
      invalidSegments: [],
    },
    ...overrides,
  };
}

function annotationTask(
  taskLabel: string,
  startMs: number,
  endMs: number,
): BackendVideoAnnotationTask {
  return {
    start_ms: startMs,
    end_ms: endMs,
    task_label: taskLabel,
    task_verb: "整理",
    task_object: "物品",
    evidence_level: "direct_visual",
    evidence_timestamps_ms: [startMs, endMs],
    manipulated_objects: ["物品"],
    tools: [],
    hand_mode: "both_hands",
    interaction_primitives: ["grasp", "place"],
    completion: "complete",
    result_status: "success",
    confidence: 0.96,
    effective_completion: "complete",
    effective_result_status: "success",
    effective_failure_recovery: "",
    policy_reasons: [],
  };
}

function formalAnnotationRun(
  overrides: Partial<BackendAnnotationRun> = {},
): BackendAnnotationRun {
  const task = annotationTask("整理餐具", 5_100, 11_900);
  return {
    id: "ANR-FORMAL-001",
    submissionId: "SUB-001",
    trigger: "initial",
    pipelineVersion: "pipeline-v1",
    schemaVersion: "schema-v1",
    evidencePolicyVersion: "evidence-v1",
    promptVersion: "prompt-v1",
    promptContentSha256: "a".repeat(64),
    model: "qwen-vl-max",
    labelSetVersionId: null,
    labelSetRevision: null,
    executionStatus: "succeeded",
    reviewStatus: "not_required",
    publicationStatus: "auto_accepted",
    attemptCount: 1,
    fullModelAttempts: 1,
    schemaRepairCalls: 0,
    targetedRepairCalls: 0,
    infrastructureRetryCount: 0,
    providerCallCount: 1,
    reviewRevision: 0,
    autoEligibility: "eligible",
    autoGateVersion: "auto-gate-v1",
    autoGateIssues: [],
    wouldAutoAccept: true,
    autoAcceptEnabledSnapshot: true,
    autoGateEvaluatedAt: Date.now() - 500,
    auditStatus: "not_selected",
    auditSelectedAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextRetryAt: null,
    candidate: {
      status: "candidate",
      schemaVersion: "schema-v1",
      policyVersion: "evidence-v1",
      promptVersion: "prompt-v1",
      promptContentSha256: "a".repeat(64),
      model: "qwen-vl-max",
      requestId: "request-formal-1",
      durationMs: 200,
      frameCount: 4,
      sampling: {
        maxFrameGapMs: 4_000,
        sourceTimestampsMs: [0, 5_100, 11_900, 15_000],
      },
      labelMappings: [],
      raw: {
        video_summary: "整理物品",
        scene: { coarse_label: "室内", fine_label: "厨房", confidence: 0.95 },
        tasks: [task],
      },
      effective: {
        video_summary: "整理物品",
        scene: { coarse_label: "室内", fine_label: "厨房", confidence: 0.95 },
        tasks: [task],
      },
      validation: { errors: [], warnings: [] },
      reviewReasons: [],
    },
    humanResult: null,
    review: null,
    corrections: [],
    modelCalls: [],
    queuedAt: Date.now() - 1_000,
    startedAt: Date.now() - 900,
    completedAt: Date.now() - 500,
    createdAt: Date.now() - 1_000,
    updatedAt: Date.now() - 500,
    ...overrides,
  };
}

function readyTaskSegmentAsset(): BackendTaskSegmentAsset {
  return {
    id: "TSA-FORMAL-001",
    submissionId: "SUB-001",
    annotationRunId: "ANR-FORMAL-001",
    taskIndex: 0,
    pipelineVersion: "pipeline-v1",
    promptVersion: "prompt-v1",
    schemaVersion: "schema-v1",
    evidencePolicyVersion: "evidence-v1",
    ontologyVersion: null,
    taskLabel: "整理餐具",
    taskVerb: "整理",
    completion: "complete",
    resultStatus: "success",
    sourceStartMs: 5_100,
    sourceEndMs: 11_900,
    coarseStartMs: 5_100,
    coarseEndMs: 11_900,
    refinedStartMs: null,
    refinedEndMs: null,
    actualClipStartMs: 5_100,
    actualClipEndMs: 11_900,
    requestedStartMs: 5_100,
    requestedEndMs: 11_900,
    boundarySource: "coarse",
    boundaryRefinementId: null,
    boundaryRefinementStatus: null,
    boundaryRefinementPolicyVersion: null,
    materializationPolicyVersion: "task_segment_adaptive_cut_policy_v1",
    materializationMode: "stream_copy",
    predictedCopyStartMs: 5_100,
    keyframeDistanceStartMs: 0,
    boundaryToleranceMs: 67,
    startDriftMs: 0,
    endDriftMs: 0,
    validationStatus: "passed",
    validationFailureCode: null,
    validationFailureMessage: null,
    streamCopyAttempted: true,
    copyRejectedReason: null,
    materializationDurationMs: 10,
    clipStartMs: 5_100,
    clipEndMs: 11_900,
    coverageSnapshot: [],
    evidenceSnapshot: {},
    validationWarnings: [],
    sourceObjectKey: "uploads/SUB-001/source.mp4",
    sourceSha256: "a".repeat(64),
    clipObjectKey: "task-segments/demo/SUB-001/ANR-FORMAL-001/task-0.mp4",
    clipSha256: "b".repeat(64),
    clipSizeBytes: "1048576",
    clipDurationMs: 6_800,
    codec: "h264",
    width: 1280,
    height: 720,
    frameRate: 30,
    hasAudio: true,
    generationStatus: "ready",
    attemptCount: 1,
    failureCode: null,
    failureMessage: null,
    usageStatus: "internal_only",
    generationPolicyVersion: "task_segment_demo_policy_v1",
    createdAt: 1,
    startedAt: 2,
    completedAt: 3,
    updatedAt: 3,
  };
}

beforeEach(() => {
  vi.mocked(uploadVideo).mockReset();
  vi.mocked(resumeUploadVideo).mockReset();
  vi.mocked(loadAllSubmissions).mockReset();
  vi.mocked(loadAllSubmissions).mockResolvedValue([backendSubmission()]);
  vi.mocked(searchSubmissions).mockReset();
  vi.mocked(searchSubmissions).mockResolvedValue({
    submissions: [backendSubmission()],
    pagination: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
    },
  });
  vi.mocked(getSubmission).mockReset();
  vi.mocked(getSubmission).mockResolvedValue(backendSubmission());
  vi.mocked(listActiveUploads).mockReset();
  vi.mocked(listActiveUploads).mockResolvedValue([]);
  vi.mocked(listAnnotationRuns).mockReset();
  vi.mocked(listAnnotationRuns).mockResolvedValue([]);
  taskSegmentApi.generateTaskSegments.mockReset();
  taskSegmentApi.getTaskSegmentAssets.mockReset();
  taskSegmentApi.getTaskSegmentAssets.mockResolvedValue({
    assets: [],
    pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
  });
  taskSegmentApi.getTaskSegmentPreview.mockReset();
  taskSegmentApi.retryTaskSegment.mockReset();
  vi.mocked(getSubmissionPreview).mockReset();
  vi.mocked(getSubmissionPreview).mockResolvedValue({
    url: "http://minio.local/preview.mp4",
    expiresAt: Date.now() + 600_000,
    contentType: "video/mp4",
    fileName: "kitchen_breakfast_0803.mov",
    source: "web_preview",    hls: {
      url: "/api/v1/submissions/SUB-001/preview/hls/master.m3u8",
      contentType: "application/vnd.apple.mpegurl",
      qualities: [{ quality: "720p", width: 1280, height: 720 }],
    },
    thumbnail: {
      url: "http://minio.local/thumbnail.jpg",
      expiresAt: Date.now() + 600_000,
      contentType: "image/jpeg",
    },
    evidenceFrames: [
      {
        segmentId: "SEG-001",
        type: "freeze",
        startSeconds: 48,
        endSeconds: 53,
        url: "http://minio.local/evidence-occlusion.jpg",
        expiresAt: Date.now() + 600_000,
        contentType: "image/jpeg",
      },
    ],
  });
  vi.mocked(getPointRule).mockReset();
  vi.mocked(getPointRule).mockResolvedValue({
    id: "PRV-COLLECTOR",
    revision: 2,
    version: "POINTS-COLLECTOR",
    defaultPointsPerMinute: 12,
    coefficientBands: [
      { minScore: 0, maxScore: 100, ratio: 0.5, label: "统一半系数" },
    ],
    description: "详情页测试规则",
    active: true,
    createdByAccountId: "U-ADMIN-01",
    createdByName: "管理员",
    createdAt: 1,
  });
  taskApi.listTasksForCollector.mockReset();
  taskApi.listTasksForCollector.mockResolvedValue([publishedTask]);
  vi.mocked(uploadVideo).mockImplementation(async (file, options) => {
    options?.onProgress?.(100);
    return {
      id: `SUB-${file.name}`,
      fileName: file.name,
      ownerId: "U-COL-01",
      ownerName: "测试人员1",
      teamId: "TEAM-01",
      teamName: "星火一队",
      sizeBytes: String(file.size),
      uploadStatus: "uploaded",
      processingStatus: "queued",
      isTestData: false,
      createdAt: Date.now(),
      segments: [],
    };
  });
  vi.mocked(resumeUploadVideo).mockImplementation(async (file, _session, options) => {
    options?.onProgress?.(100);
    return {
      id: `SUB-RESUMED-${file.name}`,
      fileName: file.name,
      ownerId: "U-COL-01",
      ownerName: "测试人员1",
      teamId: "TEAM-01",
      teamName: "星火一队",
      sizeBytes: String(file.size),
      uploadStatus: "uploaded",
      processingStatus: "queued",
      isTestData: false,
      createdAt: Date.now(),
      segments: [],
    };
  });
});

describe("collector dashboard", () => {
  it("keeps submission data available when the point rule fails", async () => {
    vi.mocked(getPointRule).mockRejectedValue(new Error("规则接口不可用"));

    renderCollector("/collector");

    expect(await screen.findByText("已连接后端数据")).toBeVisible();
    expect(screen.getByText("kitchen_breakfast_0803.mov")).toBeVisible();
    expect(screen.getByText("规则不可用")).toBeVisible();
  });

  it("uses the pending-review status on the dashboard and submission table", async () => {
    const original = backendSubmission();
    const pendingReview = backendSubmission({
      quality: {
        ...original.quality!,
        status: "review_pending",
        reviewRequired: true,
        reviewReasons: ["需要人工关注"],
      },
    });
    vi.mocked(loadAllSubmissions).mockResolvedValue([pendingReview]);
    vi.mocked(searchSubmissions).mockResolvedValue({
      submissions: [pendingReview],
      pagination: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      },
    });

    const dashboard = renderCollector("/collector");
    expect(await screen.findByText("等待人工复核")).toBeVisible();
    dashboard.unmount();

    renderCollector("/collector/quality");
    expect(await screen.findByText("等待人工复核")).toBeVisible();
  });

  it("renders submission metrics as unknown when submission data fails", async () => {
    vi.mocked(loadAllSubmissions).mockRejectedValue(
      new Error("提交接口不可用"),
    );

    renderCollector("/collector");

    expect((await screen.findAllByText("数据暂不可用")).length).toBeGreaterThan(0);
    for (const label of ["本月上传", "有效时长", "质量通过率"]) {
      expect(screen.getByText(label).closest("article")).toHaveTextContent("—");
    }
    expect(screen.queryByText("0 条")).not.toBeInTheDocument();
  });
});

function renderCollector(path: string) {
  window.history.replaceState({}, "", path);
  const collector = accountForRole("collector");
  return render(
    <IdentityProvider currentAccount={collector} accounts={demoAccounts} teams={[]}>
      <PlatformApp initialPath={path} />
    </IdentityProvider>,
  );
}

function renderAdminDetail(unitPricePerMinute: number) {
  const path = "/admin/submissions/SUB-001";
  window.history.replaceState({}, "", path);
  const admin = accountForRole("admin");
  const teams = [
    {
      id: "TEAM-01",
      name: "星火一队",
      status: "active" as const,
      unitPricePerMinute,
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  return render(
    <IdentityProvider
      currentAccount={admin}
      accounts={demoAccounts}
      teams={teams}
    >
      <PlatformApp initialPath={path} />
    </IdentityProvider>,
  );
}

async function confirmUploadAuthorization(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText("我确认拥有本次上传视频的数据使用授权"));
  await user.click(
    screen.getByLabelText("我已按隐私规范检查人脸、门牌、屏幕账号、定位等信息"),
  );
  await user.click(
    screen.getByLabelText("我确认发现敏感内容时已遮挡、重采或按要求处理"),
  );
}

async function selectUploadTask(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByLabelText(/任务（场景）/),
    "TASK-1",
  );
  await user.click(
    screen.getByLabelText(
      "我已阅读并理解该任务的采集要求，本次视频符合任务要求",
    ),
  );
}

async function confirmAllUploadRequirements(
  user: ReturnType<typeof userEvent.setup>,
) {
  await selectUploadTask(user);
  await confirmUploadAuthorization(user);
}

describe("collector journey", () => {
  it("distinguishes a task-service failure from an empty task list and retries", async () => {
    const user = userEvent.setup();
    taskApi.listTasksForCollector
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([publishedTask]);

    renderCollector("/collector/upload");

    expect(await screen.findByText("任务服务暂不可用")).toBeVisible();
    expect(
      screen.queryByText("当前没有可提交的采集任务，请稍后再试。"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByLabelText(/任务（场景）/)).toBeVisible();
    expect(taskApi.listTasksForCollector).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported upload formats without creating a submission", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderCollector("/collector/upload");

    await user.upload(
      screen.getByLabelText("选择视频文件"),
      new File(["text"], "notes.txt", { type: "text/plain" }),
    );

    expect(screen.getByText("仅支持 MOV 和 MP4 视频")).toBeVisible();
    expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
  });

  it("rejects videos above the 2 GiB upload limit with an actionable message", async () => {
    const user = userEvent.setup();
    renderCollector("/collector/upload");
    const oversized = new File(["video"], "oversized.mp4", {
      type: "video/mp4",
    });
    Object.defineProperty(oversized, "size", { value: 2 * 1024 ** 3 + 1 });

      await confirmAllUploadRequirements(user);
      await user.upload(screen.getByLabelText("选择视频文件"), oversized);
      expect(screen.getByText("单个视频不能超过 2 GiB")).toBeVisible();
      expect(screen.queryByText("oversized.mp4")).not.toBeInTheDocument();
    expect(uploadVideo).not.toHaveBeenCalled();
  });

  it("uploads each supported file through the real multipart boundary", async () => {
    const user = userEvent.setup();
    renderCollector("/collector/upload");

    await confirmAllUploadRequirements(user);
    await user.upload(screen.getByLabelText("选择视频文件"), [
      new File(["a"], "kitchen.mov", { type: "video/quicktime" }),
      new File(["b"], "cleaning.mp4", { type: "video/mp4" }),
    ]);

    expect(screen.getByText("kitchen.mov")).toBeVisible();
    expect(screen.getByText("cleaning.mp4")).toBeVisible();
    await waitFor(() => expect(uploadVideo).toHaveBeenCalledTimes(2));
    expect(uploadVideo).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        authorization: {
          dataUsageAuthorized: true,
          privacyConfirmed: true,
          sensitiveContentConfirmed: true,
        },
        task: {
          id: "TASK-1",
          requirementsConfirmed: true,
        },
      }),
    );
    expect(
      await screen.findAllByText("上传完成，等待媒体处理"),
    ).toHaveLength(2);
  });

  it("blocks upload until data authorization is confirmed", async () => {
    const user = userEvent.setup();
    renderCollector("/collector/upload");

    expect(
      screen.getByRole("button", { name: /请先完成上方三项授权确认/ }),
    ).toBeDisabled();

    // 未选择任务时给出明确提示
    await user.upload(
      screen.getByLabelText("选择视频文件"),
      new File(["a"], "kitchen.mp4", { type: "video/mp4" }),
    );
    expect(screen.getByText("请先选择采集任务")).toBeVisible();
    expect(uploadVideo).not.toHaveBeenCalled();

    // 已选任务但未确认授权时仍阻断
    await selectUploadTask(user);
    await user.upload(
      screen.getByLabelText("选择视频文件"),
      new File(["a"], "kitchen.mp4", { type: "video/mp4" }),
    );
    expect(
      screen.getByText("上传前请先确认数据授权、隐私规范和敏感内容处理要求"),
    ).toBeVisible();
    expect(uploadVideo).not.toHaveBeenCalled();
  });

  it("shows resumable uploads and continues after selecting the original file", async () => {
    const user = userEvent.setup();
    vi.mocked(listActiveUploads).mockResolvedValue([
      {
        submission: {
          id: "SUB-ACTIVE-01",
          fileName: "unfinished.mp4",
          ownerId: "U-COL-01",
          ownerName: "测试人员1",
          teamId: "TEAM-01",
          teamName: "星火一队",
          sizeBytes: "10",
          uploadStatus: "uploading",
          processingStatus: "uploading",
          isTestData: false,
          createdAt: Date.now(),
          segments: [],
        },
        upload: {
          uploadId: "UPLOAD-ACTIVE-01",
          partSizeBytes: 5,
          partCount: 2,
          expiresInSeconds: 900,
        },
      },
    ]);
    renderCollector("/collector/upload");

    expect(await screen.findByText("可恢复上传")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "继续上传" }));
    await user.upload(
      screen.getByLabelText("选择恢复上传文件"),
      new File(["abcdefghij"], "unfinished.mp4", { type: "video/mp4" }),
    );

    await waitFor(() => expect(resumeUploadVideo).toHaveBeenCalledTimes(1));
    expect(
      await screen.findAllByText("上传完成，等待媒体处理"),
    ).toHaveLength(1);
  });

  it("pauses an in-page upload and continues from the active session", async () => {
    const user = userEvent.setup();
    vi.mocked(uploadVideo).mockImplementation(async (_file, options) => {
      options?.onProgress?.(42);
      return await new Promise<Awaited<ReturnType<typeof uploadVideo>>>(
        (_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Paused", "AbortError"));
        });
        },
      );
    });
    vi.mocked(listActiveUploads)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          submission: {
            id: "SUB-PAUSED",
            fileName: "pause-test.mp4",
            ownerId: "U-COL-01",
            ownerName: "测试人员1",
            teamId: "TEAM-01",
            teamName: "星火一队",
            sizeBytes: "10",
            uploadStatus: "uploading",
            processingStatus: "uploading",
            isTestData: false,
            createdAt: Date.now(),
            segments: [],
          },
          upload: {
            uploadId: "UPLOAD-PAUSED",
            partSizeBytes: 5,
            partCount: 2,
            expiresInSeconds: 900,
          },
        },
    ]);
    renderCollector("/collector/upload");

    await confirmAllUploadRequirements(user);
    await user.upload(
      screen.getByLabelText("选择视频文件"),
      new File(["abcdefghij"], "pause-test.mp4", { type: "video/mp4" }),
    );
    await screen.findByText("正在上传 42%");
    await user.click(screen.getByRole("button", { name: "暂停" }));

    expect(await screen.findByText("已暂停，可继续上传")).toBeVisible();
    vi.mocked(resumeUploadVideo).mockResolvedValue({
      id: "SUB-PAUSED",
      fileName: "pause-test.mp4",
      ownerId: "U-COL-01",
      ownerName: "测试人员1",
      teamId: "TEAM-01",
      teamName: "星火一队",
      sizeBytes: "10",
      uploadStatus: "uploaded",
      processingStatus: "queued",
      isTestData: false,
      createdAt: Date.now(),
      segments: [],
    });
    await user.click(screen.getByRole("button", { name: "继续" }));

    await waitFor(() => expect(resumeUploadVideo).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("上传完成，等待媒体处理")).toBeVisible();
  });

  it("loads the current collector's submissions from the backend", async () => {
    renderCollector("/collector/submissions");

    expect(await screen.findByText("kitchen_breakfast_0803.mov")).toBeVisible();
    expect(screen.getByText("后端筛选 1-1 / 1 条数据")).toBeVisible();
    expect(searchSubmissions).toHaveBeenCalledWith({
      q: "",
      status: "all",
      page: 1,
      pageSize: 20,
      includeThumbnails: true,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(screen.queryByText("warehouse_packing_0803.mp4")).not.toBeInTheDocument();
  });

  it("filters by submission time and sorts by score on the data page", async () => {
    const user = userEvent.setup();
    renderCollector("/collector/submissions");

    expect(await screen.findByText("kitchen_breakfast_0803.mov")).toBeVisible();
    // 提交时间作为独立列展示
    expect(screen.getByRole("columnheader", { name: "提交时间" })).toBeVisible();

    // 切到「近 7 天」→ 携带 dateFrom/dateTo
    await user.selectOptions(screen.getByLabelText("提交时间筛选"), "7d");
    await waitFor(() => {
      expect(searchSubmissions).toHaveBeenCalledWith(
        expect.objectContaining({
          dateFrom: expect.any(String),
          dateTo: expect.any(String),
        }),
      );
    });

    // 切到「质量评分 · 降序」→ sortBy=finalScore / sortOrder=desc
    await user.selectOptions(screen.getByLabelText("排序方式"), "finalScore-desc");
    await waitFor(() => {
      expect(searchSubmissions).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: "finalScore", sortOrder: "desc" }),
      );
    });
  });

  it("shows and filters by the submission task source", async () => {
    const user = userEvent.setup();
    vi.mocked(searchSubmissions).mockResolvedValue({
      submissions: [
        backendSubmission({
          task: {
            taskId: "TASK-1",
            title: "厨房数据采集",
            revision: 1,
            sceneName: "家庭厨房",
            taskType: "custom",
            pricePointsPerMinute: 15.5,
          },
        }),
      ],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      taskSources: [
        { taskId: "TASK-1", title: "厨房数据采集", sceneName: "家庭厨房" },
      ],
    });
    renderCollector("/collector/submissions");

    expect(await screen.findByRole("columnheader", { name: "任务来源" })).toBeVisible();
    expect(screen.getAllByText("厨房数据采集").length).toBeGreaterThan(0);
    await user.selectOptions(
      screen.getByLabelText("任务来源筛选"),
      "TASK-1",
    );

    await waitFor(() => {
      expect(searchSubmissions).toHaveBeenLastCalledWith(
        expect.objectContaining({ taskId: "TASK-1" }),
      );
    });
  });

  it("loads reviewed submissions on the quality result page", async () => {
    renderCollector("/collector/quality");

    expect(await screen.findByRole("heading", { name: "质检结果" })).toBeVisible();
    expect(searchSubmissions).toHaveBeenCalledWith({
      q: "",
      status: "quality_results",
      page: 1,
      pageSize: 20,
      includeThumbnails: true,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });

  it("loads a short-lived video preview on the submission detail page", async () => {
    const user = userEvent.setup();
    renderCollector("/collector/submissions/SUB-001");

    const player = await screen.findByLabelText(
      "kitchen_breakfast_0803.mov 预览",
    );
    expect(player).toHaveAttribute("poster", "http://minio.local/thumbnail.jpg");
    expect(player.querySelectorAll("source")[0]).toHaveAttribute(
      "src",
      "/api/v1/submissions/SUB-001/preview/hls/master.m3u8",
    );
    expect(player.querySelectorAll("source")[1]).toHaveAttribute(
      "src",
      "http://minio.local/preview.mp4",
    );
    expect(screen.getByText("720p")).toBeVisible();
    await user.click(
      await screen.findByRole("button", { name: /评分依据与扣分明细/ }),
    );
    expect(await screen.findByAltText("短暂遮挡 证据帧")).toHaveAttribute(
      "src",
      "http://minio.local/evidence-occlusion.jpg",
    );
    expect(getSubmission).toHaveBeenCalledWith("SUB-001");
    expect(getSubmissionPreview).toHaveBeenCalledWith("SUB-001");
    expect(await screen.findByText("14.00 分")).toBeVisible();
    expect(getPointRule).toHaveBeenCalledTimes(1);
    expect(listAnnotationRuns).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "任务时间轴" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "视频介绍" })).not.toBeInTheDocument();
  });

  it("shows zero estimated points when the result is below its locked threshold", async () => {
    const original = backendSubmission();
    vi.mocked(getSubmission).mockResolvedValue(
      backendSubmission({
        quality: {
          ...original.quality!,
          finalScore: 65,
          rawTotalScore: 65,
          passThreshold: 70,
          passed: false,
          settlementRatio: 0,
        },
      }),
    );

    renderCollector("/collector/submissions/SUB-001");

    expect(await screen.findByText("0.00 分")).toBeVisible();
  });

  it("does not show a fallback estimate when the point rule is unavailable", async () => {
    vi.mocked(getPointRule).mockRejectedValue(new Error("规则接口不可用"));

    renderCollector("/collector/submissions/SUB-001");

    expect(await screen.findByText("规则不可用")).toBeVisible();
  });

  it("uses the submission team's unit price when an administrator views details", async () => {
    renderAdminDetail(24);

    expect(await screen.findByText("28.00 分")).toBeVisible();
  });

  it("shows readable Chinese review reasons without changing the original quality result", async () => {
    const user = userEvent.setup();
    const original = backendSubmission();
    const reviewReasons = [
      "场景标签字典缺失'桌面/书桌'类别，需人工确认是否映射至'办公室/工位'。",
      "D1维度因垂直俯拍角度扣分较多，需确认是否符合采集规范。",
      "D3（frame_and_video_quality）/RESOLUTION_LOW 扣分缺少证据时间点",
      "D4（task_authenticity_completeness）/TASK_SCENE_UNDEFINED 扣分缺少证据时间点",
      "疑似硬性否决候选：[object Object]、NON_FIRST_PERSON",
      "服务端规则校验未通过",
      "任务符合度：1 条硬性要求未满足（第一视角拍摄）",
    ];
    const submission = backendSubmission({
      quality: {
        ...original.quality!,
        status: "review_pending",
        reviewRequired: true,
        reviewReasons,
      },
    });
    const originalSnapshot = JSON.stringify(submission);
    vi.mocked(getSubmission).mockResolvedValue(submission);

    renderAdminDetail(24);

    const notice = await screen.findByRole("region", { name: "人工复核原因" });
    expect(notice.closest(".submission-detail-page")).not.toBeNull();
    expect(notice.querySelector("details")).not.toHaveAttribute("open");
    expect(within(notice).getByText("共 7 项待核实，展开查看完整原因")).toBeVisible();
    expect(within(notice).getByText(reviewReasons[0])).not.toBeVisible();
    await user.click(within(notice).getByText("该视频需要人工复核"));
    expect(notice.querySelector("details")).toHaveAttribute("open");
    expect(within(notice).getAllByRole("listitem")).toHaveLength(reviewReasons.length);
    expect(notice).toHaveTextContent(reviewReasons[0]);
    expect(notice).toHaveTextContent("第一人称与构图因垂直俯拍角度扣分较多");
    expect(notice).toHaveTextContent("视频与帧质量/分辨率偏低 扣分缺少证据时间点");
    expect(notice).toHaveTextContent("任务符合度与真实性/任务场景尚未明确 扣分缺少证据时间点");
    expect(notice).toHaveTextContent("疑似触及质量否决条件：原因详情缺失，需人工核实、非第一人称占比过高");
    expect(notice).toHaveTextContent("质检结果存在规则冲突或信息缺失，需要人工核实");
    expect(notice).toHaveTextContent(reviewReasons[6]);
    expect(screen.getAllByText("等待人工复核").length).toBeGreaterThan(0);
    expect(screen.getByText("76")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /评分依据与扣分明细/ }));

    expect(screen.getAllByText("视频与帧质量/分辨率偏低 扣分缺少证据时间点")).toHaveLength(2);
    expect(document.body).not.toHaveTextContent(/RESOLUTION_LOW|TASK_SCENE_UNDEFINED|NON_FIRST_PERSON|frame_and_video_quality|task_authenticity_completeness|\[object Object\]|D[1-5]维度/);
    await user.click(within(notice).getByText("该视频需要人工复核"));
    expect(within(notice).getByText(reviewReasons[0])).not.toBeVisible();
    expect(JSON.stringify(submission)).toBe(originalSnapshot);
  });

  it("keeps the reason and need for review visible for an unfamiliar technical code", async () => {
    const original = backendSubmission();
    vi.mocked(getSubmission).mockResolvedValue(backendSubmission({
      quality: {
        ...original.quality!,
        status: "review_pending",
        reviewRequired: true,
        reviewReasons: ["D2（hand_forearm_object_integrity）/NEW_QUALITY_CODE 的证据超出视频时间轴"],
      },
    }));

    renderAdminDetail(24);

    const notice = await screen.findByRole("region", { name: "人工复核原因" });
    expect(notice).toHaveTextContent("手部、前臂与对象/未识别的质检项（需人工核实） 的证据超出视频时间轴");
    expect(notice).not.toHaveTextContent("NEW_QUALITY_CODE");
  });

  it("shows timestamped tasks and their generated clips for administrators", async () => {
    vi.mocked(listAnnotationRuns).mockResolvedValue([formalAnnotationRun()]);
    taskSegmentApi.getTaskSegmentAssets.mockResolvedValue({
      assets: [readyTaskSegmentAsset()],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    });

    renderAdminDetail(24);

    expect(await screen.findByRole("region", { name: "任务时间轴" })).toBeVisible();
    expect(await screen.findByText("5.1s～11.9s")).toBeVisible();
    expect(screen.getByText("“整理餐具”")).toBeVisible();
    expect(screen.getByRole("region", { name: "视频介绍" })).toHaveTextContent("整理物品");
    const videoColumn = screen.getByRole("region", { name: "视频介绍" }).closest(".submission-video-column");
    expect(videoColumn).not.toBeNull();
    expect(videoColumn?.querySelector("video")).not.toBeNull();
    const segmentRegion = await screen.findByRole("region", { name: "任务切片" });
    expect(segmentRegion).toBeVisible();
    expect(await screen.findByText("5.1s～11.9s 整理餐具")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "任务时间轴" })).getByText("任务 1")).toBeVisible();
    expect(within(segmentRegion).getByText("任务 1")).toBeVisible();
    // 结构化字段：标签与值分开展示
    expect(screen.getByText("对象")).toBeVisible();
    expect(screen.getByText("物品")).toBeVisible();
    expect(screen.getByText("动作")).toBeVisible();
    expect(screen.getByText("抓取、放置")).toBeVisible();
    expect(screen.getByText("完成状态")).toBeVisible();
    expect(screen.getByText("已完成")).toBeVisible();
    expect(segmentRegion).toHaveTextContent("切片就绪");
    expect(segmentRegion).not.toHaveTextContent("Run：");
    expect(segmentRegion).not.toHaveTextContent("Submission：");
    expect(segmentRegion).not.toHaveTextContent("MinIO Key：");
    expect(segmentRegion).not.toHaveTextContent("SHA-256：");
    expect(listAnnotationRuns).toHaveBeenCalledWith("SUB-001");
    expect(taskSegmentApi.getTaskSegmentAssets).toHaveBeenCalledWith({
      annotationRunId: "ANR-FORMAL-001",
      page: 1,
      pageSize: 50,
    });
  });

  it("prefers human-corrected tasks and video summary over the candidate", async () => {
    vi.mocked(listAnnotationRuns).mockResolvedValue([
      formalAnnotationRun({
        reviewStatus: "accepted_corrected",
        publicationStatus: "human_verified",
        humanResult: {
          effective: {
            video_summary: "人工修正后的视频介绍",
            tasks: [
              {
                start_ms: 6_250,
                end_ms: 12_750,
                task_label: "人工修正后的任务",
              },
            ],
          },
        },
      }),
    ]);

    renderAdminDetail(24);

    expect(await screen.findByText("6.3s～12.8s")).toBeVisible();
    expect(screen.getByText("“人工修正后的任务”")).toBeVisible();
    expect(screen.queryByText("“整理餐具”")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "视频介绍" })).toHaveTextContent("人工修正后的视频介绍");
    expect(screen.queryByText("整理物品")).not.toBeInTheDocument();
  });

  it.each([undefined, "", "   ", null])("omits a missing or empty formal video summary (%s)", async (videoSummary) => {
    vi.mocked(listAnnotationRuns).mockResolvedValue([
      formalAnnotationRun({
        reviewStatus: "accepted_corrected",
        publicationStatus: "human_verified",
        humanResult: {
          effective: {
            video_summary: videoSummary,
            tasks: [annotationTask("整理餐具", 5_100, 11_900)],
          },
        },
      }),
    ]);

    renderAdminDetail(24);

    expect(await screen.findByText("5.1s～11.9s")).toBeVisible();
    expect(screen.queryByRole("region", { name: "视频介绍" })).not.toBeInTheDocument();
    expect(screen.queryByText("整理物品")).not.toBeInTheDocument();
  });

  it("does not present candidate, rejected, or superseded runs as formal tasks", async () => {
    vi.mocked(listAnnotationRuns).mockResolvedValue([
      formalAnnotationRun({ publicationStatus: "candidate_only" }),
      formalAnnotationRun({ id: "ANR-REJECTED", publicationStatus: "rejected" }),
      formalAnnotationRun({ id: "ANR-SUPERSEDED", publicationStatus: "superseded" }),
    ]);

    renderAdminDetail(24);

    expect(
      await screen.findByText("Annotation 已生成候选结果，等待管理员审核并正式发布。"),
    ).toBeVisible();
    expect(screen.queryByText("“整理餐具”")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "视频介绍" })).not.toBeInTheDocument();
    expect(screen.queryByText("整理物品")).not.toBeInTheDocument();
  });

  it("shows the annotation failure instead of an empty-task message", async () => {
    vi.mocked(listAnnotationRuns).mockResolvedValue([
      formalAnnotationRun({
        executionStatus: "system_failed",
        publicationStatus: "candidate_only",
        lastErrorMessage: "模型结果未通过结构校验",
      }),
    ]);

    renderAdminDetail(24);

    expect(
      await screen.findByText("Annotation 处理失败：模型结果未通过结构校验"),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "查看失败详情" })).toHaveAttribute(
      "href",
      "/admin/ai/annotation-runs/ANR-FORMAL-001/review",
    );
    expect(screen.queryByText("暂无正式任务描述")).not.toBeInTheDocument();
  });

  it("polls a running annotation until formal tasks become available", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(listAnnotationRuns)
        .mockResolvedValueOnce([
          formalAnnotationRun({
            executionStatus: "running",
            publicationStatus: "candidate_only",
          }),
        ])
        .mockResolvedValueOnce([formalAnnotationRun()]);

      renderAdminDetail(24);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        screen.getByText("Annotation 正在处理，完成后任务时间轴会自动更新。"),
      ).toBeVisible();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(screen.getByText("5.1s～11.9s")).toBeVisible();
      expect(listAnnotationRuns).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the rest of the detail page usable when formal tasks cannot load", async () => {
    vi.mocked(listAnnotationRuns).mockRejectedValue(new Error("annotation unavailable"));

    renderAdminDetail(24);

    expect(
      await screen.findByText("任务描述暂时无法读取，视频详情的其他内容不受影响。"),
    ).toBeVisible();
    expect(
      await screen.findByLabelText("kitchen_breakfast_0803.mov 预览"),
    ).toBeVisible();
    expect(await screen.findByText("28.00 分")).toBeVisible();
  });
});
