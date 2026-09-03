/** 场景（单层）：原二级场景升级为唯一场景实体，归属一个计费大类 categoryKey */
export type Scene = {
  id: string;
  name: string;
  categoryKey: string;
  description: string;
  enabled: boolean;
  updatedAt: number;
};

export type CreateSceneInput = {
  name: string;
  categoryKey: string;
  description?: string;
};

export type UpdateSceneInput = {
  name?: string;
  description?: string;
  enabled?: boolean;
};

/** 场景库条目：实际采集场景（场景名称 + 计费大类 + 子场景） */
export type SceneLibraryItem = {
  id: string;
  name: string;
  categoryKey: string;
  categoryName: string;
  subScenes: Array<{ id: string; name: string; categoryKey: string }>;
  subSceneIds: string[];
  description: string;
  enabled: boolean;
  createdByName: string;
  updatedAt: number;
};
