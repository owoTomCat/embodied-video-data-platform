import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";

import { CollectorPayoutAccountEntity } from "../database/entities/collector-payout-account.entity.js";
import { YzhPayoutOrderEntity } from "../database/entities/yzh-payout-order.entity.js";
import { YzhCallbackLogEntity } from "../database/entities/yzh-callback-log.entity.js";
import {
  loadYzhConfig,
  YZH_CONFIG_TOKEN,
  type YzhConfig,
} from "./yzh.config.js";
import { YzhClientService } from "./yzh-client.service.js";
import { YzhCallbackController } from "./yzh-callback.controller.js";
import { YzhHttpClient } from "./yzh.http-client.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollectorPayoutAccountEntity,
      YzhPayoutOrderEntity,
      YzhCallbackLogEntity,
    ]),
  ],
  controllers: [YzhCallbackController],
  providers: [
    { provide: YZH_CONFIG_TOKEN, useFactory: () => loadYzhConfig() },
    {
      provide: YzhHttpClient,
      useFactory: (config: YzhConfig) => new YzhHttpClient(config),
      inject: [YZH_CONFIG_TOKEN],
    },
    YzhClientService,
  ],
  exports: [YzhClientService],
})
export class YunzhanghuModule {}
