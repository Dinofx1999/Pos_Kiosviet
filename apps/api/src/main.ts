import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });
  configureApp(app);
  const prefix = process.env.API_PREFIX ?? 'api';
  const config = new DocumentBuilder().setTitle('Retail ERP API').setDescription('REST API v1 – bán hàng, kho, vận hành').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup(`${prefix}/docs`, app, SwaggerModule.createDocument(app, config), { jsonDocumentUrl: `${prefix}/docs-json` });
  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}/${prefix}/v1  (docs: /${prefix}/docs)`);
}
bootstrap();
