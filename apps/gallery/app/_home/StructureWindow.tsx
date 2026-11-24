import type { ReactNode } from 'react';
import {
  PencilLinearGradient,
  PencilRadialGradient,
  type GradientStop,
} from './gradients';

/**
 * 资产分区「排列与结构」艺术窗（设计稿 482 × 328）。
 *
 * 图层与取值逐条取自 `gallery.pen` 的 `nq7Y5` 子树：八根缎面金属序列柱，每根由
 * 侧面深钛反射、正面多段缎面反射 + 环境叠加、顶面银紫磨砂高光、左右两条倒角、
 * 窄幅柔亮反射与顶面前缘细光带七层构成；下方是浮空底座（深色前立面 + 光学玻璃
 * 承重台面 + 九道精密纵向蚀刻 + 前缘/中线微反射）与金属序列接触柔影。
 * 编号 01–08 与「TITANIUM / 08」均为设计示意。
 */

const WIDTH = 482;

type Tone = 'blue' | 'iris';

type Column = { x: number; y: number; height: number; tone: Tone; accent: boolean; label: string };

/** 设计稿八根序列柱的 x / y / 高度；6–8 换鸢尾紫，第 8 根顶面改用高亮银。 */
const COLUMNS: Column[] = [
  { x: 53, y: 209, height: 54, tone: 'blue', accent: false, label: '01' },
  { x: 98, y: 177, height: 86, tone: 'blue', accent: false, label: '02' },
  { x: 143, y: 192, height: 71, tone: 'blue', accent: false, label: '03' },
  { x: 188, y: 151, height: 112, tone: 'blue', accent: false, label: '04' },
  { x: 233, y: 166, height: 97, tone: 'blue', accent: false, label: '05' },
  { x: 278, y: 125, height: 138, tone: 'iris', accent: false, label: '06' },
  { x: 323, y: 143, height: 120, tone: 'iris', accent: false, label: '07' },
  { x: 368, y: 98, height: 165, tone: 'iris', accent: true, label: '08' },
];

const SIDE: GradientStop[] = [
  { color: '#455FAB', position: 0 },
  { color: '#1C316A', position: 0.5 },
  { color: '#08142B', position: 1 },
];

const FRONT_BLUE: GradientStop[] = [
  { color: '#99B3FF', position: 0 },
  { color: '#334D8B', position: 0.3333333333333333 },
  { color: '#617ACB', position: 0.6666666666666666 },
  { color: '#14274D', position: 1 },
];

const FRONT_IRIS: GradientStop[] = [
  { color: '#AFA3FF', position: 0 },
  { color: '#51488B', position: 0.3333333333333333 },
  { color: '#887DCF', position: 0.6666666666666666 },
  { color: '#25234F', position: 1 },
];

const OVERLAY_BLUE: GradientStop[] = [
  { color: '#A28FFF2A', position: 0 },
  { color: '#22275320', position: 0.5 },
  { color: '#040A1D88', position: 1 },
];

const OVERLAY_IRIS: GradientStop[] = [
  { color: '#C1ACFF4D', position: 0 },
  { color: '#22275320', position: 0.5 },
  { color: '#040A1D88', position: 1 },
];

const TOP: GradientStop[] = [
  { color: '#D8E5FF', position: 0 },
  { color: '#7D98EA', position: 0.5 },
  { color: '#B0BFFF', position: 1 },
];

const TOP_ACCENT: GradientStop[] = [
  { color: '#F0E9FF', position: 0 },
  { color: '#7D98EA', position: 0.5 },
  { color: '#B0BFFF', position: 1 },
];

const BEVEL_LEFT: GradientStop[] = [
  { color: '#D2E5FF98', position: 0 },
  { color: '#8EA8F045', position: 0.5 },
  { color: '#5575B929', position: 1 },
];

const BEVEL_RIGHT: GradientStop[] = [
  { color: '#B8A3FFB0', position: 0 },
  { color: '#6755AB80', position: 0.5 },
  { color: '#23326C55', position: 1 },
];

const SOFT_REFLECTION: GradientStop[] = [
  { color: '#D7DDFF1C', position: 0 },
  { color: '#B9CCFF12', position: 0.5 },
  { color: '#B9CCFF00', position: 1 },
];

