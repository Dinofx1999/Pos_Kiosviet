import { Body, Controller, Delete, Get, HttpCode, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequirePermission } from '../../common/decorators';
import { RequestUser } from '../../infra/cls/request-context';
import { AttendanceQueryDto, CheckInDto, CheckOutDto, CreateCommissionRuleDto, EditAttendanceDto, EmployeeQueryDto, ManualAttendanceDto, PeriodQueryDto, UpdateCommissionRuleDto } from './dto/employees.dto';
import { EmployeesService } from './employees.service';

@ApiTags('employees') @ApiBearerAuth() @Controller('employees')
export class EmployeesController {
  constructor(private readonly svc: EmployeesService) {}
  @Get() @RequirePermission('attendance.view') list(@CurrentUser() u: RequestUser, @Query() q: EmployeeQueryDto) { return this.svc.list(u, q); }
  // hoa hồng
  @Get('commission-rules') @RequirePermission('commission.view') rules(@Query('includeInactive', new ParseBoolPipe({ optional: true })) inactive?: boolean) { return this.svc.listRules(inactive ?? false); }
  @Post('commission-rules') @RequirePermission('employee.manage') createRule(@CurrentUser() u: RequestUser, @Body() dto: CreateCommissionRuleDto) { return this.svc.createRule(u, dto); }
  @Patch('commission-rules/:id') @RequirePermission('employee.manage') updateRule(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommissionRuleDto) { return this.svc.updateRule(u, id, dto); }
  @Delete('commission-rules/:id') @RequirePermission('employee.manage') @HttpCode(204) async removeRule(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string) { await this.svc.removeRule(u, id); }
  @Get('commissions') @RequirePermission('commission.view') @ApiOperation({ summary: 'Hoa hồng theo kỳ cho từng nhân viên bán (quy tắc cụ thể nhất thắng)' }) commissions(@CurrentUser() u: RequestUser, @Query() q: PeriodQueryDto) { return this.svc.commissions(u, q); }
  @Get('commissions/me') @ApiOperation({ summary: 'Hoa hồng của chính mình' }) myCommission(@CurrentUser() u: RequestUser, @Query() q: PeriodQueryDto) { return this.svc.commissions(u, { ...q, userId: u.id }); }
  // chấm công
  @Post('attendance/check-in') @HttpCode(201) checkIn(@CurrentUser() u: RequestUser, @Body() dto: CheckInDto) { return this.svc.checkIn(u, dto); }
  @Post('attendance/check-out') @HttpCode(200) checkOut(@CurrentUser() u: RequestUser, @Body() dto: CheckOutDto) { return this.svc.checkOut(u, dto); }
  @Get('attendance/current') current(@CurrentUser() u: RequestUser) { return this.svc.current(u); }
  @Get('attendance/me') mine(@CurrentUser() u: RequestUser, @Query() q: AttendanceQueryDto) { return this.svc.listAttendance(u, q, true); }
  @Get('attendance') @RequirePermission('attendance.view') attendance(@CurrentUser() u: RequestUser, @Query() q: AttendanceQueryDto) { return this.svc.listAttendance(u, q, false); }
  @Post('attendance') @RequirePermission('employee.manage') @HttpCode(201) @ApiOperation({ summary: 'Chấm công hộ / bổ sung' }) manual(@CurrentUser() u: RequestUser, @Body() dto: ManualAttendanceDto) { return this.svc.manualAttendance(u, dto); }
  @Patch('attendance/:id') @RequirePermission('employee.manage') edit(@CurrentUser() u: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditAttendanceDto) { return this.svc.editAttendance(u, id, dto); }
  // hiệu suất
  @Get('performance') @RequirePermission('attendance.view') @ApiOperation({ summary: 'Hiệu suất nhân viên: doanh thu, lợi nhuận gộp, ca, chênh lệch tiền mặt, giờ công, hoa hồng' }) performance(@CurrentUser() u: RequestUser, @Query() q: PeriodQueryDto) { return this.svc.performance(u, q); }
}
