import type { ThemeName } from './types.js';

/** 主题令牌：调色板与坐标轴/文本颜色；背景保持透明，由宿主页面决定。 */
export type ChartTheme = {
  name: ThemeName;
  palette: string[];
  textColor: string;
  axisLineColor: string;
  splitLineColor: string;
};

export const lightTheme: ChartTheme = {
  name: 'light',
  palette: [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#14b8a6', '#f97316', '#64748b',
  ],
  textColor: '#263044',
  axisLineColor: '#cbd5e1',
  splitLineColor: '#e2e8f0',
};

export const darkTheme: ChartTheme = {
  name: 'dark',
  palette: [
    '#60a5fa', '#34d399', '#fbbf24', '#f87171',
    '#a78bfa', '#2dd4bf', '#fb923c', '#94a3b8',
  ],
  textColor: '#e2e8f0',
  axisLineColor: '#475569',
  splitLineColor: '#334155',
};

export function resolveTheme(name: ThemeName = 'light'): ChartTheme {
  return name === 'dark' ? darkTheme : lightTheme;
}
