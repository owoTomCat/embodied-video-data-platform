/** 一级场景常量（编码/名称/计费大类 key） */
export type Level1Scene = {
  code: string;
  name: string;
  categoryKey: string;
};

/** 场景分类表条目：一级编码 + 一级场景 + 二级场景 + 场景描述 */
export type SceneClassification = {
  id: string;
  level1Code: string;
  level1Name: string;
  level2Name: string;
  description: string;
  enabled: boolean;
  updatedAt: number;
};

export type CreateSceneClassificationInput = {
  level1Code: string;
  level2Name: string;
  description?: string;
};

export type UpdateSceneClassificationInput = {
  level2Name?: string;
  description?: string;
  enabled?: boolean;
};

/** 场景库条目：实际采集场景（场景名称 + 场景类别 + 子场景） */
export type SceneLibraryItem = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  subScenes: Array<{ id: string; level2Name: string; level1Code: string }>;
  subSceneIds: string[];
  description: string;
  enabled: boolean;
  createdByName: string;
  updatedAt: number;
};

export type CreateSceneLibraryInput = {
  name: string;
  categoryKey: string;
  subSceneIds: string[];
  description?: string;
};

export type UpdateSceneLibraryInput = {
  name?: string;
  categoryKey?: string;
  subSceneIds?: string[];
  description?: string;
  enabled?: boolean;
};
