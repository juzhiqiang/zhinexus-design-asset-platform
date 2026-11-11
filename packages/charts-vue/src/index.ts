import { version } from 'vue';
import { getCoreRuntimeInfo } from '@company/charts-core';

/** Bootstrap probe only; Vue components and lifecycle support belong to T03. */
export function getVueRuntimeInfo() {
  return { ...getCoreRuntimeInfo(), framework: 'vue', frameworkVersion: version } as const;
}
