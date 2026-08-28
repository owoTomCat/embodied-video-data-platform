export type CollectionTaskStatus = "draft" | "published" | "paused" | "closed";
export type TaskNormalizationStatus = "pending" | "ready" | "failed";
export type CollectionTaskType = "generic" | "preset" | "custom";

export type PresetScene = {
  key: string;
  /** 所属场景大类（定价按大类设置，细分场景共用同一价格） */
  categoryKey: string;
  name: string;
  tagline: string;
  defaultTitle: string;
  description: string;
  requirements: string[];
  qualityNotes: string[];
};

/** 任务类型选择器数据源：预设场景目录 + 通用任务模板 */
export type TaskTypeCatalog = {
  presetScenes: PresetScene[];
  generic: {
    sceneName: string;
    defaultTitle: string;
    description: string;
    requirements: string[];
  };
};

export type NormalizedRequirementItem = {
  type: "hard" | "soft";
  content: string;
  rationale?: string;
};

/** 与服务端 / AI 规范化输出的结构保持一致 */
export type NormalizedTaskRequirements = {
  scene_description: string;
  requirements: NormalizedRequirementItem[];
  quality_notes: string[];
};

export type CollectionTask = {
  id: string;
  title: string;
  description: string;
  sceneName: string;
  sceneLabelId: string | null;
  sceneLibraryId: string | null;
  taskType: CollectionTaskType;
  rawRequirements: string;
  normalizedRequirements: NormalizedTaskRequirements | null;
  normalizationStatus: TaskNormalizationStatus;
  pricePointsPerMinute: number | null;
  status: CollectionTaskStatus;
  revision: number;
  createdByName: string;
  publishedAt: number | null;
  pausedAt: number | null;
  closedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type CollectionTaskForCollector = {
  id: string;
  title: string;
  description: string;
  sceneName: string;
  sceneLabelId: string | null;
  sceneLibraryId: string | null;
  taskType: CollectionTaskType;
  normalizedRequirements: NormalizedTaskRequirements | null;
  pricePointsPerMinute: number | null;
  status: CollectionTaskStatus;
  revision: number;
  publishedAt: number | null;
};

export type CreateTaskInput = {
  title: string;
  description?: string;
  sceneName: string;
  taskType?: CollectionTaskType;
  rawRequirements: string;
  sceneLibraryId?: string | null;
  pricePointsPerMinute?: number | null;
};

export type UpdateTaskInput = Partial<CreateTaskInput>;

export type ConfirmRequirementsInput = {
  scene_description: string;
  requirements: NormalizedRequirementItem[];
  quality_notes?: string[];
};

export type TaskListResult = {
  tasks: CollectionTask[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type TaskListQuery = {
  status?: "all" | CollectionTaskStatus;
  q?: string;
  page?: number;
  pageSize?: number;
};
