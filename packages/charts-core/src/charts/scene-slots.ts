import type { ChartTheme } from '../theme.js';

/** 空数据 / 无可用值 / 总量不可算时的大字段落；趋势卡片与占比场景共用同一口径。 */
export const EMPTY_DISPLAY = '暂无数据';

/** graphic 文本元素（组合场景摘要）：位置用像素锚定，样式为纯可序列化值。 */
export type SceneTextElement = {
  type: 'text';
  id: string;
  left: number;
  top: number;
  z: number;
  /** 槽位隐藏标记：固定槽位 + ignore，避免状态切换残留上一次文本，也避免移除不存在元素报错。 */
  ignore?: boolean;
  style: {
    text: string;
    fontSize?: number;
    fontWeight?: number;
    fill?: string;
    rich?: Record<string, { color: string; fontSize: number; fontWeight?: number }>;
  };
};

/** 摘要文本左侧锚点：与图表网格左边距对齐，避免贴边。 */
export const SLOT_LEFT = 16;

/** 摘要文本层级：高于系列与坐标轴，低于 tooltip。 */
export const SLOT_Z = 10;

/**
 * 可见文本槽位。`ignore` 必须显式为 false：控制器首次 applyOption 时数据尚为空
 * （槽位为 ignore: true），随后 update 才填入数据；ECharts 按 id 合并 graphic 元素，
 * 若可见槽位不显式声明 ignore: false，合并后会保留上一次的 ignore: true 而不渲染。
 */
export function textSlot(
  id: string,
  top: number,
  style: SceneTextElement['style'],
): SceneTextElement {
  return { type: 'text', id, left: SLOT_LEFT, top, z: SLOT_Z, ignore: false, style };
}

/**
 * 隐藏槽位：固定 id + `ignore`。每个场景的槽位每次构建都完整给出，
 * 未使用的槽位 ignore 隐藏——既不会残留上一次渲染的文本，
 * 也不会像 `$action: 'remove'` 那样在首次渲染移除不存在元素时抛错。
 */
export function hiddenSlot(id: string, top: number): SceneTextElement {
  return { type: 'text', id, left: SLOT_LEFT, top, z: SLOT_Z, ignore: true, style: { text: '' } };
}

/** 场景摘要 muted 色（按主题区分，不依赖运行 locale，保证截图可复现）。 */
export function mutedColor(theme: ChartTheme): string {
  return theme.name === 'dark' ? '#94a8b8' : '#64748b';
}
