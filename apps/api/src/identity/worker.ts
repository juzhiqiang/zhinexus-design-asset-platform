import { randomUUID } from 'node:crypto';
import type { ManagedAccountsService } from '../accounts/service.js';

/**
 * Identity operations are processed outside the request lifecycle, serialised per account by the
 * database, and recoverable after a restart. Network work never runs inside a transaction.
 */
export class IdentityWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly accounts: ManagedAccountsService, private readonly options: { intervalMs?: number; leaseSeconds?: number; batch?: number } = {}) {}
  get active(): boolean { return this.timer !== undefined; }
  async tick(): Promise<{ processed: number; failed: number }> {
    if (this.running) return { processed: 0, failed: 0 };
    this.running = true;
    const owner = randomUUID();
    let processed = 0, failed = 0;
    try {
      await this.accounts.releaseExpiredOperations();
      const batch = this.options.batch ?? 8;
      for (const operation of await this.accounts.claimOperations(owner, batch, this.options.leaseSeconds ?? 120)) {
        try { await this.accounts.processOperation(operation); processed += 1; }
        catch { failed += 1; }
      }
    } finally { this.running = false; }
    return { processed, failed };
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick().catch(() => {}); }, this.options.intervalMs ?? 2000);
    this.timer.unref?.();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
}
