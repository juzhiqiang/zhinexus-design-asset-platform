import type { SupportedOptionOverrides } from '../types.js';

/** 受支持的 option 覆盖字段（与 T02 折线图一致，系列/主题/渲染器不可覆盖）。 */
export const OVERRIDE_KEYS = ['grid', 'tooltip', 'legend', 'xAxis', 'yAxis', 'title'] as const;

/**
 * 深层合并受支持的 option 覆盖字段。
 * 系列由数据驱动，主题与渲染器只能通过 setPresentation 重建，均不在此合并。
 */
export function applySupportedOverrides<T>(base: T, overrides?: SupportedOptionOverrides): T {
  if (!overrides) {
    return base;
  }
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of OVERRIDE_KEYS) {
    const patch = overrides[key];
    if (patch === undefined) {
      continue;
    }
    merged[key] = deepMerge((base as Record<string, unknown>)[key], patch);
  }
  return merged as T;
}

function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = deepMerge(result[key], value);
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
