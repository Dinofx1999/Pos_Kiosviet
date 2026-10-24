import { Global, Module } from '@nestjs/common';
import { PlanService } from './plan.service';
import { PlatformController, SubscriptionController } from './platform.controller';

/** Global so every module can enforce plan limits through PlanService (BR-160). */
@Global()
@Module({ controllers: [SubscriptionController, PlatformController], providers: [PlanService], exports: [PlanService] })
export class PlatformModule {}
