import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InteractionProvider } from "../../interactions/InteractionContext";
import {
  getQueueSnapshot,
  reclaimWorkerTimeouts,
} from "../../operations/client/operationsApi";
import { rerunAiQuality, loadAllSubmissions } from "../../submissions/client/submissionApi";
import { AiQueuePage } from "./AiQueuePage";

vi.mock("../../operations/client/operationsApi", () => ({
  getQueueSnapshot: vi.fn(),
  reclaimWorkerTimeouts: vi.fn(),
}));

vi.mock("../../submissions/client/submissionApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../submissions/client/submissionApi")>();
  return {
    ...actual,
    rerunAiQuality: vi.fn(),
    loadAllSubmissions: vi.fn(),
  };
});

const getQueueSnapshotMock = vi.mocked(getQueueSnapshot);
const reclaimWorkerTimeoutsMock = vi.mocked(reclaimWorkerTimeouts);
const rerunAiQualityMock = vi.mocked(rerunAiQuality);
const loadAllSubmissionsMock = vi.mocked(loadAllSubmissions);

function renderQueuePage() {
  return render(
    <InteractionProvider>
      <AiQueuePage />
    </InteractionProvider>,
  );
}

describe("AiQueuePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadAllSubmissionsMock.mockResolvedValue([]);
    reclaimWorkerTimeoutsMock.mockResolvedValue({ reclaimed: [], stuck: [] });
    rerunAiQualityMock.mockResolvedValue({
      id: "SUB-019",
      fileName: "pantry_sorting_0803.mp4",
      ownerId: "U-COL-03",
      ownerName: "测试人员3",
      teamId: "TEAM-01",
      teamName: "星火一队",
      sizeBytes: "333447168",
      uploadStatus: "uploaded",
      processingStatus: "awaiting_ai",
      isTestData: false,
      createdAt: Date.parse("2026-08-03T02:18:00.000Z"),
      segments: [],
      quality: {
        status: "queued",
        attempts: 0,
        promptRevision: 1,
        promptContentSha256: "0".repeat(64),
        initialModel: "qwen3.7-plus",
        reviewModel: "qwen3.7-flash",
        modelRuns: [],
        finalScore: null,
        rawTotalScore: null,
        settlementRatio: null,
        invalidDurationMs: null,
        billableDurationMs: null,
        summary: "",
        recommendations: [],
        deductions: [],
        reviewRequired: false,
        reviewReasons: [],
        reviewRevision: 0,
        invalidSegments: [],
      },
    });
  });

  it("renders the persisted backend queue snapshot", async () => {
    getQueueSnapshotMock.mockResolvedValue({
      summary: {
        total: 2,
        pending: 1,
        published: 1,
        failed: 0,
        media: 1,
        ai: 1,
        averagePublishLatencyMs: 60_000,
      },
      workers: [
        {
          id: "ai_quality-test-host-42",
          kind: "ai_quality",
          hostName: "test-host",
          processId: 42,
          status: "running",
          currentSubmissionId: "SUB-OPS-02",
          currentTaskStartedAt: 1_786_204_800_000,
          currentTaskAgeMs: 70_000,
          runningTooLong: false,
          taskTimeoutMs: 600_000,
          completedTaskCount: 3,
          failedTaskCount: 1,
          averageTaskDurationMs: 30_000,
          lastTaskDurationMs: 25_000,
          maxTaskDurationMs: 40_000,
          startedAt: 1_786_204_800_000,
          lastSeenAt: 1_786_204_870_000,
          stale: false,
        },
      ],
      jobs: [
        {
          id: "JOB-OPS-01",
          aggregateType: "submission",
          aggregateId: "SUB-OPS-01",
          eventType: "media.probe.v1",
          status: "pending",
          attempts: 0,
          availableAt: 1_786_204_800_000,
          createdAt: 1_786_204_800_000,
          updatedAt: 1_786_204_800_000,
          ageMs: 30_000,
          waitMs: 0,
          queuedForMs: 30_000,
        },
        {
          id: "JOB-OPS-02",
          aggregateType: "submission",
          aggregateId: "SUB-OPS-02",
          eventType: "ai.quality.v1",
          status: "published",
          attempts: 1,
          availableAt: 1_786_204_800_000,
          publishedAt: 1_786_204_860_000,
          createdAt: 1_786_204_800_000,
          updatedAt: 1_786_204_860_000,
          ageMs: 90_000,
          waitMs: 0,
          queuedForMs: 0,
          publishLatencyMs: 60_000,
        },
      ],
    });

    renderQueuePage();

    expect(await screen.findByText("队列快照已连接后端")).toBeVisible();
    expect(screen.getByText("平均发布 1m")).toBeVisible();
    expect(screen.getByText("当前 Worker")).toBeVisible();
    expect(screen.getByText("AI 质检 Worker")).toBeVisible();
    expect(screen.getByText("运行中")).toBeVisible();
    expect(screen.getByText("1m 10s")).toBeVisible();
    expect(screen.getByText("3 完成 / 1 失败")).toBeVisible();
    expect(screen.getByText("平均 30s")).toBeVisible();
    expect(screen.getAllByText("SUB-OPS-02")[0]).toBeVisible();
    expect(screen.getByText("最近 100 条后台队列发布记录")).toBeVisible();
    expect(screen.getByText("AI 质检事件")).toBeVisible();
    const mediaRow = screen.getByText("JOB-OPS-01").closest("tr");
    expect(mediaRow).not.toBeNull();
    expect(within(mediaRow as HTMLTableRowElement).getByText("媒体分析")).toBeVisible();
    expect(within(mediaRow as HTMLTableRowElement).getByText("SUB-OPS-01")).toBeVisible();
    expect(within(mediaRow as HTMLTableRowElement).getByText("等待发布")).toBeVisible();
    const aiRow = screen.getByText("JOB-OPS-02").closest("tr");
    expect(aiRow).not.toBeNull();
    expect(within(aiRow as HTMLTableRowElement).getByText("AI 质检")).toBeVisible();
    expect(within(aiRow as HTMLTableRowElement).getByText("已发布")).toBeVisible();
  });

  it("reclaims timed out worker tasks and refreshes the live snapshot", async () => {
    const user = userEvent.setup();
    const timeoutSnapshot = {
      summary: {
        total: 1,
        pending: 0,
        published: 1,
        failed: 0,
        media: 0,
        ai: 1,
        averagePublishLatencyMs: 0,
      },
      workers: [
        {
          id: "ai_quality-test-host-42",
          kind: "ai_quality" as const,
          hostName: "test-host",
          processId: 42,
          status: "running" as const,
          currentSubmissionId: "SUB-OPS-TIMEOUT",
          currentTaskStartedAt: 1_786_204_000_000,
          currentTaskAgeMs: 900_000,
          completedTaskCount: 10,
          failedTaskCount: 2,
          averageTaskDurationMs: 45_000,
          lastTaskDurationMs: 90_000,
          maxTaskDurationMs: 180_000,
          runningTooLong: true,
          taskTimeoutMs: 600_000,
          startedAt: 1_786_204_000_000,
          lastSeenAt: 1_786_204_900_000,
          stale: false,
        },
      ],
      jobs: [],
    };
    getQueueSnapshotMock
      .mockResolvedValueOnce(timeoutSnapshot)
      .mockResolvedValueOnce({
        ...timeoutSnapshot,
        workers: [
          {
            ...timeoutSnapshot.workers[0],
            status: "idle" as const,
            currentSubmissionId: undefined,
            currentTaskStartedAt: undefined,
            currentTaskAgeMs: undefined,
            runningTooLong: false,
          },
        ],
      });
    reclaimWorkerTimeoutsMock.mockResolvedValue({
      reclaimed: [
        {
          submissionId: "SUB-OPS-TIMEOUT",
          previousStatus: "ai_processing",
          nextStatus: "awaiting_ai",
          eventType: "ai.quality.v1",
        },
      ],
      stuck: [],
    });

    renderQueuePage();

    const button = await screen.findByRole("button", {
      name: "处理卡住/超时任务",
    });
    expect(button).toBeEnabled();
    expect(screen.getByText("运行过久")).toBeVisible();
    await user.click(button);

    await waitFor(() => expect(reclaimWorkerTimeoutsMock).toHaveBeenCalledOnce());
    expect(getQueueSnapshotMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("已标记 0 个卡住任务，重新排队 1 个")).toBeVisible();
    expect(await screen.findByText("空闲")).toBeVisible();
  });

  it("shows an unavailable state when the backend queue is unavailable", async () => {
    getQueueSnapshotMock.mockRejectedValue(new Error("offline"));

    renderQueuePage();

    expect(await screen.findByText("队列暂不可用")).toBeVisible();
    expect(screen.getByText("暂无正式 AI 任务")).toBeVisible();
  });

  it("reruns failed AI quality submissions with an operator reason", async () => {
    const user = userEvent.setup();
    getQueueSnapshotMock.mockRejectedValue(new Error("offline"));
    loadAllSubmissionsMock
      .mockResolvedValueOnce([
        {
          id: "SUB-019",
          fileName: "pantry_sorting_0803.mp4",
          ownerId: "U-COL-03",
          ownerName: "测试人员3",
          teamId: "TEAM-01",
          teamName: "星火一队",
          sizeBytes: "333447168",
          uploadStatus: "uploaded",
          processingStatus: "system_failed",
          settlementStatus: "unsettled",
          isTestData: false,
          createdAt: Date.parse("2026-08-03T02:18:00.000Z"),
          segments: [],
        },
      ])
      .mockResolvedValue([]);

    renderQueuePage();

    const rerunSection = (await screen.findByRole("heading", {
      name: "异常任务重跑",
    })).closest("section");
    expect(rerunSection).not.toBeNull();
    expect(
      within(rerunSection as HTMLElement).getByText(
        "pantry_sorting_0803.mp4",
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重新执行" }));
    await user.type(
      screen.getByLabelText("重跑原因"),
      "模型服务恢复，重新排队质检",
    );
    await user.click(screen.getByRole("button", { name: "确认重跑" }));

    await waitFor(() =>
      expect(rerunAiQualityMock).toHaveBeenCalledWith("SUB-019", {
        reason: "模型服务恢复，重新排队质检",
      }),
    );
    expect(await screen.findByText("AI 质检已重新排队")).toBeVisible();
    expect(
      within(rerunSection as HTMLElement).queryByText(
        "pantry_sorting_0803.mp4",
      ),
    ).not.toBeInTheDocument();
  });
});
