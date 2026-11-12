import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { PreviewRuntime } from './auth.js';
import { previewHandler } from './http.js';
import { environmentOptions, type GatewayOptions } from './config.js';

export async function buildServer(options: GatewayOptions = environmentOptions()): Promise<INestApplication> {
  const runtime = new PreviewRuntime(options);
  @Module({ imports: [AppModule], providers: [{ provide: PreviewRuntime, useValue: runtime }] })
  class ConfiguredModule {}
  try {
    const app = await NestFactory.create(ConfiguredModule, { logger: false, abortOnError: false, bodyParser: false });
    app.use(previewHandler(runtime));
    return app;
  } catch (error) { await runtime.onApplicationShutdown(); throw error; }
}
