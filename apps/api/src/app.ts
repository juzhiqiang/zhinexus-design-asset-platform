import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { Platform, environmentOptions, type PlatformOptions } from './platform.js';
import { ErrorFilter, PlatformController } from './http.js';
import { CatalogController } from './catalog/routes.js';
import { CompatibilityController } from './compatibility/controller.js';
import { SearchController } from './search/routes.js';
import { MatchingController } from './matching/routes.js';
import { ComponentQueryController } from './matching/component-query-routes.js';
import { MetricsController } from './observability/http.js';
import type { ServerResponse } from 'node:http';
import { AccessSettingsController } from './access/routes.js';
import { CompanyAuthController } from './access/auth-routes.js';
import { ManagedAccountsController } from './accounts/routes.js';
import { audit } from './db/access.js';

export async function buildServer(options: PlatformOptions = environmentOptions()): Promise<INestApplication> {
  const platform = new Platform(options);
  @Module({ imports: [AppModule], controllers: [PlatformController, CatalogController, CompatibilityController, MetricsController, SearchController, MatchingController, ComponentQueryController, AccessSettingsController, CompanyAuthController, ManagedAccountsController], providers: [{ provide: Platform, useValue: platform }] })
  class ConfiguredModule {}
  try {
    await platform.requireAccessConfiguration();
    const app = await NestFactory.create<NestExpressApplication>(ConfiguredModule, { logger: false, abortOnError: false, bodyParser: false });
    app.use((request: { requestId?: string }, response: ServerResponse, next: () => void) => {
      request.requestId = randomUUID(); response.setHeader('X-Request-Id', request.requestId);
      const start = performance.now();
      response.once('finish', () => platform.events.emit({ event: 'HTTP_COMPLETED', requestId: request.requestId,
        status: response.statusCode, durationMs: performance.now() - start }));
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff'); next();
    });
    app.use(async (request:{headers:Record<string,string | undefined>;method:string;requestId:string},response:ServerResponse,next:() => void) => {
      const values = (request.headers.cookie ?? '').split(';').map(v=>v.trim()).filter(v=>v.startsWith('__Host-platform='));
      if (values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0]!.slice(16))) {
        if (!['GET','HEAD','OPTIONS'].includes(request.method) && !platform.allowsWebOrigin(request.headers.origin)) {
          if(platform.db)await audit(platform.db,undefined,'AUTH_DENIED','oidc-csrf',{code:'FORBIDDEN'},request.requestId).catch(()=>{});
          response.statusCode=403;response.end();return;
        }
        if (!request.headers.authorization || request.headers.authorization === 'Bearer __session__') request.headers.authorization = 'Session '+values[0]!.slice(16);
      }
      next();
    });
    app.enableCors({
      origin: (origin, callback) => callback(null, platform.allowsWebOrigin(origin)),
      methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
      exposedHeaders: ['X-Request-Id'], credentials: Boolean(platform.access),
    });
    app.useBodyParser('json', { limit: '8mb', strict: true });
    app.useGlobalFilters(new ErrorFilter());
    platform.identityWorker?.start();
    return app;
  } catch (error) { await platform.onApplicationShutdown(); throw error; }
}
