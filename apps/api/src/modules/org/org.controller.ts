import { Body, Controller, Delete, Get, HttpCode, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { RequestUser } from '../../infra/cls/request-context';
import { AuditQueryService } from './audit-query.service';
import { BranchesService } from './branches.service';
import { AuditQueryDto, CreateBranchDto, CreateRoleDto, CreateUserDto, CreateWarehouseDto, ResetPasswordDto, UpdateBranchDto, UpdateRoleDto, UpdateSequencesDto, UpdateSettingsDto, UpdateUserDto, UpdateWarehouseDto, UserQueryDto } from './dto/org.dto';
import { RolesService } from './roles.service';
import { SettingsService } from './settings.service';
import { UsersService } from './users.service';

@ApiTags('branches') @ApiBearerAuth() @Controller('branches')
export class BranchesController {
  constructor(private readonly svc: BranchesService) {}
  @Get() list(@CurrentUser() u: RequestUser, @Query('includeInactive', new ParseBoolPipe({ optional: true })) inactive?: boolean) { return this.svc.listBranches(u, inactive ?? false); }
  @Post() @RequirePermission('branch.manage') create(@CurrentUser() u: RequestUser, @Body() dto: CreateBranchDto) { return this.svc.createBranch(u, dto); }
  @Patch(':id') @RequirePermission('branch.manage') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBranchDto) { return this.svc.updateBranch(u, id, dto); }
}

@ApiTags('warehouses') @ApiBearerAuth() @Controller('warehouses')
export class WarehousesController {
  constructor(private readonly svc: BranchesService) {}
  @Get() list(@CurrentUser() u: RequestUser, @Query('branchId') branchId?: string, @Query('includeInactive', new ParseBoolPipe({ optional: true })) inactive?: boolean, @Query('scope') scope?: string) { return this.svc.listWarehouses(u, branchId, inactive ?? false, scope === 'all' ? 'all' : 'mine'); }
  @Post() @RequirePermission('warehouse.manage') create(@CurrentUser() u: RequestUser, @Body() dto: CreateWarehouseDto) { return this.svc.createWarehouse(u, dto); }
  @Patch(':id') @RequirePermission('warehouse.manage') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarehouseDto) { return this.svc.updateWarehouse(u, id, dto); }
}

@ApiTags('users') @ApiBearerAuth() @Controller('users') @RequirePermission('user.manage')
export class UsersController {
  constructor(private readonly svc: UsersService) {}
  @Get() list(@CurrentUser() u: RequestUser, @Query() q: UserQueryDto) { return this.svc.list(u, q); }
  @Get(':id') get(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.get(u, id); }
  @Post() create(@CurrentUser() u: RequestUser, @Body() dto: CreateUserDto) { return this.svc.create(u, dto); }
  @Patch(':id') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) { return this.svc.update(u, id, dto); }
  @Post(':id/reset-password') @HttpCode(204) async reset(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto) { await this.svc.resetPassword(u, id, dto); }
}

@ApiTags('roles') @ApiBearerAuth() @Controller('roles') @RequirePermission('role.manage')
export class RolesController {
  constructor(private readonly svc: RolesService) {}
  @Get('permissions') permissions() { return this.svc.permissionCatalog(); }
  @Get() list() { return this.svc.list(); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.svc.get(id); }
  @Post() create(@CurrentUser() u: RequestUser, @Body() dto: CreateRoleDto) { return this.svc.create(u, dto); }
  @Patch(':id') update(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) { return this.svc.update(u, id, dto); }
  @Delete(':id') @HttpCode(204) async remove(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.remove(u, id); }
}

@ApiTags('settings') @ApiBearerAuth() @Controller('settings') @RequirePermission('tenant.settings.manage')
export class SettingsController {
  constructor(private readonly svc: SettingsService) {}
  @Get() get() { return this.svc.getAll(); }
  @Put() update(@CurrentUser() u: RequestUser, @Body() dto: UpdateSettingsDto) { return this.svc.update(u, dto.settings ?? {}); }
  @Get('sequences') sequences() { return this.svc.listSequences(); }
  @Put('sequences') updateSequences(@CurrentUser() u: RequestUser, @Body() dto: UpdateSequencesDto) { return this.svc.updateSequences(u, dto.items); }
}

@ApiTags('audit') @ApiBearerAuth() @Controller() @RequirePermission('audit.view')
export class AuditController {
  constructor(private readonly svc: AuditQueryService) {}
  @Get('audit-logs') logs(@Query() q: AuditQueryDto) { return this.svc.auditLogs(q); }
  @Get('login-history') logins(@Query() q: AuditQueryDto) { return this.svc.loginHistory(q); }
}
