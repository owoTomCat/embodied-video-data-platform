/** 一级场景（可管理；编码创建后不可修改，关联计费大类 categoryKey） */
export type Level1Scene = {
  id: string;
  code: string;
  name: string;
  categoryKey: string;
  description: string;
  sortOrder: number;
  enabled: boolean;
  level2Count: number;
  libraryCount: number;
  updatedAt: number;
};

export type CreateSceneLevel1Input = {
  code: string;
  name: string;
  description?: string;
  sortOrder?: number;
};

export type UpdateSceneLevel1Input = {
  name?: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
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
