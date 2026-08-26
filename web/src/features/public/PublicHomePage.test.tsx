import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPublicSiteSnapshot } from "../../public-site/client/publicSiteApi";
import { PublicHomePage } from "./PublicHomePage";

vi.mock("../../public-site/client/publicSiteApi", () => ({
  getPublicSiteSnapshot: vi.fn(),
}));

const getSnapshotMock = vi.mocked(getPublicSiteSnapshot);

describe("PublicHomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not present unknown public metrics as real zeros", async () => {
    getSnapshotMock.mockRejectedValue(new Error("offline"));
    const { container } = render(<PublicHomePage navigate={vi.fn()} />);

    expect(await screen.findByText("公开趋势暂不可用")).toBeVisible();
    const metrics = container.querySelector(".public-metrics");
    expect(metrics).not.toBeNull();
    expect(within(metrics as HTMLElement).getAllByText("—")).toHaveLength(4);
    expect(within(metrics as HTMLElement).queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText("场景数据暂不可用")).toBeVisible();
  });
});
