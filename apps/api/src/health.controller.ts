import { Controller, Get } from '@nestjs/common';
import type { BootstrapHealth } from '@company/contracts';
import { HealthService } from './health.service.js';

@Controller('healthz')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  getHealth(): BootstrapHealth {
    return this.health.getHealth();
  }
}
