import Fastify from 'fastify';
import type { BootstrapHealth } from '@company/contracts';

export function buildServer() {
  const app = Fastify({ logger: false });
  app.get('/healthz', (): BootstrapHealth => ({ status: 'ok', service: 'preview-gateway', stage: 'bootstrap' }));
  return app;
}
