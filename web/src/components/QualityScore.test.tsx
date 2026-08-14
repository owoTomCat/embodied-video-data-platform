import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { QualityScore } from "./QualityScore";

describe("QualityScore", () => {
  it("shows the persisted backend settlement ratio instead of recalculating it", () => {
    render(<QualityScore score={75} settlementRatio={0.6} />);

    expect(screen.getByText("75")).toBeVisible();
    expect(screen.getByText("系数 0.60")).toBeVisible();
  });

  it("shows zero settlement for a hard-rejected result while preserving its raw score", () => {
    render(<QualityScore score={38} settlementRatio={0} />);

    expect(screen.getByText("38")).toBeVisible();
    expect(screen.getByText("系数 0.00")).toBeVisible();
  });
});
