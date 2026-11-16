import { format } from 'echarts/core.js';

/** 测量和实际标签使用同一字体，避免单位、小数位或百分比变长时超出画布。 */
export const BAR_LABEL_STYLE = {
  fontFamily: 'sans-serif',
  fontSize: 12,
  distance: 5,
} as const;

export function barLabelRightMargin(labels: readonly string[], minimum: number): number {
  const font = `${BAR_LABEL_STYLE.fontSize}px ${BAR_LABEL_STYLE.fontFamily}`;
  const widest = labels.reduce((width, text) => Math.max(width, format.getTextRect(text, font).width), 0);
  // 末端最长条形之外保留标签距离和 8px 外边距；不截断或隐藏业务数值。
  return Math.max(minimum, Math.ceil(widest) + BAR_LABEL_STYLE.distance + 8);
}
