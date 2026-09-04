export type GuideTaskStatus = "ai_generated";

export type GuidePhotoRef = {
  objectKey: string;
  contentType?: string;
  name?: string;
  sizeBytes?: number;
};

export type GuideEnvObject = {
  name: string;
  category?: string;
  confidence?: number;
};

/** 单个结构化任务卡（子任务） */
export type GuideTaskCard = {
  title?: string;
  target_objects: Array<{ name: string; action?: string }>;
  steps: string[];
  end_condition: string;
  success_criteria: string[];
  fail_criteria: string[];
};

export type GuideTask = {
  id: string;
  sceneTypeTaskId: string | null;
  sceneLibraryId: string | null;
  ownerAccountId: string;
  title: string | null;
  taskIndex: number;
  photoRefs: GuidePhotoRef[];
  envObjects: GuideEnvObject[];
  taskCard: GuideTaskCard | null;
  visionModel: string | null;
  cardPromptVersion: string | null;
  status: GuideTaskStatus;
  submissionId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CollectorLibrary = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  sceneId: string | null;
  scene: { id: string; name: string; categoryKey: string } | null;
  collectionTaskId: string | null;
  photoRefs: GuidePhotoRef[];
  coverObjectKey: string | null;
  description: string;
  enabled: boolean;
  ownerAccountId: string | null;
  taskCount: number;
  createdAt: number;
  updatedAt: number;
};

/** 计费大类（任务大厅分栏） */
export type SceneCategory = {
  categoryKey: string;
  name: string;
};

/** 场景（单层），用于建库选择 */
export type GuideScene = {
  id: string;
  name: string;
  categoryKey: string;
  description: string;
  enabled: boolean;
  updatedAt: number;
};

export type PhotoUploadResult = {
  objectKey: string;
  url: string;
  expiresAt: number;
};

export type GenerateGuideTaskInput = {
  sceneLibraryId: string;
  photoRefs: GuidePhotoRef[];
};

export type CreateCollectorLibraryInput = {
  name: string;
  sceneId: string;
  collectionTaskId?: string | null;
  description?: string;
  photoRefs?: GuidePhotoRef[];
};
