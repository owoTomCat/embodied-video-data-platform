import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { getPointRule } from "../../points/client/pointCycleApi";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import {
  getSubmission,
  getSubmissionPreview,
  listActiveUploads,
  searchSubmissions,
} from "../../submissions/client/submissionApi";
import type { BackendSubmission } from "../../submissions/contracts";
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

beforeEach(() => {
  vi.mocked(uploadVideo).mockReset();
  vi.mocked(resumeUploadVideo).mockReset();
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
    });
    expect(screen.queryByText("warehouse_packing_0803.mp4")).not.toBeInTheDocument();
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
      status: "reviewed",
      page: 1,
      pageSize: 20,
      includeThumbnails: true,
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
});
