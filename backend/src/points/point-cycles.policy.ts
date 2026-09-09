import { Injectable } from "@nestjs/common";

import type { PublicUser } from "../auth/auth.types.js";
import { PointCycleFailure } from "./point-cycle-failure.js";

function assertActive(actor: PublicUser): void {
  if (actor.status !== "active") {
    throw new PointCycleFailure("FORBIDDEN", "账号已停用", 403);
  }
}

@Injectable()
export class PointCyclesPolicy {
  requireAdjust(actor: PublicUser): void {
    assertActive(actor);
    if (actor.role !== "admin") {
      throw new PointCycleFailure(
        "FORBIDDEN",
        "仅管理员可调整结算中金额",
        403,
      );
    }
  }

  requireRead(actor: PublicUser): void {
    assertActive(actor);
  }
}
