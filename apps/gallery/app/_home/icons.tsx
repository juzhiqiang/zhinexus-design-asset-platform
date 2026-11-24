import type { ReactNode } from 'react';

/**
 * 设计稿（`gallery.pen` 画板 `I0RAl`）里的图标来自 lucide 图标库，按名字取用。
 * 这里内联同等形状的路径，不引入图标依赖；统一用 currentColor 描边，
 * 由外层控制颜色（设计稿各图标取色不同）。
 */

export type HomeIconName =
  | 'arrow-up-right'
  | 'arrow-right'
  | 'arrow-down'
  | 'search'
  | 'scan-eye'
  | 'package'
  | 'terminal'
  | 'layers';

const PATHS: Record<HomeIconName, ReactNode> = {
  'arrow-up-right': (
    <>
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  'arrow-down': (
    <>
      <path d="M12 5v14" />
      <path d="m19 13-7 7-7-7" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  'scan-eye': (
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  package: (
    <>
      <path d="m7.5 4.3 9 5.1" />
      <path d="M21 8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  terminal: (
    <>
      <path d="m4 17 6-6-6-6" />
      <path d="m12 19h8" />
    </>
  ),
  layers: (
    <>
      <path d="M12.8 2.2a2 2 0 0 0-1.6 0L2.6 6.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0l8.6-3.9a1 1 0 0 0 0-1.8Z" />
      <path d="m22 17.7-9.2 4.1a2 2 0 0 1-1.6 0L2 17.7" />
      <path d="m22 12.7-9.2 4.1a2 2 0 0 1-1.6 0L2 12.7" />
    </>
  ),
};

export function HomeIcon({
  name,
  size = 18,
  className,
}: {
  name: HomeIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** 品牌字标里的 Z 形金属标记：外层金属渐变 + 内层电光切口。 */
export function ZhinexusMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={(size * 27) / 28} viewBox="0 0 28 27" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="zhinexus-mark-titanium" x1="0" y1="0.5" x2="1" y2="0.5">
          <stop offset="0" stopColor="#F2F7FA" />
          <stop offset="1" stopColor="#717984" />
        </linearGradient>
      </defs>
      <path d="M0 0h28L9 27H0l18-23H0z" fill="url(#zhinexus-mark-titanium)" />
      <path d="M16 0h12l-4 5H4z" fill="#84EEE5" />
    </svg>
  );
}

/** 原生分区 Vue 徽章：外层渐变 V 形 + 内层实心 V 形。 */
export function VueMark() {
  return (
    <svg width="66" height="57" viewBox="0 0 66 57" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="vue-mark-outer" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#9CE8D6" />
          <stop offset="1" stopColor="#4B8D7F" />
        </linearGradient>
      </defs>
      <path d="M0 0h15l18 30 18-30h15L33 57z" fill="url(#vue-mark-outer)" />
      <path d="M15 0h10l8 13 8-13h10L33 30z" fill="#D0EBE4" />
    </svg>
  );
}

const REACT_ORBIT_0 =
  'M75 40l-.11 1.02-.32 1.01-.54 1-.74.99-.95.95-1.15.93-1.35.89-1.52.85-1.71.8-1.86.75-2.02.7-2.16.63-2.28.56-2.4.5-2.5.43-2.57.35-2.65.28-2.69.2-2.73.12-2.75.04-2.75-.04-2.73-.12-2.69-.2-2.65-.28-2.57-.35-2.5-.43-2.4-.5-2.28-.56-2.16-.63-2.02-.7-1.86-.75-1.71-.8-1.52-.85-1.35-.89-1.15-.93-.95-.95-.74-.99-.54-1-.32-1.01-.11-1.02.11-1.02.32-1.01.54-1 .74-.99.95-.95 1.15-.93 1.35-.89 1.52-.85 1.71-.8 1.86-.75 2.02-.7 2.16-.63 2.28-.56 2.4-.5 2.5-.43 2.57-.35 2.65-.28 2.69-.2 2.73-.12 2.75-.04 2.75.04 2.73.12 2.69.2 2.65.28 2.57.35 2.5.43 2.4.5 2.28.56 2.16.63 2.02.7 1.86.75 1.71.8 1.52.85 1.35.89 1.15.93.95.95.74.99.54 1 .32 1.01.11 1.02';

const REACT_ORBIT_1 =
  'M57.5 70.31l-.94.42-1.04.22-1.13.04-1.23-.15-1.3-.35-1.38-.53-1.44-.72-1.5-.9-1.54-1.07-1.59-1.24-1.61-1.4-1.62-1.56-1.64-1.69-1.63-1.83-1.61-1.95-1.6-2.05-1.56-2.15-1.52-2.24-1.47-2.3-1.41-2.36-1.34-2.4-1.26-2.42-1.17-2.44-1.09-2.42-.98-2.41-.88-2.38-.76-2.33-.65-2.26-.54-2.18-.41-2.1-.28-1.99-.16-1.87-.02-1.75.1-1.61.22-1.46.36-1.3.48-1.14.59-.96.72-.79.83-.6.94-.42 1.04-.22 1.13-.04 1.23.15 1.3.35 1.38.53 1.44.72 1.5.9 1.54 1.07 1.59 1.24 1.61 1.4 1.62 1.56 1.64 1.69 1.63 1.83 1.61 1.95 1.6 2.05 1.56 2.15 1.52 2.24 1.47 2.3 1.41 2.36 1.34 2.4 1.26 2.42 1.17 2.44 1.09 2.42.98 2.41.88 2.38.76 2.33.65 2.26.54 2.18.41 2.1.28 1.99.16 1.87.02 1.75-.1 1.61-.22 1.46-.36 1.3-.48 1.14-.59.96-.72.79-.83.6';

const REACT_ORBIT_2 =
  'M22.5 70.31l-.83-.6-.72-.79-.59-.96-.48-1.14-.36-1.3-.22-1.46-.1-1.61.02-1.75.16-1.87.28-1.99.41-2.1.54-2.18.65-2.26.76-2.33.88-2.38.98-2.41 1.09-2.42 1.17-2.44 1.26-2.42 1.34-2.4 1.41-2.36 1.47-2.3 1.52-2.24 1.56-2.15 1.6-2.05 1.61-1.95 1.63-1.83 1.64-1.69 1.62-1.56 1.61-1.4 1.59-1.24 1.54-1.07 1.5-.9 1.44-.72 1.38-.53 1.3-.35 1.23-.15 1.13.04 1.04.22.94.42.83.6.72.79.59.96.48 1.14.36 1.3.22 1.46.1 1.61-.02 1.75-.16 1.87-.28 1.99-.41 2.1-.54 2.18-.65 2.26-.76 2.33-.88 2.38-.98 2.41-1.09 2.42-1.17 2.44-1.26 2.42-1.34 2.4-1.41 2.36-1.47 2.3-1.52 2.24-1.56 2.15-1.6 2.05-1.61 1.95-1.63 1.83-1.64 1.69-1.62 1.56-1.61 1.4-1.59 1.24-1.54 1.07-1.5.9-1.44.72-1.38.53-1.3.35-1.23.15-1.13-.04-1.04-.22-.94-.42';

/** 原生分区 React 徽章：三条电子轨道 + 中心核点。 */
export function ReactMark() {
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true" focusable="false">
      <g fill="none" stroke="#BFB2ED" strokeWidth="1">
        <path d={REACT_ORBIT_0} />
        <path d={REACT_ORBIT_1} />
        <path d={REACT_ORBIT_2} />
      </g>
      <circle cx="40" cy="40" r="4" fill="#DED6FE" />
    </svg>
  );
}
