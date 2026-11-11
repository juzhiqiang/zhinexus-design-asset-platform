import { getInstanceByDom, init } from 'echarts/core.js';
import type { EChartsType } from 'echarts/core.js';
import type { Renderer } from '../types.js';

/**
 * 客户端守卫：SSR 宿主只允许安全导入本模块，不得创建图表实例（架构 §6）。
 * 模块顶层不访问 window / document，本函数只在实例化路径上调用。
 */
export function assertClient(context: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error(`${context} 只能在浏览器客户端执行；SSR 宿主仅安全导入，图表在客户端挂载后创建`);
  }
}

/**
 * 在宿主上创建 ECharts 实例。
 * 若宿主残留旧实例先销毁，避免 KeepAlive / StrictMode 重挂载产生双实例。
 */
export function initChartInstance(
  host: HTMLElement,
  renderer: Renderer,
  size?: { width?: number; height?: number },
): EChartsType {
  assertClient('initChartInstance');
  const existing = getInstanceByDom(host);
  existing?.dispose();
  return init(host, null, {
    renderer,
    width: size?.width,
    height: size?.height,
  });
}

/** 销毁实例；null 安全，可重复调用。 */
export function disposeChartInstance(instance: EChartsType | null): void {
  instance?.dispose();
}
