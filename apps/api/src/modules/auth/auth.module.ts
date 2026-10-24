import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => ({ secret: process.env.JWT_ACCESS_SECRET, signOptions: { issuer: 'retail-erp' } }) })],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
