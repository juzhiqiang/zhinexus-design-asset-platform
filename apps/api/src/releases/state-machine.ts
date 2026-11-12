import { PUBLISHING_CHECKPOINTS, type PublishingCheckpoint } from '@company/contracts';
import { PlatformError } from '../errors.js';

export function requireCheckpoint(stage: string): PublishingCheckpoint {
  if (!(PUBLISHING_CHECKPOINTS as readonly string[]).includes(stage)) throw new PlatformError('INVALID_SCHEMA');
  return stage as PublishingCheckpoint;
}
