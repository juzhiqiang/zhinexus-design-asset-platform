import { version } from 'echarts/core.js';

/** Bootstrap probe only; the chart controller belongs to T02. */
export function getCoreRuntimeInfo() {
  return { stage: 'bootstrap', echartsVersion: version } as const;
}
