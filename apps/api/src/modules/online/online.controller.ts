import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public, RequirePermission } from '../../common/decorators';
import { RequestUser } from '../../infra/cls/request-context';
import { FlashSaleQueryDto, PlaceShopOrderDto, SaveFlashSaleDto, ShopOrderLookupDto, ShopProductsQueryDto, ToggleFlashSaleDto, UpdateShopConfigDto } from './dto/online.dto';
import { FlashSalesService } from './flash-sales.service';
import { ShopSettingsService } from './shop-settings.service';
import { StorefrontService } from './storefront.service';

/** Quản trị bán online: thiết lập web bán hàng, Flash Sale. */
@ApiTags('online') @ApiBearerAuth() @Controller('online')
export class OnlineController {
  constructor(private readonly settings: ShopSettingsService, private readonly flash: FlashSalesService, private readonly storefront: StorefrontService) {}

  @Get('settings') @RequirePermission('online.manage') @ApiOperation({ summary: 'Thiết lập web bán hàng' })
  getSettings(@CurrentUser() u: RequestUser) { return this.settings.adminView(u); }

  @Get('settings/categories') @RequirePermission('online.manage') @ApiOperation({ summary: 'Danh mục cấp 1 cho mục "Danh mục trên web" (số hàng hiện được, ảnh tự động)' })
  categories(@CurrentUser() u: RequestUser) { return this.storefront.adminCategories(u.tenantId); }

  @Put('settings') @RequirePermission('online.manage') @ApiOperation({ summary: 'Lưu thiết lập web (bật web, hiển thị giá, Flash Sale…)' })
  saveSettings(@CurrentUser() u: RequestUser, @Body() dto: UpdateShopConfigDto) { return this.settings.update(u, dto); }

  @Get('summary') @RequirePermission('order.view') @ApiOperation({ summary: 'Số đơn web đang chờ xử lý (cho menu)' })
  async summary(@CurrentUser() u: RequestUser) { const v = await this.settings.adminView(u); return { pendingOrders: v.pendingOrders, enabled: v.config.enabled }; }

  @Get('flash-sales') @RequirePermission('online.manage')
  listFlash(@Query() q: FlashSaleQueryDto) { return this.flash.list(q); }

  @Get('flash-sales/:id') @RequirePermission('online.manage')
  getFlash(@Param('id', ParseUUIDPipe) id: string) { return this.flash.get(id); }

  @Post('flash-sales') @RequirePermission('online.manage')
  createFlash(@CurrentUser() u: RequestUser, @Body() dto: SaveFlashSaleDto) { return this.flash.create(u, dto); }

  @Put('flash-sales/:id') @RequirePermission('online.manage')
  updateFlash(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveFlashSaleDto) { return this.flash.update(u, id, dto); }

  @Patch('flash-sales/:id/active') @RequirePermission('online.manage') @ApiOperation({ summary: 'Bật / tắt một chương trình Flash Sale' })
  toggleFlash(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ToggleFlashSaleDto) { return this.flash.setActive(id, dto.isActive); }

  @Delete('flash-sales/:id') @HttpCode(204) @RequirePermission('online.manage')
  removeFlash(@Param('id', ParseUUIDPipe) id: string) { return this.flash.remove(id); }
}

/**
 * Web bán hàng công khai: /api/v1/shop/:store/... (store = mã cửa hàng, hoặc "default").
 * Không cần đăng nhập; đặt hàng bị giới hạn tần suất theo IP.
 */
@ApiTags('shop') @Controller('shop/:store') @Public()
export class StorefrontController {
  constructor(private readonly svc: StorefrontService) {}

  @Get('config') @Throttle({ default: { limit: 120, ttl: 60000 } })
  async config(@Param('store') store: string) { return this.svc.config(await this.svc.enter(store, false)); }

  @Get('products') @Throttle({ default: { limit: 120, ttl: 60000 } })
  async products(@Param('store') store: string, @Query() q: ShopProductsQueryDto) { return this.svc.products(await this.svc.enter(store), q); }

  @Get('products/:id') @Throttle({ default: { limit: 120, ttl: 60000 } })
  async product(@Param('store') store: string, @Param('id') id: string) { return this.svc.product(await this.svc.enter(store), id); }

  @Get('flash-sale') @Throttle({ default: { limit: 120, ttl: 60000 } })
  async flashSale(@Param('store') store: string) { return this.svc.flashSale(await this.svc.enter(store)); }

  @Post('orders') @Throttle({ default: { limit: 6, ttl: 60000 } }) @ApiOperation({ summary: 'Khách đặt hàng trên web → đơn đặt hàng (phiếu tạm, nguồn Website)' })
  async placeOrder(@Param('store') store: string, @Body() dto: PlaceShopOrderDto, @Ip() ip: string) { return this.svc.placeOrder(await this.svc.enter(store), dto, ip); }

  @Get('orders/:code') @Throttle({ default: { limit: 20, ttl: 60000 } })
  async lookup(@Param('store') store: string, @Param('code') code: string, @Query() q: ShopOrderLookupDto) { return this.svc.lookup(await this.svc.enter(store), code, q.phone); }
}
