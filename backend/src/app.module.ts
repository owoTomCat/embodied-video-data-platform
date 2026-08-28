import { Module } from "@nestjs/common";

import { AiQualityModule } from "./ai-quality/ai-quality.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { DeliveryModule } from "./delivery/delivery.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { MessagingModule } from "./messaging/messaging.module.js";
import { OperationsModule } from "./operations/operations.module.js";
import { PointsModule } from "./points/points.module.js";
import { PublicSiteModule } from "./public-site/public-site.module.js";
import { SubmissionsModule } from "./submissions/submissions.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { WalletModule } from "./wallet/wallet.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AuditModule,
    IdentityModule,
    MessagingModule,
    SubmissionsModule,
    PointsModule,
    WalletModule,
    DeliveryModule,
    OperationsModule,
    AiQualityModule,
    PublicSiteModule,
    HealthModule,
    TasksModule,
  ],
})
export class AppModule {}
