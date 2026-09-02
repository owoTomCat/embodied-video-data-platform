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

export type GuideTaskCard = {
  target_objects: Array<{ name: string; action?: string }>;
  steps: string[];
  end_condition: string;
  success_criteria: string[];
  fail_criteria: string[];
};

export type GuideTask = {
  id: string;
  sceneTypeTaskId: string;
  ownerAccountId: string;
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

export type PhotoUploadResult = {
  objectKey: string;
  url: string;
  expiresAt: number;
};

export type GenerateGuideTaskInput = {
  sceneTypeTaskId: string;
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
