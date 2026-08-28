import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { PointCyclesService } from "./point-cycles.service.js";

const TICK_INTERVAL_MS = 60_000;
const AUTO_LOCK_HOUR = 2;

/**
 * 结算定时任务（无外部调度依赖，容器内 setInterval 驱动）：
 * - 每分钟扫描一次到期的锁定周期并自动结算（锁定 + 3 天）
 * - 每天上海时区凌晨 2 点自动锁定当日合格数据（当天已锁定则跳过）
 */
@Injectable()
export class SettlementSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly cycles: PointCyclesService) {}

  onModuleInit(): void {
    // 启动时先执行一次结算扫描，避免停机期间遗漏到期周期
    void this.settleDue().catch(() => undefined);
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    await this.settleDue();
    const now = new Date();
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        hour12: false,
      }).format(now),
    );
    if (hour === AUTO_LOCK_HOUR) {
      const locked = await this.cycles.autoLockDue(now);
      if (locked) this.logger.log("凌晨自动锁定：已锁定当日合格数据");
    }
  }

  private async settleDue(): Promise<void> {
    const settled = await this.cycles.settleDueCycles();
    if (settled > 0) {
      this.logger.log(`自动结算：${settled} 个到期周期已结算入钱包`);
    }
  }
}
