/*
 * 框架无关的 charts-core 生命周期验收夹具（T02）。
 * 仅服务于 tests/browser/core-lifecycle.spec.ts，不属于对外 SDK 表面。
 */
import { createChartController } from '@company/charts-core';
import type {
  ChartConfig,
  ChartController,
  ChartData,
  Renderer,
  ThemeName,
} from '@company/charts-core';

export type CoreHarness = {
  create(host: HTMLElement, config?: ChartConfig): void;
  update(data: ChartData): void;
  setPresentation(theme: ThemeName, renderer: Renderer): void;
  whenRendered(): Promise<void>;
  hasInstance(): boolean;
  seriesIds(): string[];
  dispose(): void;
};

declare global {
  interface Window {
    __CORE_HARNESS__?: CoreHarness;
  }
}

let controller: ChartController | null = null;

window.__CORE_HARNESS__ = {
  create: (host, config) => {
    controller?.dispose();
    controller = createChartController(host, config);
  },
  update: (data) => {
    controller?.update(data);
  },
  setPresentation: (theme, renderer) => {
    controller?.setPresentation(theme, renderer);
  },
  whenRendered: () => controller?.whenRendered() ?? Promise.resolve(),
  hasInstance: () => controller?.getInstance() != null,
  seriesIds: () => {
    const option = controller?.getInstance()?.getOption() as { series?: { id?: string }[] } | undefined;
    return option?.series?.map((series) => series.id ?? '') ?? [];
  },
  dispose: () => {
    controller?.dispose();
    controller = null;
  },
};
