import { API_ERROR_CODES, PUBLISHING_CHECKPOINTS, type ApiErrorCode, type PublishingCheckpoint } from '@company/contracts';

const names = ['HTTP_COMPLETED', 'RELEASE_CLAIMED', 'RELEASE_STAGE', 'RELEASE_FAILED', 'WORKER_UNAVAILABLE'] as const;
type Event = { event: typeof names[number]; requestId?: string; taskId?: string; stage?: PublishingCheckpoint;
  attempt?: number; durationMs?: number; code?: ApiErrorCode; status?: number; outcome?: 'success' | 'failure' };
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;

/** No free-form message, URL, user identifier, header or payload is ever serialized. */
export class PlatformEvents {
  constructor(private readonly sink: (line: string) => void = line => console.log(line)) {}
  emit(input: Event): void {
    if (!names.includes(input.event)) return;
    const safe: Record<string, string | number> = { timestamp: new Date().toISOString(), event: input.event };
    for (const key of ['requestId', 'taskId'] as const) if (uuid(input[key])) safe[key] = input[key];
    if (input.stage && PUBLISHING_CHECKPOINTS.includes(input.stage)) safe.stage = input.stage;
    if (input.code && API_ERROR_CODES.includes(input.code)) safe.code = input.code;
    for (const key of ['attempt', 'durationMs'] as const) if (number(input[key])) safe[key] = input[key];
    if (Number.isInteger(input.status) && input.status! >= 100 && input.status! <= 599) safe.status = input.status!;
    if (input.outcome === 'success' || input.outcome === 'failure') safe.outcome = input.outcome;
    try { this.sink(JSON.stringify(safe)); } catch { /* Observability must not change publishing outcomes. */ }
  }
}
