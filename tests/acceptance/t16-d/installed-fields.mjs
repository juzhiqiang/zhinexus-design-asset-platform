// tests/acceptance/t16-d/installed-fields.mjs
import { checkFieldCases } from './installed-field-cases.mjs';
import { checkStale } from './installed-stale.mjs';

export async function checkFields(ctx) {
  await checkFieldCases(ctx);
  await checkStale(ctx);
}
