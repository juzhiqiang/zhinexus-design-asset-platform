import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Header, Headers, Inject } from '@nestjs/common';
import { Platform } from '../platform.js';
import { PlatformError } from '../errors.js';
import { metrics } from './metrics.js';

@Controller('internal')
export class MetricsController {
  constructor(@Inject(Platform) private readonly platform: Platform) {}
  @Get('metrics') @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async get(@Headers('authorization') auth: string | undefined): Promise<string> {
    const secret = this.platform.metricsToken;
    const digest = (s: string) => createHash('sha256').update(s).digest();
    if (!secret) throw new PlatformError('NOT_FOUND');
    if (!auth || auth.length > 1024 || !timingSafeEqual(digest(auth), digest(`Bearer ${secret}`))) throw new PlatformError('UNAUTHENTICATED');
    if (!this.platform.db) throw new PlatformError('INFRA_UNAVAILABLE');
    return metrics(this.platform.db);
  }
}
