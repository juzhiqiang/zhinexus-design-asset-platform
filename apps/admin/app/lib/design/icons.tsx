/**
 * 内联 SVG 图标集：键名与 `management-api.pen` 中 lucide 图层的 `icon` 名一致，
 * 几何取自 lucide 的公开路径数据。内联是为了不给内网后台增加运行时依赖
 * （拆分计划明确「不新增运行时依赖」），颜色由调用方按设计令牌传入。
 */
import type { CSSProperties } from 'react';

export type ZnIconName =
  | 'upload'
  | 'search'
  | 'settings'
  | 'users'
  | 'chevron-right'
  | 'chevron-down'
  | 'check'
  | 'circle'
  | 'loader-circle'
  | 'triangle-alert'
  | 'activity'
  | 'git-commit-horizontal'
  | 'rotate-ccw'
  | 'timer'
  | 'scan-line'
  | 'clock-3'
  | 'key-round'
  | 'external-link'
  | 'shield-check'
  | 'info'
  | 'server'
  | 'shield'
  | 'plus'
  | 'refresh-cw'
  | 'trash-2'
  | 'arrow-up-right'
  | 'circle-check-big'
  | 'boxes'
  | 'package'
  | 'lock-keyhole'
  | 'chart-no-axes-combined';

/** lucide 的 stroke 几何；`circles`/`lines` 用于避免手写圆与直线的路径数据。 */
const GLYPHS: Record<ZnIconName, { paths?: string[]; circles?: [number, number, number][]; lines?: [number, number, number, number][] }> = {
  upload: { paths: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'] },
  search: { paths: ['m21 21-4.3-4.3'], circles: [[11, 11, 8]] },
  settings: { paths: ['M12 2v3', 'M12 19v3', 'M4.2 10.5 2 12l2.2 1.5', 'M19.8 13.5 22 12l-2.2-1.5', 'M4.2 13.5 2 12', 'M19.8 10.5 22 12', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'], circles: [[12, 12, 2.6]] },
  users: { paths: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'], circles: [[9, 7, 4]] },
  'chevron-right': { paths: ['m9 18 6-6-6-6'] },
  'chevron-down': { paths: ['m6 9 6 6 6-6'] },
  check: { paths: ['M20 6 9 17l-5-5'] },
  circle: { circles: [[12, 12, 9]] },
  'loader-circle': { paths: ['M21 12a9 9 0 1 1-6.219-8.56'] },
  'triangle-alert': { paths: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'] },
  activity: { paths: ['M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2'] },
  'git-commit-horizontal': { circles: [[12, 12, 3]], lines: [[3, 12, 6, 12], [15, 12, 18, 12]] },
  'rotate-ccw': { paths: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'] },
  timer: { circles: [[12, 14, 8]], lines: [[10, 2, 14, 2], [12, 14, 15, 11]] },
  'scan-line': { paths: ['M3 7V5a2 2 0 0 1 2-2h2', 'M17 3h2a2 2 0 0 1 2 2v2', 'M21 17v2a2 2 0 0 1-2 2h-2', 'M7 21H5a2 2 0 0 1-2-2v-2', 'M7 12h10'] },
  'clock-3': { paths: ['M12 6v6l4-2'], circles: [[12, 12, 10]] },
  'key-round': { paths: ['M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.811-.811a6.5 6.5 0 1 0-4-4z'], circles: [[15.5, 8.5, 1.2]] },
  'external-link': { paths: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'] },
  'shield-check': { paths: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'] },
  info: { paths: ['M12 16v-4', 'M12 8h.01'], circles: [[12, 12, 10]] },
  server: { paths: ['M2 2h20v8H2z', 'M2 14h20v8H2z'], lines: [[6, 6, 6.01, 6], [6, 18, 6.01, 18]] },
  shield: { paths: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z'] },
  plus: { paths: ['M5 12h14', 'M12 5v14'] },
  'refresh-cw': { paths: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M3 21v-5h5'] },
  'trash-2': { paths: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'] },
  'arrow-up-right': { paths: ['M7 17 17 7', 'M7 7h10v10'] },
  'circle-check-big': { paths: ['M21.8 10A10 10 0 1 1 17 3.3', 'm9 11 3 3L22 4'] },
  boxes: { paths: ['M3 8h7v7H3z', 'M14 8h7v4h-7z', 'M14 15h7v4h-7z', 'M3 18h7v3H3z'] },
  package: { paths: ['m7.5 4.27 9 5.15', 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'm3.3 7 8.7 5 8.7-5', 'M12 22V12'] },
  'lock-keyhole': { paths: ['M12 17v4', 'M7 11V7a5 5 0 0 1 10 0v4', 'M3 11h18v10H3z'] },
  'chart-no-axes-combined': { paths: ['M4 20V10', 'M12 20V4', 'M20 20V14', 'M3 20h18'] },
};

export type ZnIconProps = {
  name: ZnIconName;
  /** 设计令牌或具体颜色。 */
  color?: string;
  size?: number;
  /** 额外样式；用于 .pen 中带 opacity 的图标。 */
  style?: CSSProperties;
  className?: string;
};

export function ZnIcon({ name, color = 'currentColor', size = 16, style, className }: ZnIconProps) {
  const glyph = GLYPHS[name];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      {(glyph.circles ?? []).map(([cx, cy, r], index) => (
        <circle key={`c${index}`} cx={cx} cy={cy} r={r} />
      ))}
      {(glyph.lines ?? []).map(([x1, y1, x2, y2], index) => (
        <line key={`l${index}`} x1={x1} y1={y1} x2={x2} y2={y2} />
      ))}
      {glyph.paths?.map((d, index) => (
        <path key={`p${index}`} d={d} />
      ))}
    </svg>
  );
}
