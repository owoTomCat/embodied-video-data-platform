import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  normalizeDetectedSegments,
  parseDetectionOutput,
} from "../media/media-command-runner.js";
import type {
  DetectorWindow,
  PreparedVideoEvidence,
  TimestampedFrame,
  VideoMediaMetadata,
} from "./video-quality.types.js";

export interface MediaProcessRunner {
  run(
    command: string,
    args: string[],
    signal?: AbortSignal,
  ): Promise<{ stdout: string; stderr: string }>;
}

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
};

type ProbeDocument = {
  streams?: ProbeStream[];
  format?: {
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
};

function positiveNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`FFprobe ${label} 无效`);
  }
  return parsed;
}

function frameRate(value: string | undefined): number {
  if (!value) throw new Error("FFprobe 缺少帧率");
  const [numeratorText, denominatorText] = value.split("/");
  const numerator = positiveNumber(numeratorText, "帧率分子");
  const denominator = denominatorText
    ? positiveNumber(denominatorText, "帧率分母")
    : 1;
  return numerator / denominator;
}

function normalizedRotation(stream: ProbeStream): number {
  const raw =
    stream.side_data_list?.find((entry) => Number.isFinite(entry.rotation))
      ?.rotation ?? Number(stream.tags?.rotate ?? 0);
  if (!Number.isFinite(raw)) return 0;
  return ((Math.round(raw / 90) * 90) % 360 + 360) % 360;
}

export function parseQualityProbeOutput(output: string): VideoMediaMetadata {
  const document = JSON.parse(output) as ProbeDocument;
  const stream = document.streams?.find(
    (candidate) => candidate.codec_type === "video",
  );
  if (!stream) throw new Error("FFprobe 未找到视频流");
  const width = positiveNumber(stream.width, "宽度");
  const height = positiveNumber(stream.height, "高度");
  const rotation = normalizedRotation(stream);
  const rotated = rotation === 90 || rotation === 270;
  const displayWidth = rotated ? height : width;
  const displayHeight = rotated ? width : height;
  const durationMs = Math.round(
    positiveNumber(document.format?.duration, "时长") * 1_000,
  );
  const nominalFps = frameRate(stream.avg_frame_rate ?? stream.r_frame_rate);
  const codec = stream.codec_name?.trim();
  if (!codec) throw new Error("FFprobe 缺少编码格式");
  const bitrate = positiveNumber(
    stream.bit_rate ?? document.format?.bit_rate,
    "码率",
  );
  return {
    display_width: displayWidth,
    display_height: displayHeight,
    display_aspect_ratio: displayWidth / displayHeight,
    duration_ms: durationMs,
    nominal_fps: nominalFps,
    effective_fps: nominalFps,
    codec,
    bitrate_bps: bitrate,
    file_size_bytes: positiveNumber(document.format?.size, "文件大小"),
    rotation_degrees: rotation,
  };
}

export function calculateSamplingFps(durationMs: number): number {
  const seconds = Math.max(0.001, durationMs / 1_000);
  const targetFrameCount = Math.min(96, Math.max(4, Math.ceil(seconds / 5)));
  return Math.min(10, Math.max(4 / seconds, targetFrameCount / seconds));
}

function scaleFilter(fps: number): string {
  return `fps=${fps},scale=960:960:force_original_aspect_ratio=decrease`;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export class NodeMediaProcessRunner implements MediaProcessRunner {
  async run(
    command: string,
    args: string[],
    signal?: AbortSignal,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let capturedBytes = 0;
      let settled = false;
      const settle = (
        callback: () => void,
      ) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", abort);
        callback();
      };
      const collect = (target: Buffer[], chunk: Buffer) => {
        capturedBytes += chunk.length;
        if (capturedBytes > 32 * 1024 * 1024) {
          child.kill("SIGKILL");
          settle(() => reject(new Error(`${command} 输出超过 32 MiB`)));
          return;
        }
        target.push(chunk);
      };
      const abort = () => {
        child.kill("SIGTERM");
        settle(() => reject(signal?.reason ?? new Error("任务已取消")));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.once("error", (error) => settle(() => reject(error)));
      child.once("close", (code) => {
        const result = {
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        };
        if (code === 0) settle(() => resolve(result));
        else {
          settle(() =>
            reject(
              new Error(
                `${command} 执行失败（${code ?? "unknown"}）：${result.stderr.slice(-2_000)}`,
              ),
            ),
          );
        }
      });
    });
  }
}

function sumDuration(
  windows: DetectorWindow[],
  type: DetectorWindow["type"],
): number {
  return windows
    .filter((window) => window.type === type)
    .reduce((total, window) => total + (window.end_ms - window.start_ms), 0);
}

async function readTimestampedFrames(
  directory: string,
  prefix: string,
  fps: number,
  offsetMs = 0,
): Promise<TimestampedFrame[]> {
  const names = (await readdir(directory))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".jpg"))
    .sort();
  return Promise.all(
    names.map(async (name, index) => ({
      timestampMs: Math.round(offsetMs + (index * 1_000) / fps),
      dataUrl: `data:image/jpeg;base64,${(
        await readFile(join(directory, name))
      ).toString("base64")}`,
    })),
  );
}

export type ReviewWindow = { startMs: number; endMs: number };

export class VideoQualityMediaPreprocessor {
  private readonly runner: MediaProcessRunner;

  constructor(options: { runner?: MediaProcessRunner } = {}) {
    this.runner = options.runner ?? new NodeMediaProcessRunner();
  }

