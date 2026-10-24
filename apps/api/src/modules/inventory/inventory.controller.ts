import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Idempotent, RequirePermission } from '../../common/decorators';
import { Errors } from '../../common/errors/app-error';
import { RequestUser } from '../../infra/cls/request-context';
import { InventoryDocumentsService } from './documents.service';
import { BalanceQueryDto, CancelDocumentDto, CreateDocumentDto, CreateReservationDto, DocumentQueryDto, MovementQueryDto, ReservationQueryDto, UpdateDocumentDto } from './dto/inventory.dto';
import { ReservationsService } from './reservations.service';
import { StockQueryService } from './stock-query.service';

@ApiTags('inventory') @ApiBearerAuth() @Controller('inventory')
export class InventoryController {
  constructor(private readonly docs: InventoryDocumentsService, private readonly stock: StockQueryService, private readonly reservations: ReservationsService) {}

  // ---- balances / movements
  @Get('balances') @RequirePermission('inventory.view') balances(@CurrentUser() u: RequestUser, @Query() q: BalanceQueryDto) { return this.stock.balances(u, q); }
  @Get('balances/summary') @RequirePermission('inventory.view') summary(@CurrentUser() u: RequestUser, @Query('warehouseId') warehouseId?: string) { return this.stock.summary(u, warehouseId); }
  @Get('movements') @RequirePermission('inventory.movement.view') movements(@CurrentUser() u: RequestUser, @Query() q: MovementQueryDto) { return this.stock.movements(u, q); }
  @Post('reconcile') @RequirePermission('inventory.view') @HttpCode(200) reconcile(@CurrentUser() u: RequestUser) {
    if (!u.isOwner && !u.permissions.has('*')) throw Errors.forbidden('Chỉ quản trị viên mới chạy đối soát');
    return this.stock.reconcile(u.tenantId);
  }

  // ---- documents
  @Get('documents') @RequirePermission('inventory.document.view') list(@CurrentUser() u: RequestUser, @Query() q: DocumentQueryDto) { return this.docs.list(u, q); }
  @Get('documents/:id') @RequirePermission('inventory.document.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.docs.get(u, id); }
  @Post('documents') @RequirePermission('inventory.document.create') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false })
  create(@CurrentUser() u: RequestUser, @Body() dto: CreateDocumentDto) { return this.docs.create(u, dto); }
  @Post('documents/post-now') @RequirePermission('inventory.document.create', 'inventory.document.post') @Idempotent() @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Tạo và ghi sổ trong một transaction' })
  createAndPost(@CurrentUser() u: RequestUser, @Body() dto: CreateDocumentDto) { return this.docs.createAndPost(u, dto); }
  @Patch('documents/:id') @RequirePermission('inventory.document.create') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDocumentDto) { return this.docs.update(u, id, dto); }
  @Delete('documents/:id') @RequirePermission('inventory.document.create') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.docs.remove(u, id); }
  @Post('documents/:id/post') @RequirePermission('inventory.document.post') @Idempotent() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: false })
  post(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.docs.post(u, id); }
  @Post('documents/:id/cancel') @RequirePermission('inventory.document.cancel') @Idempotent() @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: false })
  cancel(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDocumentDto) { return this.docs.cancel(u, id, dto.reason); }

  // ---- reservations
  @Get('reservations') @RequirePermission('inventory.view') reservationList(@CurrentUser() u: RequestUser, @Query() q: ReservationQueryDto) { return this.reservations.list(u, q); }
  @Post('reservations') @RequirePermission('inventory.document.create') reserve(@CurrentUser() u: RequestUser, @Body() dto: CreateReservationDto) { return this.reservations.create(u, dto); }
  @Post('reservations/:id/release') @RequirePermission('inventory.document.create') @HttpCode(200) release(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.reservations.release(u, id); }
}
