import { Injectable } from '@nestjs/common';
import type { BootstrapHealth } from '@company/contracts';

@Injectable()
export class HealthService {
  getHealth(): BootstrapHealth {
    return { status: 'ok', service: 'preview-gateway', stage: 'bootstrap' };
  }
}
