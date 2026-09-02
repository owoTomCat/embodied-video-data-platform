export type GuideTaskStatus =
  | "ai_generated"
  | "in_review"
  | "approved"
  | "rejected";

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
  editedAt: number | null;
  submissionId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CollectorLibrary = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  subSceneIds: string[];
  subScenes: Array<{ id: string; level2Name: string; level1Code: string }>;
  description: string;
  enabled: boolean;
  ownerAccountId: string | null;
  taskCount: number;
  createdAt: number;
  updatedAt: number;
};

export type GuideSceneClassification = {
  id: string;
  level1Code: string;
  level1Name: string;
  level2Name: string;
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

export type SubmitEditedCardInput = {
  sceneName: string;
  card: GuideTaskCard;
};

export type ReviewGuideTaskInput = {
  decision: "approved" | "rejected";
  comment?: string;
};

export type CreateCollectorLibraryInput = {
  name: string;
  categoryKey: string;
  subSceneIds: string[];
  description?: string;
};
