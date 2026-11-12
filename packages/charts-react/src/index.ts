export * from './line.js';

import { version } from 'react';
import { getCoreRuntimeInfo } from '@company/charts-core';

/** 工程骨架探针：保留以兼容既有引导验证，T03 起由 LineChart 组件取代其作用。 */
export function getReactRuntimeInfo() {
  return { ...getCoreRuntimeInfo(), framework: 'react', frameworkVersion: version } as const;
}
