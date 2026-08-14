import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformApp } from "../../app/PlatformApp";
import { IdentityProvider } from "../../auth/client/IdentityContext";
import { DemoStoreProvider } from "../../data/DemoStoreContext";
import { accountForRole, demoAccounts } from "../../test/accountFixtures";
import { uploadVideo } from "../../submissions/upload/multipartUploader";

vi.mock("../../submissions/upload/multipartUploader", () => ({
  uploadVideo: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(uploadVideo).mockReset();
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
});

function renderCollector(path: string) {
  window.history.replaceState({}, "", path);
  const collector = accountForRole("collector");
  return render(
    <IdentityProvider currentAccount={collector} accounts={demoAccounts} teams={[]}>
      <DemoStoreProvider>
        <PlatformApp initialPath={path} />
      </DemoStoreProvider>
    </IdentityProvider>,
  );
}

describe("collector journey", () => {
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

  it("uploads each supported file through the real multipart boundary", async () => {
    const user = userEvent.setup();
    renderCollector("/collector/upload");

    await user.upload(screen.getByLabelText("选择视频文件"), [
      new File(["a"], "kitchen.mov", { type: "video/quicktime" }),
      new File(["b"], "cleaning.mp4", { type: "video/mp4" }),
    ]);

    expect(screen.getByText("kitchen.mov")).toBeVisible();
    expect(screen.getByText("cleaning.mp4")).toBeVisible();
    await waitFor(() => expect(uploadVideo).toHaveBeenCalledTimes(2));
    expect(
      await screen.findAllByText("上传完成，等待媒体处理"),
    ).toHaveLength(2);
  });

  it("only lists the current collector's submissions", () => {
    renderCollector("/collector/submissions");

    expect(screen.getByText("kitchen_breakfast_0803.mov")).toBeVisible();
    expect(screen.queryByText("warehouse_packing_0803.mp4")).not.toBeInTheDocument();
  });

  it("merges the legacy quality route into my data", async () => {
    renderCollector("/collector/quality");

    expect(screen.getByRole("heading", { name: "我的数据" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "质检结果" })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(window.location.pathname).toBe("/collector/submissions"),
    );
  });

  it("opens upload from a collection guide task", async () => {
    const user = userEvent.setup();
    renderCollector("/collector/guide");

    await user.click(screen.getByRole("button", { name: "上传工作台组装视频" }));

    expect(screen.getByRole("heading", { name: "上传视频" })).toBeVisible();
    expect(window.location.pathname).toBe("/collector/upload");
  });

  it("shows the current collector's latest submissions on the dashboard", () => {
    renderCollector("/collector");

    expect(screen.getByRole("heading", { name: "最近数据" })).toBeVisible();
    expect(screen.getByText("kitchen_breakfast_0803.mov")).toBeVisible();
    expect(screen.queryByText("warehouse_packing_0803.mp4")).not.toBeInTheDocument();
  });

  it("returns a newly uploaded video to dashboard recent data", async () => {
    const user = userEvent.setup();
    renderCollector("/collector/upload");

    await user.upload(
      screen.getByLabelText("选择视频文件"),
      new File(["video"], "new-work.mp4", { type: "video/mp4" }),
    );
    await screen.findByText("上传完成，等待媒体处理");
    await user.click(screen.getByRole("link", { name: "我的工作台" }));

    expect(screen.getByText("new-work.mp4")).toBeVisible();
  });
});
