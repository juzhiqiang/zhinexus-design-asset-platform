export interface ConsumerOwner {
  kind: 'c-owned-t10-consumers-v1';
  runId: string;
  externalBase: string;
  consumerRoot: string;
  repoRoot: string;
  createdAt: string;
}

interface OwnedConsumerReport {
  probe: { command: string[] };
  combinations: Array<{ framework: string; consumer: { root: string; kept: boolean } }>;
}

export function createOwnedRoot(ownerFile: string, repoRoot: string): Promise<ConsumerOwner>;
export function validateOwnedConsumers(ownerFile: string, report: OwnedConsumerReport, repoRoot: string): Promise<{
  owner: ConsumerOwner;
  consumers: Array<{ framework: string; root: string; staging: string }>;
}>;
export function cleanupOwnedPair(ownerFile: string, report: OwnedConsumerReport, repoRoot: string): Promise<void>;
