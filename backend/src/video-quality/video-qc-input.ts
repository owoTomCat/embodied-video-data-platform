import type {
  PreparedVideoEvidence,
  VideoQcInputV1,
} from "./video-quality.types.js";

export type BuildVideoQcInput = {
  videoId: string;
  evidence: PreparedVideoEvidence;
  exactBatchDuplicate: boolean;
  prohibitedContentPolicy?: string[];
  previousModelObservations?: Array<Record<string, unknown>>;
  demandContext?: {
    snapshotId: string;
    status: "紧缺" | "推荐" | "已饱和";
    coefficient: number;
  };
};

export function buildVideoQcInput(input: BuildVideoQcInput): VideoQcInputV1 {
  return {
    schema_version: "video_qc_input_v1",
    video_id: input.videoId,
    analysis_duration_ms: input.evidence.metadata.duration_ms,
    video_input_present: true,
    media_metadata: { ...input.evidence.metadata },
    technical_metrics: {
      ...input.evidence.technicalMetrics,
      detector_windows: input.evidence.technicalMetrics.detector_windows.map(
        (window) => ({ ...window }),
      ),
    },
    task_context: {
      submitted_task_name: "",
      expected_scene_id: "",
      expected_task_id: "",
      expected_variant_id: "",
      prohibited_content_policy: input.prohibitedContentPolicy ?? [],
    },
    inventory_context: {
      snapshot_id: input.demandContext?.snapshotId ?? "quality-lab-cold-start",
      mode: input.demandContext ? "guide_snapshot" : "cold_start",
      demand_status: input.demandContext?.status,
      authoritative_coefficient: input.demandContext?.coefficient ?? 1,
      c_scene: input.demandContext?.coefficient ?? 1,
      c_standard_task: input.demandContext?.coefficient ?? 1,
      c_variant: input.demandContext?.coefficient ?? 1,
      current_video_excluded: true,
    },
    similarity_context: {
      snapshot_id: "quality-lab-cold-start",
      file_hash_exact: input.exactBatchDuplicate,
      confirmed_duplicate: input.exactBatchDuplicate,
      authoritative_coefficient: 1,
      s_video: 0,
      s_segment: 0,
      s_semantic: 0,
      matched_duration_ratio: 0,
      temporal_order_similarity: 0,
      top_candidates: [],
    },
    previous_model_observations: input.previousModelObservations ?? [],
    requested_output_schema: "video_qc_result_v2",
    missing_inputs: [...input.evidence.missingMetrics],
  };
}
