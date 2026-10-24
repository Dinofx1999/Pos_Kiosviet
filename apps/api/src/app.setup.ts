import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { uploadRoot, UPLOAD_URL_PREFIX } from './modules/uploads/uploads.service';

/** Shared HTTP configuration for the real server and the integration-test app. */
export function configureApp(app: NestExpressApplication) {
  const prefix = process.env.API_PREFIX ?? 'api';
  app.setGlobalPrefix(prefix);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true, transformOptions: { enableImplicitConversion: false } }));
  app.set('trust proxy', 1);
  app.enableCors({ origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()), credentials: true, exposedHeaders: ['Idempotent-Replayed', 'Content-Disposition'] });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // uploaded product images (local disk); behind nginx the same prefix is proxied to the API
  app.useStaticAssets(uploadRoot(), { prefix: `${UPLOAD_URL_PREFIX}/`, maxAge: '7d', index: false, dotfiles: 'deny' });
  app.enableShutdownHooks();
  return app;
}
