import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { FlashSalesService } from './flash-sales.service';
import { OnlineController, StorefrontController } from './online.controller';
import { ShopSettingsService } from './shop-settings.service';
import { StorefrontService } from './storefront.service';

/** Bán online: web bán hàng công khai + Flash Sale (BR-180..BR-186). */
@Module({
  imports: [SalesModule],
  controllers: [OnlineController, StorefrontController],
  providers: [ShopSettingsService, FlashSalesService, StorefrontService],
})
export class OnlineModule {}
