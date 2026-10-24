import { Module } from '@nestjs/common';
import { InventoryDocumentsService } from './documents.service';
import { InventoryController } from './inventory.controller';
import { ReservationsService } from './reservations.service';
import { StockEngineService } from './stock-engine.service';
import { StockQueryService } from './stock-query.service';
import { StocktakesService } from './stocktakes.service';
import { StocktakesController, TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  controllers: [InventoryController, TransfersController, StocktakesController],
  providers: [StockEngineService, InventoryDocumentsService, StockQueryService, ReservationsService, TransfersService, StocktakesService],
  exports: [StockEngineService, InventoryDocumentsService, StockQueryService, ReservationsService, TransfersService, StocktakesService],
})
export class InventoryModule {}
