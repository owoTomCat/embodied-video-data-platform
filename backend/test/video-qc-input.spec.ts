import { describe, expect, it } from "vitest";

import { buildVideoQcInput } from "../src/video-quality/video-qc-input.js";
import type { PreparedVideoEvidence } from "../src/video-quality/video-quality.types.js";

function evidence(): PreparedVideoEvidence {
  return {
    sha256: "a".repeat(64),
    metadata: {
      display_width: 1920,
      display_height: 1080,
      display_aspect_ratio: 16 / 9,
      duration_ms: 60_000,
      nominal_fps: 30,
      effective_fps: 30,
      codec: "h264",
      bitrate_bps: 4_000_000,
      file_size_bytes: 30_000_000,
      rotation_degrees: 0,
    },
    technicalMetrics: {
      decodable: true,
      decoded_duration_ms: 60_000,
      black_ratio: 0,
      freeze_ratio: 0,
      blur_ratio: null,
      underexposure_ratio: null,
      overexposure_ratio: null,
      timestamp_discontinuity_ratio: null,
      detector_windows: [],
    },
    fullVideoFrames: [],
    fullVideoSamplingFps: 0.2,
    missingMetrics: ["blur_ratio", "timestamp_discontinuity_ratio"],
  };
}

describe("video_qc_v2_traceable input builder", () => {
  it("uses authoritative cold-start inventory and uniqueness inputs", () => {
    const input = buildVideoQcInput({
      videoId: "LAB-video-1",
      evidence: evidence(),
      exactBatchDuplicate: true,
    });

    expect(input.inventory_context).toEqual({
      snapshot_id: "quality-lab-cold-start",
      mode: "cold_start",
      authoritative_coefficient: 1,
      c_scene: 1,
      c_standard_task: 1,
      c_variant: 1,
      current_video_excluded: true,
    });
    expect(input.similarity_context.authoritative_coefficient).toBe(1);
    expect(input.similarity_context.file_hash_exact).toBe(true);
    expect(input.similarity_context.confirmed_duplicate).toBe(true);
  });

  it("keeps absent task constraints empty and exposes missing metrics", () => {
    const input = buildVideoQcInput({
      videoId: "LAB-video-2",
      evidence: evidence(),
      exactBatchDuplicate: false,
    });

    expect(input.task_context.submitted_task_name).toBe("");
    expect(input.task_context.expected_task_id).toBe("");
    expect(input.previous_model_observations).toEqual([]);
    expect(input.missing_inputs).toEqual([
      "blur_ratio",
      "timestamp_discontinuity_ratio",
    ]);
  });
});
