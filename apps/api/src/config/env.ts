import { plainToInstance } from 'class-transformer';
import { IsInt, IsOptional, IsString, MinLength, validateSync } from 'class-validator';

export class EnvConfig {
  @IsString() DATABASE_URL: string;
  @IsOptional() @IsString() DATABASE_URL_TEST?: string;
  @IsOptional() @IsString() REDIS_URL: string = 'redis://localhost:6379';
  @IsOptional() @IsInt() API_PORT: number = 3000;
  @IsOptional() @IsString() API_PREFIX: string = 'api';
  @IsOptional() @IsString() CORS_ORIGINS: string = 'http://localhost:5173';
  @IsString() @MinLength(16) JWT_ACCESS_SECRET: string;
  @IsOptional() @IsInt() JWT_ACCESS_TTL: number = 900;
  @IsOptional() @IsInt() JWT_REFRESH_TTL_DAYS: number = 30;
  @IsOptional() @IsString() LOG_LEVEL: string = 'info';
  @IsOptional() @IsInt() OUTBOX_POLL_INTERVAL_MS: number = 2000;
  @IsOptional() @IsString() NODE_ENV: string = 'development';
  @IsOptional() @IsString() UPLOAD_DIR: string = './uploads';
}

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const validated = plainToInstance(EnvConfig, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false, whitelist: false });
  if (errors.length > 0) {
    throw new Error('Invalid environment: ' + errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; '));
  }
  return validated;
}
