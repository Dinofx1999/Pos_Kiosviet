import { Body, Controller, Delete, Get, HttpCode, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { Errors } from '../../common/errors/app-error';
import { RequestUser } from '../../infra/cls/request-context';
import { CreateBatchDto, CreateCategoryDto, CreatePriceBookDto, CreateProductDto, NameDto, ProductQueryDto, SetPriceBookItemsDto, UpdateCategoryDto, UpdatePriceBookDto, UpdateProductDto } from './dto/catalog.dto';
import { PriceBooksService } from './price-books.service';
import { ProductExcelService } from './product-excel.service';
import { ProductsService } from './products.service';
import { TaxonomyService } from './taxonomy.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('categories') @ApiBearerAuth() @Controller('categories')
export class CategoriesController {
  constructor(private readonly svc: TaxonomyService) {}
  @Get() @RequirePermission('product.view') tree() { return this.svc.categoryTree(); }
  @Post() @RequirePermission('category.manage') create(@CurrentUser() u: RequestUser, @Body() dto: CreateCategoryDto) { return this.svc.createCategory(u, dto); }
  @Patch(':id') @RequirePermission('category.manage') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) { return this.svc.updateCategory(u, id, dto); }
  @Delete(':id') @RequirePermission('category.manage') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.deleteCategory(u, id); }
}

@ApiTags('brands') @ApiBearerAuth() @Controller('brands')
export class BrandsController {
  constructor(private readonly svc: TaxonomyService) {}
  @Get() @RequirePermission('product.view') list(@Query('includeInactive', new ParseBoolPipe({ optional: true })) inactive?: boolean) { return this.svc.listBrands(inactive ?? false); }
  @Post() @RequirePermission('brand.manage') create(@CurrentUser() u: RequestUser, @Body() dto: NameDto) { return this.svc.createBrand(u, dto); }
  @Patch(':id') @RequirePermission('brand.manage') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NameDto) { return this.svc.updateBrand(u, id, dto); }
  @Delete(':id') @RequirePermission('brand.manage') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.deleteBrand(u, id); }
}

@ApiTags('units') @ApiBearerAuth() @Controller('units')
export class UnitsController {
  constructor(private readonly svc: TaxonomyService) {}
  @Get() @RequirePermission('product.view') list() { return this.svc.listUnits(); }
  @Post() @RequirePermission('unit.manage') create(@CurrentUser() u: RequestUser, @Body() dto: NameDto) { return this.svc.createUnit(u, dto); }
  @Delete(':id') @RequirePermission('unit.manage') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.deleteUnit(u, id); }
}

@ApiTags('products') @ApiBearerAuth() @Controller('products')
export class ProductsController {
  constructor(private readonly svc: ProductsService, private readonly excel: ProductExcelService) {}
  @Get() @RequirePermission('product.view') list(@CurrentUser() u: RequestUser, @Query() q: ProductQueryDto) { return this.svc.list(u, q); }
  @Get('search') @RequirePermission('product.view') search(@CurrentUser() u: RequestUser, @Query('q') q = '', @Query('warehouseId') warehouseId?: string) { return this.svc.quickSearch(u, q, warehouseId); }
  @Get('by-barcode/:barcode') @RequirePermission('product.view') byBarcode(@CurrentUser() u: RequestUser, @Param('barcode') barcode: string) { return this.svc.byBarcode(u, barcode); }
  @Get('export') @RequirePermission('product.export') async export(@CurrentUser() u: RequestUser, @Res() res: Response) {
    const buf = await this.excel.export(u);
    res.setHeader('Content-Type', XLSX); res.setHeader('Content-Disposition', 'attachment; filename="hang-hoa.xlsx"'); res.send(buf);
  }
  @Get('import-template') @RequirePermission('product.import') async template(@Res() res: Response) {
    const buf = await this.excel.template();
    res.setHeader('Content-Type', XLSX); res.setHeader('Content-Disposition', 'attachment; filename="mau-nhap-hang-hoa.xlsx"'); res.send(buf);
  }
  @Post('import') @RequirePermission('product.import') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data') @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  import(@CurrentUser() u: RequestUser, @UploadedFile() file?: { buffer: Buffer; originalname: string }) {
    if (!file?.buffer) throw Errors.validation('Thiếu file xlsx');
    return this.excel.import(u, file.buffer);
  }
  @Get(':id') @RequirePermission('product.view') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() @RequirePermission('product.create') create(@CurrentUser() u: RequestUser, @Body() dto: CreateProductDto) { return this.svc.create(u, dto); }
  @Patch(':id') @RequirePermission('product.update') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) { return this.svc.update(u, id, dto); }
  @Post(':id/deactivate') @RequirePermission('product.update') @HttpCode(200) deactivate(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setActive(u, id, false); }
  @Post(':id/activate') @RequirePermission('product.update') @HttpCode(200) activate(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.setActive(u, id, true); }
  @Delete(':id') @RequirePermission('product.delete') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u, id); }
}

@ApiTags('variants') @ApiBearerAuth() @Controller('variants')
export class VariantsController {
  constructor(private readonly svc: ProductsService) {}
  @Get(':id/batches') @RequirePermission('product.view') batches(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.listBatches(u, id); }
  @Post(':id/batches') @RequirePermission('product.update') createBatch(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateBatchDto) { return this.svc.createBatch(u, id, dto); }
}

@ApiTags('price-books') @ApiBearerAuth() @Controller('price-books') @RequirePermission('pricebook.manage')
export class PriceBooksController {
  constructor(private readonly svc: PriceBooksService) {}
  @Get() list() { return this.svc.list(); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }
  @Post() create(@CurrentUser() u: RequestUser, @Body() dto: CreatePriceBookDto) { return this.svc.create(u, dto); }
  @Patch(':id') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePriceBookDto) { return this.svc.update(u, id, dto); }
  @Put(':id/items') setItems(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPriceBookItemsDto) { return this.svc.setItems(u, id, dto.items); }
}