const PLINTH_FRONT: GradientStop[] = [
  { color: '#3D548E8F', position: 0 },
  { color: '#111D3DB0', position: 0.5 },
  { color: '#080E2190', position: 1 },
];

const PLINTH_TOP: GradientStop[] = [
  { color: '#5A67BA3B', position: 0 },
  { color: '#23396980', position: 0.5 },
  { color: '#101E3E54', position: 1 },
];

const TOP_EDGE: GradientStop[] = [
  { color: '#CDD7FF00', position: 0 },
  { color: '#CDD7FF52', position: 0.5 },
  { color: '#CDD7FF00', position: 1 },
];

const BOTTOM_EDGE: GradientStop[] = [
  { color: '#878CD800', position: 0 },
  { color: '#878CD82C', position: 0.5 },
  { color: '#878CD800', position: 1 },
];

const ENV_REFLECTION: GradientStop[] = [
  { color: '#6553EA24', position: 0 },
  { color: '#080D1C00', position: 1 },
];

const CONTACT_SHADOW: GradientStop[] = [
  { color: '#000000C0', position: 0 },
  { color: '#080D1C00', position: 1 },
];

const ETCH_X = [44, 91, 138, 185, 232, 279, 326, 373, 410];

const overlay = (x: number): string => `${(x / WIDTH) * 100}%`;

