import type { PublicUser } from "../auth/auth.types.js";

export class SceneGuideFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SceneGuideFailure";
  }
}

function assertActive(actor: PublicUser): void {
  if (actor.status !== "active") {
    throw new SceneGuideFailure("FORBIDDEN", "账号未激活，不可操作", 403);
  }
}

/** 数采人员 / 团长：可生成指导任务卡、编辑提交、查看自己的指导任务 */
function requireCollector(actor: PublicUser): void {
  assertActive(actor);
}

/** 管理员：可审核、查看全部指导任务卡 */
function requireAdmin(actor: PublicUser): void {
  assertActive(actor);
  if (actor.role !== "admin") {
    throw new SceneGuideFailure("FORBIDDEN", "仅管理员可审核指导任务卡", 403);
  }
}

export const sceneGuidePolicy = {
  requireCollector,
  requireAdmin,
};