  async prepare(
    filePath: string,
    workDirectory: string,
    signal?: AbortSignal,
  ): Promise<PreparedVideoEvidence> {
    await mkdir(workDirectory, { recursive: true });
    const [probe, sha256] = await Promise.all([
      this.runner.run(
        "ffprobe",
        [
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          filePath,
        ],
        signal,
      ),
      sha256File(filePath),
    ]);
    const metadata = parseQualityProbeOutput(probe.stdout);
    const detection = await this.runner.run(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-i",
        filePath,
        "-an",
        "-vf",
        "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=-50dB:d=2",
        "-f",
        "null",
        "-",
      ],
      signal,
    );
    const detected = normalizeDetectedSegments(
      parseDetectionOutput(detection.stderr),
      metadata.duration_ms / 1_000,
    );
    const detectorWindows: DetectorWindow[] = detected.map((segment) => ({
      type: segment.type,
      start_ms: Math.round(segment.startSeconds * 1_000),
      end_ms: Math.round(segment.endSeconds * 1_000),
      confidence: 1,
      source: "ffmpeg",
    }));

    const samplingFps = calculateSamplingFps(metadata.duration_ms);
    const framesDirectory = join(workDirectory, "full-frames");
    await mkdir(framesDirectory, { recursive: true });
    const pattern = join(framesDirectory, "full-%06d.jpg");
    await this.runner.run(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-i",
        filePath,
        "-an",
        "-vf",
        scaleFilter(samplingFps),
        "-q:v",
        "4",
        pattern,
      ],
      signal,
    );
    const fullVideoFrames = await readTimestampedFrames(
      framesDirectory,
      "full-",
      samplingFps,
    );
    if (fullVideoFrames.length < 4) {
      throw new Error("视频取样少于千问要求的 4 帧");
    }

    return {
      sha256,
      metadata,
      technicalMetrics: {
        decodable: true,
        decoded_duration_ms: metadata.duration_ms,
        black_ratio:
          sumDuration(detectorWindows, "black") / metadata.duration_ms,
        freeze_ratio:
          sumDuration(detectorWindows, "freeze") / metadata.duration_ms,
        blur_ratio: null,
        underexposure_ratio: null,
        overexposure_ratio: null,
        timestamp_discontinuity_ratio: null,
        detector_windows: detectorWindows,
      },
      fullVideoFrames,
      fullVideoSamplingFps: samplingFps,
      missingMetrics: [
        "blur_ratio",
        "underexposure_ratio",
        "overexposure_ratio",
        "timestamp_discontinuity_ratio",
      ],
    };
  }

  async prepareAnnotation(
    filePath: string,
    workDirectory: string,
    signal?: AbortSignal,
  ): Promise<Pick<PreparedVideoEvidence, "sha256" | "metadata" | "fullVideoFrames" | "fullVideoSamplingFps">> {
    await mkdir(workDirectory, { recursive: true });
    const [probe, sha256] = await Promise.all([
      this.runner.run(
        "ffprobe",
        [
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          filePath,
        ],
        signal,
      ),
      sha256File(filePath),
    ]);
    const metadata = parseQualityProbeOutput(probe.stdout);
    const fullVideoSamplingFps = calculateSamplingFps(metadata.duration_ms);
    const framesDirectory = join(workDirectory, "annotation-frames");
    await mkdir(framesDirectory, { recursive: true });
    await this.runner.run(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-i",
        filePath,
        "-an",
        "-vf",
        scaleFilter(fullVideoSamplingFps),
        "-q:v",
        "4",
        join(framesDirectory, "annotation-%06d.jpg"),
      ],
      signal,
    );
    const fullVideoFrames = await readTimestampedFrames(
      framesDirectory,
      "annotation-",
      fullVideoSamplingFps,
    );
    if (fullVideoFrames.length < 4) {
      throw new Error("视频取样少于千问要求的 4 帧");
    }
    return {
      sha256,
      metadata,
      fullVideoFrames,
      fullVideoSamplingFps,
    };
  }

  async extractReviewFrames(
    filePath: string,
    windows: ReviewWindow[],
    workDirectory: string,
    signal?: AbortSignal,
  ): Promise<TimestampedFrame[]> {
    const frames: TimestampedFrame[] = [];
    await mkdir(workDirectory, { recursive: true });
    for (const [index, rawWindow] of windows.entries()) {
      const center = (rawWindow.startMs + rawWindow.endMs) / 2;
      const rawDuration = Math.max(1_000, rawWindow.endMs - rawWindow.startMs);
      const durationMs = Math.min(60_000, Math.max(10_000, rawDuration));
      const startMs = Math.max(0, center - durationMs / 2);
      const fps = durationMs < 20_000 ? 2 : 1;
      const prefix = `review-${String(index).padStart(3, "0")}-`;
      const pattern = join(workDirectory, `${prefix}%06d.jpg`);
      await this.runner.run(
        "ffmpeg",
        [
          "-hide_banner",
          "-nostdin",
          "-ss",
          (startMs / 1_000).toFixed(3),
          "-t",
          (durationMs / 1_000).toFixed(3),
          "-i",
          filePath,
          "-an",
          "-vf",
          scaleFilter(fps),
          "-q:v",
          "4",
          pattern,
        ],
        signal,
      );
      frames.push(
        ...(await readTimestampedFrames(
          workDirectory,
          prefix,
          fps,
          startMs,
        )),
      );
    }
    return frames.sort((left, right) => left.timestampMs - right.timestampMs);
  }
}
