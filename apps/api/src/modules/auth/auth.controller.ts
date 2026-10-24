import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public } from '../../common/decorators';
import { RequestUser } from '../../infra/cls/request-context';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshDto, RegisterTenantDto } from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('register-tenant') @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Đăng ký gian hàng mới (tạo tenant + chi nhánh + kho + admin)' })
  register(@Body() dto: RegisterTenantDto) { return this.auth.registerTenant(dto); }

  @Public() @Post('login') @HttpCode(200) @Throttle({ default: { limit: 10, ttl: 60000 } })
  login(@Body() dto: LoginDto) { return this.auth.login(dto); }

  @Public() @Post('refresh') @HttpCode(200)
  refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto.refreshToken); }

  @Public() @Post('logout') @HttpCode(204)
  async logout(@Body() dto: RefreshDto) { await this.auth.logout(dto.refreshToken); }

  @Get('me') @ApiBearerAuth()
  me(@CurrentUser() user: RequestUser) { return this.auth.me(user); }

  @Post('change-password') @HttpCode(204) @ApiBearerAuth()
  async changePassword(@CurrentUser() user: RequestUser, @Body() dto: ChangePasswordDto) { await this.auth.changePassword(user, dto); }
}
