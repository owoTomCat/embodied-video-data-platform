import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PointCycleEntity } from "../database/entities/point-cycle.entity.js";
import { PointCycleItemEntity } from "../database/entities/point-cycle-item.entity.js";
import { PointRuleVersionEntity } from "../database/entities/point-rule-version.entity.js";
import { SubmissionDuplicateCandidateEntity } from "../database/entities/submission-duplicate-candidate.entity.js";
import { UserEntity } from "../database/entities/user.entity.js";
import { AllowedOriginGuard } from "../http/allowed-origin.guard.js";
import { SecurityModule } from "../security/security.module.js";
import { StorageModule } from "../storage/storage.module.js";
import { WalletModule } from "../wallet/wallet.module.js";
import { PointCycleFailureFilter } from "./point-cycle-failure.filter.js";
import { PointCyclesController } from "./point-cycles.controller.js";
import { PointCyclesPolicy } from "./point-cycles.policy.js";
import { PointCyclesService } from "./point-cycles.service.js";
import { PointRulesService } from "./point-rules.service.js";
import { SettlementSchedulerService } from "./settlement-scheduler.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PointCycleEntity,
      PointCycleItemEntity,
      PointRuleVersionEntity,
      SubmissionDuplicateCandidateEntity,
      UserEntity,
    ]),
    AuthModule,
    AuditModule,
    SecurityModule,
    StorageModule,
    WalletModule,
  ],
  controllers: [PointCyclesController],
  providers: [
    PointCyclesService,
    PointRulesService,
    PointCyclesPolicy,
    PointCycleFailureFilter,
    AllowedOriginGuard,
    SettlementSchedulerService,
  ],
  exports: [PointCyclesService, PointRulesService],
})
export class PointsModule {}
