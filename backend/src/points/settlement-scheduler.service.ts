import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { PointCyclesService } from "./point-cycles.service.js";

const TICK_INTERVAL_MS = 60_000;

/** Startup and minute reconciliation recover missed approvals and due settlements. */
@Injectable()
export class SettlementSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementSchedulerService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly cycles: PointCyclesService) {}

  onModuleInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      try {
        await this.cycles.reconcileAccruals();
      } catch (error) {
        this.logger.error("自动入账扫描失败，下次扫描重试", error instanceof Error ? error.stack : String(error));
      }
      const settled = await this.cycles.settleDueCycles();
      if (settled > 0) this.logger.log(`自动结算：${settled} 个到期周期已结算入钱包`);
    } catch (error) {
      this.logger.error("自动结算扫描失败，下次扫描重试", error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}
