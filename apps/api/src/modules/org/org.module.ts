import { Module } from '@nestjs/common';
import { AuditQueryService } from './audit-query.service';
import { BranchesService } from './branches.service';
import { AuditController, BranchesController, RolesController, SettingsController, UsersController, WarehousesController } from './org.controller';
import { RolesService } from './roles.service';
import { SettingsService } from './settings.service';
import { UsersService } from './users.service';

@Module({
  controllers: [BranchesController, WarehousesController, UsersController, RolesController, SettingsController, AuditController],
  providers: [BranchesService, UsersService, RolesService, SettingsService, AuditQueryService],
  exports: [SettingsService, BranchesService],
})
export class OrgModule {}