export function StructureWindow() {
  return (
    <svg className="home-window__svg" viewBox="0 0 482 328" aria-hidden="true" focusable="false">
      <defs>
        <PencilLinearGradient id="col-side" rotation={105} stops={SIDE} />
        <PencilLinearGradient id="col-front-blue" rotation={90} stops={FRONT_BLUE} />
        <PencilLinearGradient id="col-front-iris" rotation={90} stops={FRONT_IRIS} />
        <PencilLinearGradient id="col-overlay-blue" rotation={180} stops={OVERLAY_BLUE} />
        <PencilLinearGradient id="col-overlay-iris" rotation={180} stops={OVERLAY_IRIS} />
        <PencilLinearGradient id="col-top" rotation={170} stops={TOP} />
        <PencilLinearGradient id="col-top-accent" rotation={170} stops={TOP_ACCENT} />
        <PencilLinearGradient id="col-bevel-left" rotation={180} stops={BEVEL_LEFT} />
        <PencilLinearGradient id="col-bevel-right" rotation={180} stops={BEVEL_RIGHT} />
        <PencilLinearGradient id="col-soft" rotation={180} stops={SOFT_REFLECTION} />
        <PencilLinearGradient id="plinth-front" rotation={180} stops={PLINTH_FRONT} />
        <PencilLinearGradient id="plinth-top" rotation={155} stops={PLINTH_TOP} />
        <PencilLinearGradient id="struct-top-edge" rotation={90} stops={TOP_EDGE} />
        <PencilLinearGradient id="struct-bottom-edge" rotation={90} stops={BOTTOM_EDGE} />
        <PencilRadialGradient id="struct-env" stops={ENV_REFLECTION} />
        <PencilRadialGradient id="struct-contact" stops={CONTACT_SHADOW} />
        <filter id="struct-contact-blur" x="-30%" y="-60%" width="160%" height="220%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id="struct-focus-blur" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* 柔焦环境反射 */}
      <ellipse cx="267.51" cy="189" rx="185.57" ry="132" fill="url(#struct-env)" />
      {/* 顶部玻璃折射边 / 底部隐约反光 */}
      <rect x="16" y="1" width="450" height="1" fill="url(#struct-top-edge)" />
      <rect x="20" y="326" width="442" height="1" fill="url(#struct-bottom-edge)" />
      {/* 仪器角部刻线 */}
      <path d="M16 17v6" stroke="#DDE6EA60" strokeWidth="1" fill="none" />
      <path d="M466 17v6" stroke="#DDE6EA60" strokeWidth="1" fill="none" />

      {/* 金属序列接触柔影 */}
      <ellipse cx="240" cy="272" rx="192" ry="20" fill="url(#struct-contact)" filter="url(#struct-contact-blur)" />

      {/* 浮空底座：深色前立面 → 光学玻璃承重台面 → 纵向蚀刻 → 前缘/中线微反射 */}
      <path
        d="M41 271h368l40-26v6l-40 28H41z"
        fill="url(#plinth-front)"
        stroke="#AEBFFC2B"
        strokeWidth="1"
      />
      <path
        d="M41 271h368l40-26H41z"
        fill="url(#plinth-top)"
        stroke="#B6BDFF3D"
        strokeWidth="1"
      />
      <g stroke="#9DACDB20" strokeWidth="1">
        {ETCH_X.map((x) => (
          <path key={x} d={`M${x} 271l39-26`} />
        ))}
      </g>
      <path d="M42 271h367" stroke="#9DB6F445" strokeWidth="1" fill="none" />
      <path d="M61 258h368" stroke="#BFA9FF15" strokeWidth="1" fill="none" />

      {/* 八根缎面金属序列柱 */}
      {COLUMNS.map((column) => {
        const { x, y, height, tone, accent, label } = column;
        return (
          <g key={label}>
            <ellipse
              cx={x + 19}
              cy="263"
              rx="22"
              ry="6"
              fill="#00000066"
              filter="url(#struct-contact-blur)"
            />
            {/* 侧面 · 深钛反射 */}
            <path
              d={`M${x + 25} ${y + 8}l13-8v${height - 8}l-13 8z`}
              fill="url(#col-side)"
              stroke="#ACBCFF18"
              strokeWidth="1"
            />
            {/* 正面 · 缎面金属多段反射 + 环境叠加 */}
            <rect
              x={x}
              y={y + 8}
              width="25"
              height={height - 8}
              fill={`url(#col-front-${tone})`}
              stroke="#A0B5F12B"
              strokeWidth="1"
            />
            <rect x={x} y={y + 8} width="25" height={height - 8} fill={`url(#col-overlay-${tone})`} />
            {/* 顶面 · 银紫磨砂高光 */}
            <path
              d={`M${x} ${y + 8}l13-8h25l-13 8z`}
              fill={accent ? 'url(#col-top-accent)' : 'url(#col-top)'}
              stroke="#E6E9FF68"
              strokeWidth="1"
            />
            {/* 左缘银白倒角 / 右缘紫钛倒角 / 窄幅柔亮反射 */}
            <rect x={x} y={y + 9} width="1" height={height - 9} fill="url(#col-bevel-left)" />
            <rect x={x + 24} y={y + 9} width="0.7" height={height - 9} fill="url(#col-bevel-right)" />
            <rect x={x + 4} y={y + 11} width="1.5" height={height - 13} fill="url(#col-soft)" />
            {/* 顶面前缘细光带 */}
            <rect
              x={x + 0.7}
              y={y + 8}
              width="24"
              height="0.8"
              fill={accent ? '#F4EEFFD9' : '#DBE4FF90'}
              style={{ filter: 'drop-shadow(#8D7AFF26 0 0 2.5px)' }}
            />
          </g>
        );
      })}

      {/* 最高序列聚焦引线与端点 */}
      <path d="M399 98l25-16h22" stroke="#B9BCFF60" strokeWidth="1" fill="none" />
      <circle
        cx="398"
        cy="98"
        r="2"
        fill="#ECE8FF"
        filter="url(#struct-focus-blur)"
      />
    </svg>
  );
}

/** 艺术窗内的等宽字体注记：位置按设计稿 x 坐标占窗宽的比例换算，随窗缩放。 */
export function WindowNote({
  x,
  y,
  width,
  align = 'left',
  color,
  size,
  tracking,
  children,
}: {
  x: number;
  y: number;
  width?: number;
  align?: 'left' | 'right';
  color: string;
  size: number;
  tracking?: number;
  children: ReactNode;
}) {
  return (
    <span
      className="home-window__note"
      style={{
        left: overlay(x),
        top: y,
        width: width === undefined ? undefined : overlay(width),
        textAlign: align,
        color,
        fontSize: size,
        letterSpacing: tracking === undefined ? undefined : `${tracking}px`,
      }}
    >
      {children}
    </span>
  );
}
