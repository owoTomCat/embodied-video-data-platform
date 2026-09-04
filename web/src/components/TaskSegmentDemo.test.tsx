import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TaskSegmentDemo } from "./TaskSegmentDemo";

const api = vi.hoisted(() => ({
  generate: vi.fn(),
  list: vi.fn(),
  preview: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("../operations/client/operationsApi", () => ({
  generateTaskSegments: api.generate,
  getTaskSegmentAssets: api.list,
  getTaskSegmentPreview: api.preview,
  retryTaskSegment: api.retry,
}));

const baseAsset = {
  id: "TSA-READY",
  submissionId: "SUB-SEG",
  annotationRunId: "RUN-SEG",
  taskIndex: 0,
  pipelineVersion: "ego_video_annotation_pipeline_v2",
  promptVersion: "ego_video_annotation_prompt_v2",
  schemaVersion: "ego_video_annotation_v2",
  evidencePolicyVersion: "ego_annotation_evidence_policy_v3",
  ontologyVersion: null,
  taskLabel: "打开冰箱",
  taskVerb: "open",
  completion: "complete",
  resultStatus: "success",
  sourceStartMs: 1_000,
  sourceEndMs: 2_500,
  coarseStartMs: 1_000,
  coarseEndMs: 2_500,
  refinedStartMs: 1_100,
  refinedEndMs: 2_600,
  actualClipStartMs: 1_000,
  actualClipEndMs: 2_500,
  requestedStartMs: 1_000,
  requestedEndMs: 2_500,
  boundarySource: "refined" as const,
  boundaryRefinementId: "TBR-READY",
  boundaryRefinementStatus: "succeeded" as const,
  boundaryRefinementPolicyVersion: "task_boundary_refinement_policy_v1",
  materializationPolicyVersion: "task_segment_adaptive_cut_policy_v1",
  materializationMode: "stream_copy" as const,
  predictedCopyStartMs: 1_000,
  keyframeDistanceStartMs: 0,
  boundaryToleranceMs: 67,
  startDriftMs: 0,
  endDriftMs: 0,
  validationStatus: "passed" as const,
  validationFailureCode: null,
  validationFailureMessage: null,
  streamCopyAttempted: true,
  copyRejectedReason: null,
  materializationDurationMs: 10,
  clipStartMs: 1_000,
  clipEndMs: 2_500,
  coverageSnapshot: [],
  evidenceSnapshot: {},
  validationWarnings: [],
  sourceObjectKey: "uploads/source.mp4",
  sourceSha256: "a".repeat(64),
  clipObjectKey: "task-segments/demo/SUB-SEG/RUN-SEG/task-0.mp4",
  clipSha256: "b".repeat(64),
  clipSizeBytes: "1048576",
  clipDurationMs: 1_500,
  codec: "h264",
  width: 1280,
  height: 720,
  frameRate: 30,
  hasAudio: true,
  generationStatus: "ready" as const,
  attemptCount: 1,
  failureCode: null,
  failureMessage: null,
  usageStatus: "internal_only" as const,
  generationPolicyVersion: "task_segment_demo_policy_v1" as const,
  createdAt: 1,
  startedAt: 2,
  completedAt: 3,
  updatedAt: 3,
};

const failedAsset = {
  ...baseAsset,
  id: "TSA-FAILED",
  taskIndex: 1,
  taskLabel: "关闭冰箱",
  clipObjectKey: "task-segments/demo/SUB-SEG/RUN-SEG/task-1.mp4",
  clipSha256: null,
  clipSizeBytes: null,
  clipDurationMs: null,
  codec: null,
  width: null,
  height: null,
  frameRate: null,
  hasAudio: null,
  generationStatus: "failed" as const,
  failureCode: "FFMPEG_FAILED",
  failureMessage: "编码失败",
};

describe("TaskSegmentDemo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({
      assets: [baseAsset, failedAsset],
      pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
    });
    api.generate.mockResolvedValue({
      annotationRunId: "RUN-SEG",
      taskCount: 2,
      created: 0,
      existing: 2,
      skipped: 0,
    });
    api.retry.mockResolvedValue({
      asset: { ...failedAsset, generationStatus: "queued" },
    });
    api.preview.mockResolvedValue({
      assetId: "TSA-READY",
      url: "https://storage.test/task-0.mp4",
      contentType: "video/mp4",
      expiresAt: Date.now() + 60_000,
    });
  });

  it("shows traceable assets and supports generate, play, and single retry", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <TaskSegmentDemo
        annotationRunId="RUN-SEG"
        submissionId="SUB-SEG"
        canGenerate
      />,
    );

    expect(await screen.findByText(/Task #0 · 打开冰箱/u)).toBeInTheDocument();
    expect(screen.getByText(/task-segments\/demo\/SUB-SEG\/RUN-SEG\/task-0.mp4/u)).toBeInTheDocument();
    expect(screen.getByText(/FFMPEG_FAILED：编码失败/u)).toBeInTheDocument();
    expect(screen.getAllByText(/粗边界：00:01.000 → 00:02.500/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/精修边界：00:01.100 → 00:02.600/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/实际切片：00:01.000 → 00:02.500/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/来源：refined · 精修状态：succeeded/u).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "RUN-SEG" })[0]).toHaveAttribute(
      "href",
      "/admin/ai/annotation-runs/RUN-SEG/review",
    );
    expect(screen.getAllByRole("link", { name: "SUB-SEG" })[0]).toHaveAttribute(
      "href",
      "/admin/submissions/SUB-SEG",
    );

    await user.click(screen.getByRole("button", { name: /生成任务片段/u }));
    await waitFor(() => expect(api.generate).toHaveBeenCalledWith("RUN-SEG"));
    expect(await screen.findByText(/任务 2 个：新建 0，已有 2，跳过 0/u)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /播放片段/u }));
    await waitFor(() => expect(api.preview).toHaveBeenCalledWith("TSA-READY"));
    expect(container.querySelector("video source")).toHaveAttribute(
      "src",
      "https://storage.test/task-0.mp4",
    );

    await user.click(screen.getByRole("button", { name: /重新生成/u }));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith("TSA-FAILED"));
    expect(api.list).toHaveBeenCalledWith({
      annotationRunId: "RUN-SEG",
      page: 1,
      pageSize: 50,
    });
  });

  it("shows the empty state", async () => {
    api.list.mockResolvedValue({
      assets: [],
      pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
    });

    render(
      <TaskSegmentDemo
        annotationRunId="RUN-SEG"
        submissionId="SUB-SEG"
        canGenerate
      />,
    );

    expect(await screen.findByText("尚未生成任务片段。")).toBeInTheDocument();
  });

  it("shows structured annotation without technical trace fields", async () => {
    render(
      <TaskSegmentDemo
        annotationRunId="RUN-SEG"
        submissionId="SUB-SEG"
        canGenerate
        presentation="structured"
        taskAnnotations={[
          {
            taskIndex: 0,
            objects: ["冰箱门", "冰箱"],
            actions: ["grasp", "open", "release"],
            completion: "partial",
          },
        ]}
      />,
    );

    expect(await screen.findByText("1.0s～2.5s 打开冰箱")).toBeInTheDocument();
    // 结构化字段：标签与值分开展示（多卡片时标签可能出现多次）
    expect(screen.getAllByText("对象").length).toBeGreaterThan(0);
    expect(screen.getByText("冰箱门、冰箱")).toBeInTheDocument();
    expect(screen.getAllByText("动作").length).toBeGreaterThan(0);
    expect(screen.getByText("抓取、打开、松开")).toBeInTheDocument();
    expect(screen.getAllByText("完成状态").length).toBeGreaterThan(0);
    expect(screen.getByText("部分完成")).toBeInTheDocument();
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("切片就绪")).toBeInTheDocument();
    expect(screen.queryByText(/Run：/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/Submission：/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/MinIO Key：/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/SHA-256：/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/技术校验 warning/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/粗边界：/u)).not.toBeInTheDocument();
    expect(screen.queryByText(/精修边界：/u)).not.toBeInTheDocument();
  });

  it.each(["structured", "technical"] as const)("keeps %s ordering scoped and plays the matching asset", async (presentation) => {
    const user = userEvent.setup();
    const assets = [failedAsset, baseAsset];
    api.list.mockResolvedValue({
      assets,
      pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
    });
    render(<TaskSegmentDemo annotationRunId="RUN-SEG" submissionId="SUB-SEG" canGenerate presentation={presentation} />);

    const cards = await screen.findAllByRole("group", { name: /^(任务 \d|Task #\d)/ });
    if (presentation === "structured") {
      expect(cards[0]).toHaveAccessibleName("任务 1 1.0s～2.5s 打开冰箱");
      expect(cards[1]).toHaveAccessibleName("任务 2 1.0s～2.5s 关闭冰箱");
    } else {
      expect(cards[0]).toHaveAccessibleName("Task #0 · 打开冰箱");
      expect(cards[1]).toHaveAccessibleName("Task #1 · 关闭冰箱");
    }
    expect(assets.map((asset) => asset.id)).toEqual(["TSA-FAILED", "TSA-READY"]);
    await user.click(screen.getByRole("button", { name: "播放片段" }));
    expect(api.preview).toHaveBeenCalledWith("TSA-READY");
    expect(api.generate).not.toHaveBeenCalled();
    expect(api.retry).not.toHaveBeenCalled();
  });

  it.each([
    ["complete", "已完成"],
    ["completed", "已完成"],
    ["incomplete", "未完成"],
    ["partial", "部分完成"],
    ["uncertain", "不确定"],
    ["unexpected_value", "未知"],
  ])("translates completion %s without changing the asset value", async (completion, label) => {
    const asset = { ...baseAsset, completion };
    api.list.mockResolvedValue({
      assets: [asset],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
    });

    render(
      <TaskSegmentDemo
        annotationRunId="RUN-SEG"
        submissionId="SUB-SEG"
        canGenerate
        presentation="structured"
      />,
    );

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.queryByText(completion, { exact: true })).not.toBeInTheDocument();
    expect(asset.completion).toBe(completion);
  });

  it("renders queued and processing assets without exposing playback or retry", async () => {
    api.list.mockResolvedValue({
      assets: [
        {
          ...failedAsset,
          id: "TSA-QUEUED",
          generationStatus: "queued",
          failureCode: null,
          failureMessage: null,
        },
        {
          ...failedAsset,
          id: "TSA-PROCESSING",
          taskIndex: 2,
          generationStatus: "processing",
          failureCode: null,
          failureMessage: null,
        },
      ],
      pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
    });

    render(
      <TaskSegmentDemo
        annotationRunId="RUN-SEG"
        submissionId="SUB-SEG"
        canGenerate
      />,
    );

    expect(await screen.findByText("queued")).toBeInTheDocument();
    expect(screen.getByText("processing")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /播放片段/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /重新生成/u })).not.toBeInTheDocument();
  });

  it("keeps the current assets visible when refresh fails", async () => {
    const user = userEvent.setup();
    api.list
      .mockResolvedValueOnce({
        assets: [baseAsset],
        pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 },
      })
      .mockRejectedValueOnce(new Error("后端暂时不可用"));

    render(
      <TaskSegmentDemo
        annotationRunId="RUN-SEG"
        submissionId="SUB-SEG"
        canGenerate
      />,
    );

    expect(await screen.findByText(/Task #0 · 打开冰箱/u)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /刷新/u }));
    expect(await screen.findByText("后端暂时不可用")).toBeInTheDocument();
    expect(screen.getByText(/Task #0 · 打开冰箱/u)).toBeInTheDocument();
  });
});
