import { version } from 'react';
import { getCoreRuntimeInfo } from '@company/charts-core';

/** Bootstrap probe only; React components and lifecycle support belong to T03. */
export function getReactRuntimeInfo() {
  return { ...getCoreRuntimeInfo(), framework: 'react', frameworkVersion: version } as const;
}
