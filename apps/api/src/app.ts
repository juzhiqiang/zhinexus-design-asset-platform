import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { Platform, environmentOptions, type PlatformOptions } from './platform.js';
import { ErrorFilter, PlatformController } from './http.js';

export async function buildServer(options: PlatformOptions = environmentOptions()): Promise<INestApplication> {
  const platform = new Platform(options);
  @Module({ imports: [AppModule], controllers: [PlatformController], providers: [{ provide: Platform, useValue: platform }] })
  class ConfiguredModule {}
  try {
    const app = await NestFactory.create<NestExpressApplication>(ConfiguredModule, { logger: false, abortOnError: false, bodyParser: false });
    app.use((request: { requestId?: string }, response: { setHeader(name: string, value: string): void }, next: () => void) => {
      request.requestId = randomUUID(); response.setHeader('X-Request-Id', request.requestId);
      response.setHeader('X-Content-Type-Options', 'nosniff'); next();
    });
    app.useBodyParser('json', { limit: '8mb', strict: true });
    app.useGlobalFilters(new ErrorFilter());
    return app;
  } catch (error) { await platform.onApplicationShutdown(); throw error; }
}
