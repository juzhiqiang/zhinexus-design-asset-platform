import { expectTypeOf, it } from 'vitest';
import type { ComponentExample } from '@company/contracts';

it('keeps legacy examples compatible and permits readonly state discovery', () => {
  const legacy: ComponentExample = { ready: Promise.resolve(), async runState() {}, getChecks: () => [] };
  const discoverable: ComponentExample = { ...legacy, states: ['default', 'empty'] as const };
  expectTypeOf(discoverable.states).toEqualTypeOf<readonly string[] | undefined>();
  // @ts-expect-error State discovery contains names, never numeric indexes.
  const invalid: ComponentExample = { ...legacy, states: [1] };
  void invalid;
});
