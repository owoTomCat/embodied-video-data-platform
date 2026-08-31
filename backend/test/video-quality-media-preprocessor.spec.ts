import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  calculateSamplingFps,
  parseQualityProbeOutput,
  VideoQualityMediaPreprocessor,
  type MediaProcessRunner,
} from "../src/video-quality/media-preprocessor.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const probeDocument = JSON.stringify({
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1080,
      height: 1920,
      avg_frame_rate: "60/1",
      r_frame_rate: "60/1",
      bit_rate: "4000000",
      tags: { rotate: "90" },
    },
  ],
  format: {
    duration: "10.000",
    size: "12",
    bit_rate: "4000000",
  },
});

class FakeRunner implements MediaProcessRunner {
  calls: Array<{ command: string; args: string[] }> = [];

  async run(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    this.calls.push({ command, args });
    if (command === "ffprobe") return { stdout: probeDocument, stderr: "" };
    const outputPattern = args.at(-1) ?? "";
    if (outputPattern.endsWith(".jpg")) {
      await mkdir(dirname(outputPattern), { recursive: true });
      for (let index = 1; index <= 4; index += 1) {
        await writeFile(
          outputPattern.replace("%06d", String(index).padStart(6, "0")),
          Buffer.from([0xff, 0xd8, index, 0xff, 0xd9]),
        );
      }
      return { stdout: "", stderr: "" };
    }
    return {
      stdout: "",
      stderr: [
        "black_start:1 black_end:2 black_duration:1",
        "freeze_start:4",
        "freeze_end:6 | freeze_duration:2",
      ].join("\n"),
    };
  }
}

describe("video quality media preprocessor", () => {
  it("uses rotation-corrected display dimensions", () => {
    const metadata = parseQualityProbeOutput(probeDocument);

    expect(metadata.display_width).toBe(1920);
    expect(metadata.display_height).toBe(1080);
    expect(metadata.display_aspect_ratio).toBeCloseTo(16 / 9);
    expect(metadata.rotation_degrees).toBe(90);
    expect(metadata.nominal_fps).toBe(60);
  });

  it("samples enough frames for short videos and caps long-video model input", () => {
    expect(calculateSamplingFps(60_000)).toBe(0.2);
    expect(calculateSamplingFps(10_000)).toBe(0.4);
    expect(calculateSamplingFps(1_000)).toBe(4);
    expect(
      Math.ceil(calculateSamplingFps(1_111_533) * (1_111_533 / 1_000)),
    ).toBeLessThanOrEqual(96);
  });

  it("prepares timestamped frames and deterministic black/freeze windows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "evdp-quality-media-test-"));
    temporaryDirectories.push(directory);
    const source = join(directory, "video.mp4");
    await writeFile(source, Buffer.from("test-content"));
    const runner = new FakeRunner();
    const preprocessor = new VideoQualityMediaPreprocessor({ runner });

    const prepared = await preprocessor.prepare(
      source,
      join(directory, "work"),
    );

    expect(prepared.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(prepared.fullVideoSamplingFps).toBe(0.4);
    expect(prepared.fullVideoFrames).toHaveLength(4);
    expect(prepared.fullVideoFrames[1]?.timestampMs).toBe(2_500);
    expect(prepared.technicalMetrics.black_ratio).toBe(0.1);
    expect(prepared.technicalMetrics.freeze_ratio).toBe(0.2);
    expect(prepared.technicalMetrics.detector_windows).toEqual([
      expect.objectContaining({ type: "black", start_ms: 1_000, end_ms: 2_000 }),
      expect.objectContaining({ type: "freeze", start_ms: 4_000, end_ms: 6_000 }),
    ]);
    expect(prepared.missingMetrics).toContain("blur_ratio");
    expect(runner.calls.some((call) => call.command === "ffprobe")).toBe(true);
    expect(runner.calls.filter((call) => call.command === "ffmpeg")).toHaveLength(2);
  });

  it("prepares annotation frames without running quality detectors", async () => {
    const directory = await mkdtemp(join(tmpdir(), "evdp-annotation-media-test-"));
    temporaryDirectories.push(directory);
    const source = join(directory, "video.mp4");
    await writeFile(source, Buffer.from("test-content"));
    const runner = new FakeRunner();
    const preprocessor = new VideoQualityMediaPreprocessor({ runner });

    const prepared = await preprocessor.prepareAnnotation(
      source,
      join(directory, "work"),
    );

    expect(prepared.fullVideoFrames).toHaveLength(4);
    expect(runner.calls.filter((call) => call.command === "ffmpeg")).toHaveLength(1);
    expect(
      runner.calls.some((call) => call.args.some((argument) => argument.includes("blackdetect"))),
    ).toBe(false);
  });
});
