import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { SalesModule } from '../sales/sales.module';
import { ImportService } from './import.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({ imports: [CatalogModule, InventoryModule, FinanceModule, PurchasingModule, SalesModule], controllers: [IntegrationsController], providers: [ImportService, IntegrationsService], exports: [ImportService, IntegrationsService] })
export class IntegrationsModule {}
