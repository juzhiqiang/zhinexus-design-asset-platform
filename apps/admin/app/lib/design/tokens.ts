/**
 * management-api.pen 设计变量（唯一事实来源）。
 *
 * 这里的 26 个变量与 `docs/design/management-api.pen` 的 `variables` 段逐值一致，
 * 并与 `app/globals.css` 的 `:root` 一一对应；`tests/admin/design-system.test.ts`
 * 会同时断言这两边，任一侧改动都必须同步另一侧。
 */

/** 23 个颜色变量。 */
export const ZN_COLOR_TOKENS = {
  'zn-bg': '#111A20',
  'zn-surface': '#1A2D35C2',
  'zn-sidebar': '#121F27E3',
  'zn-sidebar-raised': '#20343EBF',
  'zn-text': '#F4F9F8',
  'zn-muted': '#B6C8CC',
  'zn-subtle': '#7E99A1',
  'zn-border': '#DAF2F316',
  'zn-border-strong': '#D6F2F333',
  'zn-accent': '#A3D2FF',
  'zn-accent-soft': '#315B756B',
  'zn-success': '#79E7BF',
  'zn-success-soft': '#2457486B',
  'zn-warning': '#FFC98A',
  'zn-warning-soft': '#6047285C',
  'zn-danger': '#FF8E95',
  'zn-danger-soft': '#662E385C',
  'zn-gold': '#B5D0F7',
  'zn-gold-soft': '#38516F66',
  'zn-table-alt': '#20343D9C',
  'zn-glass': '#1B2E37A8',
  'zn-glass-strong': '#243B45CA',
  'zn-grid': '#8CCFFF08',
} as const;

/** 3 个字体变量。 */
export const ZN_FONT_TOKENS = {
  'zn-font': 'Noto Sans SC',
  'zn-mono': 'IBM Plex Mono',
  'zn-display': 'Manrope',
} as const;

/** 全部 26 个设计变量。 */
export const ZN_TOKENS = { ...ZN_COLOR_TOKENS, ...ZN_FONT_TOKENS } as const;

export type ZnTokenName = keyof typeof ZN_TOKENS;

/** 与 `.pen` 变量段等价的 CSS 自定义属性声明，供注入或对账使用。 */
export const ZN_TOKEN_DECLARATIONS: Record<ZnTokenName, string> = Object.fromEntries(
  Object.entries(ZN_TOKENS).map(([name, value]) => [name, `--${name}: ${value};`]),
) as Record<ZnTokenName, string>;

/**
 * 本地优先字体栈：设计稿声明字体族，但后台只在内网运行，
 * 不引入外网字体请求，缺字体时回退到系统等宽/无衬线栈。
 */
export const ZN_FONT_STACKS = {
  sans: '"Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono: '"IBM Plex Mono", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  display: '"Manrope", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
} as const;

/** 主按钮渐变（.pen Component · Button Primary / Enable Revision 等共用）。 */
export const ZN_PRIMARY_GRADIENT = 'linear-gradient(105deg, #9AD7FF 0%, #7BE4C6 100%)';
/** 头像渐变（.pen User Avatar）。 */
export const ZN_AVATAR_GRADIENT = 'linear-gradient(135deg, #9DD8FF 0%, #79E2C4 100%)';
/** 玻璃面板渐变（.pen 各处 `#172832A3` + 145° 高光）。 */
export const ZN_PANEL_GRADIENT =
  'linear-gradient(145deg, rgba(215, 247, 244, 0.067) 0%, rgba(163, 210, 255, 0.031) 48%, rgba(121, 231, 191, 0.043) 100%), #172832A3';
/** 指标卡渐变（.pen Metric · *）。 */
export const ZN_METRIC_GRADIENT =
  'linear-gradient(145deg, rgba(239, 255, 255, 0.075) 0%, rgba(163, 210, 255, 0.031) 52%, rgba(121, 231, 191, 0.043) 100%), #203741B5';
/** 侧栏渐变（.pen App Sidebar，两层径向高光叠加在 zn-sidebar 上）。 */
export const ZN_SIDEBAR_GRADIENT =
  'radial-gradient(130% 90% at 18% 12%, rgba(140, 207, 255, 0.122) 0%, rgba(17, 29, 39, 0) 72%), radial-gradient(110% 80% at 75% 88%, rgba(120, 231, 194, 0.078) 0%, rgba(17, 29, 39, 0) 72%), #121F27E3';
/** 侧栏左缘光谱轨（.pen Sidebar Spectral Rail）。 */
export const ZN_SPECTRAL_RAIL_GRADIENT =
  'linear-gradient(180deg, rgba(140, 207, 255, 0) 0%, rgba(140, 207, 255, 0.439) 38%, rgba(120, 231, 194, 0.376) 72%, rgba(120, 231, 194, 0) 100%)';
