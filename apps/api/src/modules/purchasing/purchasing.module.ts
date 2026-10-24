import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseReceiptsService } from './purchase-receipts.service';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchasingReportsService } from './purchasing-reports.service';
import { PurchaseOrdersController, PurchaseReceiptsController, PurchaseReturnsController, PurchasingReportsController, SuppliersController } from './purchasing.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [InventoryModule, FinanceModule],
  controllers: [SuppliersController, PurchaseOrdersController, PurchaseReceiptsController, PurchaseReturnsController, PurchasingReportsController],
  providers: [SuppliersService, PurchaseOrdersService, PurchaseReceiptsService, PurchaseReturnsService, PurchasingReportsService],
  exports: [SuppliersService, PurchaseReceiptsService, PurchasingReportsService],
})
export class PurchasingModule {}
