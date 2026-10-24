import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { BrandsController, CategoriesController, PriceBooksController, ProductsController, UnitsController, VariantsController } from './catalog.controller';
import { PriceBooksService } from './price-books.service';
import { ProductExcelService } from './product-excel.service';
import { ProductsService } from './products.service';
import { TaxonomyService } from './taxonomy.service';

@Module({
  imports: [InventoryModule],
  controllers: [CategoriesController, BrandsController, UnitsController, ProductsController, VariantsController, PriceBooksController],
  providers: [TaxonomyService, ProductsService, PriceBooksService, ProductExcelService],
  exports: [ProductsService],
})
export class CatalogModule {}
