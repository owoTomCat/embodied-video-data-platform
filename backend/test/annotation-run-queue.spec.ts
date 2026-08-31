import { describe, expect, it } from "vitest";

import { annotationSampleSelected } from "../src/video-annotation/annotation-run.queue.js";

describe("annotation run sampling", () => {
  it("is deterministic per submission and respects boundary rates", () => {
    expect(annotationSampleSelected("SUB-1", 0)).toBe(false);
    expect(annotationSampleSelected("SUB-1", 1)).toBe(true);
    expect(annotationSampleSelected("SUB-stable", 0.37)).toBe(
      annotationSampleSelected("SUB-stable", 0.37),
    );
  });
});
