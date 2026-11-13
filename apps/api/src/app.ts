import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { Platform, environmentOptions, type PlatformOptions } from './platform.js';
import { ErrorFilter, PlatformController } from './http.js';
import { CatalogController } from './catalog/routes.js';
import { MetricsController } from './observability/http.js';
import type { ServerResponse } from 'node:http';

export async function buildServer(options: PlatformOptions = environmentOptions()): Promise<INestApplication> {
  const platform = new Platform(options);
  @Module({ imports: [AppModule], controllers: [PlatformController, CatalogController, MetricsController], providers: [{ provide: Platform, useValue: platform }] })
  class ConfiguredModule {}
  try {
    const app = await NestFactory.create<NestExpressApplication>(ConfiguredModule, { logger: false, abortOnError: false, bodyParser: false });
    app.use((request: { requestId?: string }, response: ServerResponse, next: () => void) => {
      request.requestId = randomUUID(); response.setHeader('X-Request-Id', request.requestId);
      const start = performance.now();
      response.once('finish', () => platform.events.emit({ event: 'HTTP_COMPLETED', requestId: request.requestId,
        status: response.statusCode, durationMs: performance.now() - start }));
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff'); next();
    });
    if (platform.galleryOrigin) app.enableCors({
      origin: (origin, callback) => callback(null, origin === platform.galleryOrigin),
      methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id'], credentials: false,
    });
    app.useBodyParser('json', { limit: '8mb', strict: true });
    app.useGlobalFilters(new ErrorFilter());
    return app;
  } catch (error) { await platform.onApplicationShutdown(); throw error; }
}
