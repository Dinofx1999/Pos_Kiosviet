import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CustomersService } from './customers.service';
import { InvoicesService } from './invoices.service';
import { SalesReportsService } from './sales-reports.service';
import { CustomersController, DeliveriesController, InvoicesController, OrdersController, PromotionsController, SalesReportsController, SalesReturnsController, ShiftsController } from './sales.controller';
import { OrdersService } from './orders.service';
import { DeliveriesService } from './deliveries.service';
import { PromotionsService } from './promotions.service';
import { LoyaltyService } from './loyalty.service';
import { SalesReturnsService } from './sales-returns.service';
import { ShiftsService } from './shifts.service';

@Module({
  imports: [InventoryModule, FinanceModule],
  controllers: [CustomersController, ShiftsController, InvoicesController, SalesReportsController, SalesReturnsController, PromotionsController, OrdersController, DeliveriesController],
  providers: [CustomersService, ShiftsService, InvoicesService, SalesReportsService, SalesReturnsService, PromotionsService, OrdersService, DeliveriesService, LoyaltyService],
  exports: [CustomersService, InvoicesService, SalesReportsService, PromotionsService, LoyaltyService],
})
export class SalesModule {}
