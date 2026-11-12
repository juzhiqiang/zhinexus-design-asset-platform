import type { UnitSpec } from './types.js';

/** 缺失值统一展示符；tooltip 与坐标轴共用，保证截图一致。 */
export const MISSING_VALUE_DISPLAY = '-';

/**
 * 数值格式化：千分位分组 + 固定小数位 + 单位后缀。
 * 规则确定且不依赖运行 locale（不使用 toLocaleString），保证不同机器截图一致。
 * null / undefined / NaN 一律返回缺失值展示符，禁止渲染成 0。
 */
export function formatValue(value: number | null | undefined, unit?: UnitSpec): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return MISSING_VALUE_DISPLAY;
  }
  const decimals = unit?.decimals ?? 0;
  const grouped = groupThousands(value.toFixed(decimals));
  return unit?.suffix ? `${grouped}${unit.suffix}` : grouped;
}

function groupThousands(fixed: string): string {
  const negative = fixed.startsWith('-');
  const body = negative ? fixed.slice(1) : fixed;
  const dotIndex = body.indexOf('.');
  const integerPart = dotIndex === -1 ? body : body.slice(0, dotIndex);
  const decimalPart = dotIndex === -1 ? '' : body.slice(dotIndex);
  let grouped = '';
  for (let index = 0; index < integerPart.length; index += 1) {
    if (index > 0 && (integerPart.length - index) % 3 === 0) {
      grouped += ',';
    }
    grouped += integerPart.charAt(index);
  }
  const result = `${grouped}${decimalPart}`;
  return negative ? `-${result}` : result;
}

/** 占比小数位：固定值，不依赖运行 locale，保证截图可复现。 */
const PERCENT_DECIMALS = 1;

/**
 * 占比格式化：`value / total` 转百分比字符串（固定 1 位小数）。
 * 总量不可算（`total <= 0`）或值缺失时返回 `null`，由调用方省略占比展示，
 * 禁止产出 `NaN%` 之类的无意义文本。
 */
export function formatPercent(value: number | null, total: number): string | null {
  if (value === null || !(total > 0)) {
    return null;
  }
  return `${((value / total) * 100).toFixed(PERCENT_DECIMALS)}%`;
}
