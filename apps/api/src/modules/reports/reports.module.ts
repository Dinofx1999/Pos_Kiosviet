import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { SalesModule } from '../sales/sales.module';
import { ReportsController } from './reports.controller';
import { ReportsExcelService } from './reports-excel.service';
import { ReportsService } from './reports.service';

@Module({ imports: [SalesModule, FinanceModule, PurchasingModule], controllers: [ReportsController], providers: [ReportsService, ReportsExcelService], exports: [ReportsService] })
export class ReportsModule {}
