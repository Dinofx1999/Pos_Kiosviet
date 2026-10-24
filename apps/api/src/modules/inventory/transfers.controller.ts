import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Idempotent, RequirePermission } from '../../common/decorators';
import { RequestUser } from '../../infra/cls/request-context';
import { CancelStocktakeDto, CancelTransferDto, CompleteStocktakeDto, CountStocktakeDto, CreateStocktakeDto, CreateTransferDto, DispatchTransferDto, ReceiveTransferDto, StocktakeQueryDto, TransferQueryDto, UpdateStocktakeDto, UpdateTransferDto } from './dto/transfers.dto';
import { StocktakesService } from './stocktakes.service';
import { TransfersService } from './transfers.service';

@ApiTags('transfers') @ApiBearerAuth() @Controller('transfers')
export class TransfersController {
  constructor(private readonly svc: TransfersService) {}
  @Get() @RequirePermission('transfer.view') list(@CurrentUser() u: RequestUser, @Query() q: TransferQueryDto) { return this.svc.list(u, q); }
  @Get(':id') @RequirePermission('transfer.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('transfer.create') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false }) create(@CurrentUser() u: RequestUser, @Body() dto: CreateTransferDto) { return this.svc.create(u, dto); }
  @Post('dispatch-now') @RequirePermission('transfer.create', 'transfer.dispatch') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false }) dispatchNow(@CurrentUser() u: RequestUser, @Body() dto: CreateTransferDto) { return this.svc.dispatchNow(u, dto); }
  @Patch(':id') @RequirePermission('transfer.create') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTransferDto) { return this.svc.update(u, id, dto); }
  @Delete(':id') @RequirePermission('transfer.create') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u, id); }
  @Post(':id/dispatch') @RequirePermission('transfer.dispatch') @Idempotent() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: false }) dispatch(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DispatchTransferDto) { return this.svc.dispatch(u, id, dto.version); }
  @Post(':id/receive') @RequirePermission('transfer.receive') @Idempotent() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: false }) receive(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveTransferDto) { return this.svc.receive(u, id, dto); }
  @Post(':id/cancel') @RequirePermission('transfer.cancel') @Idempotent() @HttpCode(200) cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelTransferDto) { return this.svc.cancel(u, id, dto.reason); }
}

@ApiTags('stocktakes') @ApiBearerAuth() @Controller('stocktakes')
export class StocktakesController {
  constructor(private readonly svc: StocktakesService) {}
  @Get() @RequirePermission('stocktake.view') list(@CurrentUser() u: RequestUser, @Query() q: StocktakeQueryDto) { return this.svc.list(u, q); }
  @Get(':id') @RequirePermission('stocktake.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('stocktake.create') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false }) create(@CurrentUser() u: RequestUser, @Body() dto: CreateStocktakeDto) { return this.svc.create(u, dto); }
  @Patch(':id') @RequirePermission('stocktake.create') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStocktakeDto) { return this.svc.update(u, id, dto); }
  @Post(':id/lines') @RequirePermission('stocktake.create') @HttpCode(200) count(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CountStocktakeDto) { return this.svc.count(u, id, dto.lines); }
  @Delete(':id/lines/:lineId') @RequirePermission('stocktake.create') removeLine(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Param('lineId', ParseUUIDPipe) lineId: string) { return this.svc.removeLine(u, id, lineId); }
  @Post(':id/refresh-snapshot') @RequirePermission('stocktake.create') @HttpCode(200) refresh(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.refreshSnapshot(u, id); }
  @Post(':id/complete') @RequirePermission('stocktake.complete') @Idempotent() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: false }) complete(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteStocktakeDto) { return this.svc.complete(u, id, dto); }
  @Post(':id/cancel') @RequirePermission('stocktake.cancel') @Idempotent() @HttpCode(200) cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelStocktakeDto) { return this.svc.cancel(u, id, dto.reason); }
}
