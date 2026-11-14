import { expect, it } from 'vitest';
import { localServices } from '../platform/support.js';

it('refuses unconfigured platform services instead of reading shared credentials and fixed ports', () => {
  expect(() => localServices()).toThrow('Isolated platform services were not provided by the test runner');
});
