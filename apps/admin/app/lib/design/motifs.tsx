/**
 * 六个画板的 Command Motif：`.pen` 中每个业务画板页头右侧都有一个 378×112 的
 * `Command Motif · *` 绝对定位装饰帧，`motifs.ts` 的数组顺序即画板顺序
 * （01 upload / 02 jobs / 03 access·oidc / 04 access·preview / 05 users / 06 match）。
 *
 * 全部几何按 `.pen` 的 x/y/width/height 原值记录，渲染时统一进
 * `viewBox="0 0 378 112"` 的一个 SVG，避免用一堆绝对定位 div。
 */
import { ZN_PANEL_GRADIENT } from './tokens';

type Base = { opacity?: number };

export type MotifShape =
  | ({ kind: 'ellipse'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number } & Base)
  | ({ kind: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number; radius?: [number, number, number, number] } & Base)
  | ({ kind: 'path'; x: number; y: number; w: number; h: number; d: string; stroke: string; strokeWidth: number } & Base)
  | ({ kind: 'rule'; x: number; y: number; w: number; fill?: string } & Base)
  | ({ kind: 'text'; x: number; y: number; text: string; size: number; fill: string; weight?: number; spacing?: number } & Base);

export type CommandMotif = {
  /** 画板序号 01–06。 */
  board: string;
  /** `.pen` 的 Motif Telemetry Label 文案。 */
  label: string;
  /** 画板 03 的 motif 带玻璃面板底，其余透明。 */
  panel?: boolean;
  shapes: readonly MotifShape[];
};

const SIGNAL_RULE: MotifShape = {
  kind: 'rule',
  x: 14,
  y: 30,
  w: 128,
  fill: 'linear-gradient(180deg, rgba(101,245,255,0) 0%, rgba(101,245,255,0.722) 100%)',
  opacity: 0.25,
};

export const COMMAND_MOTIFS: readonly CommandMotif[] = [
  {
    board: '01',
    label: 'INGEST ORBIT / 01',
    shapes: [
      SIGNAL_RULE,
      { kind: 'ellipse', x: 204, y: 2, w: 108, h: 108, stroke: '#A8E5EB42', strokeWidth: 1, opacity: 0.42 },
      { kind: 'ellipse', x: 222, y: 18, w: 78, h: 78, stroke: '#A8E5EB42', strokeWidth: 1, opacity: 0.42 },
      { kind: 'ellipse', x: 238, y: 34, w: 46, h: 46, stroke: '#A8E5EB42', strokeWidth: 1, opacity: 0.42 },
      { kind: 'ellipse', x: 244, y: 16, w: 7, h: 7, fill: '#65F5FF' },
      { kind: 'ellipse', x: 315, y: 54, w: 7, h: 7, fill: '#7CA8FF' },
      { kind: 'ellipse', x: 262, y: 84, w: 7, h: 7, fill: '#B4A6FF' },
    ],
  },
  {
    board: '02',
    label: 'SEQUENCE LOCK / 04',
    shapes: [
      SIGNAL_RULE,
      { kind: 'rect', x: 152, y: 56, w: 196, h: 1, fill: '#65F5FF66', opacity: 0.25 },
      { kind: 'ellipse', x: 152, y: 51, w: 11, h: 11, fill: '#79E7BF', stroke: '#79E7BF', strokeWidth: 1 },
      { kind: 'ellipse', x: 201, y: 51, w: 11, h: 11, fill: '#79E7BF', stroke: '#79E7BF', strokeWidth: 1 },
      { kind: 'ellipse', x: 250, y: 51, w: 11, h: 11, fill: '#79E7BF', stroke: '#79E7BF', strokeWidth: 1 },
      { kind: 'ellipse', x: 299, y: 51, w: 11, h: 11, fill: '#FFC98A', stroke: '#FFC98A', strokeWidth: 1 },
      { kind: 'ellipse', x: 348, y: 51, w: 11, h: 11, fill: '#0A1D2A', stroke: '#D6F2F333', strokeWidth: 1 },
      { kind: 'text', x: 151, y: 74, text: '01', size: 7, fill: '#7E99A1' },
      { kind: 'text', x: 200, y: 74, text: '02', size: 7, fill: '#7E99A1' },
      { kind: 'text', x: 249, y: 74, text: '03', size: 7, fill: '#7E99A1' },
      { kind: 'text', x: 298, y: 74, text: '04', size: 7, fill: '#7E99A1' },
      { kind: 'text', x: 347, y: 74, text: '05', size: 7, fill: '#7E99A1' },
    ],
  },
  {
    board: '03',
    label: 'IDENTITY MESH / OIDC',
    panel: true,
    shapes: [
      SIGNAL_RULE,
      { kind: 'path', x: 156, y: 32, w: 192, h: 62, d: 'M0 31l48-31 56 36 52-28 36 34', stroke: '#65F5FF55', strokeWidth: 1 },
      { kind: 'ellipse', x: 153, y: 58, w: 8, h: 8, fill: '#243B45CA', stroke: '#A3D2FF', strokeWidth: 1 },
      { kind: 'ellipse', x: 201, y: 27, w: 8, h: 8, fill: '#243B45CA', stroke: '#A3D2FF', strokeWidth: 1 },
      { kind: 'ellipse', x: 257, y: 63, w: 8, h: 8, fill: '#243B45CA', stroke: '#A3D2FF', strokeWidth: 1 },
      { kind: 'ellipse', x: 309, y: 35, w: 8, h: 8, fill: '#243B45CA', stroke: '#A3D2FF', strokeWidth: 1 },
      { kind: 'ellipse', x: 345, y: 69, w: 8, h: 8, fill: '#243B45CA', stroke: '#A3D2FF', strokeWidth: 1 },
    ],
  },
  {
    board: '04',
    label: 'GATE APERTURE / TLS',
    shapes: [
      SIGNAL_RULE,
      { kind: 'rect', x: 166, y: 24, w: 176, h: 72, stroke: '#65F5FF66', strokeWidth: 1, radius: [14, 3, 14, 3] },
      { kind: 'rect', x: 181, y: 33, w: 146, h: 54, stroke: '#7CA8FF66', strokeWidth: 1, radius: [14, 3, 14, 3] },
      { kind: 'rect', x: 196, y: 42, w: 116, h: 36, stroke: '#B4A6FF66', strokeWidth: 1, radius: [14, 3, 14, 3] },
      { kind: 'rect', x: 211, y: 51, w: 86, h: 18, stroke: '#59F2B077', strokeWidth: 1, radius: [14, 3, 14, 3] },
      {
        kind: 'rect',
        x: 202,
        y: 55,
        w: 116,
        h: 2,
        fill: 'linear-gradient(180deg, rgba(101,245,255,0) 0%, #65F5FF 50%, rgba(101,245,255,0) 100%)',
      },
    ],
  },
  {
    board: '05',
    label: 'ACCESS CONSTELLATION / RBAC',
    shapes: [
      SIGNAL_RULE,
      {
        kind: 'path',
        x: 152,
        y: 28,
        w: 198,
        h: 64,
        d: 'M8 50l40-38 48 26 40-34 54 26-38 28-56-20-48-26',
        stroke: '#7CA8FF55',
        strokeWidth: 1,
      },
      { kind: 'ellipse', x: 156, y: 75, w: 8, h: 8, fill: '#59F2B0' },
      { kind: 'ellipse', x: 196, y: 37, w: 8, h: 8, fill: '#65F5FF' },
      { kind: 'ellipse', x: 244, y: 63, w: 8, h: 8, fill: '#B4A6FF' },
      { kind: 'ellipse', x: 284, y: 29, w: 8, h: 8, fill: '#65F5FF' },
      { kind: 'ellipse', x: 338, y: 55, w: 8, h: 8, fill: '#FFB661' },
      { kind: 'ellipse', x: 300, y: 83, w: 8, h: 8, fill: '#59F2B0' },
    ],
  },
  {
    board: '06',
    label: 'VECTOR MATCH / 0.94',
    shapes: [
      SIGNAL_RULE,
      { kind: 'ellipse', x: 216, y: 3, w: 108, h: 108, stroke: '#A8E5EB42', strokeWidth: 1, opacity: 0.42 },
      { kind: 'ellipse', x: 229, y: 16, w: 82, h: 82, stroke: '#A8E5EB42', strokeWidth: 2, opacity: 0.42 },
      { kind: 'rect', x: 188, y: 56, w: 166, h: 1, fill: '#65F5FF55', opacity: 0.25 },
      { kind: 'rect', x: 269, y: 10, w: 1, h: 94, fill: '#65F5FF55', opacity: 0.25 },
      { kind: 'ellipse', x: 265, y: 52, w: 9, h: 9, fill: '#A3D2FF' },
    ],
  },
] as const;

/** Aurora 流径：`.pen` 的 Aurora Flow Field 两条渐变描边贝塞尔曲线。 */
export const AURORA_FLOW_PATHS = [
  { d: 'M0 430c220-310 520 130 1120-310', stroke: '#8CCFFF5C', width: 2, opacity: 0.48 },
  { d: 'M0 120c360 290 710-120 1160 180', stroke: '#78E7C24A', width: 3, opacity: 0.34 },
] as const;

function radiusAttribute(radius?: [number, number, number, number]): string | undefined {
  return radius ? radius.join(' ') : undefined;
}

export type ZnMotifProps = {
  motif: CommandMotif;
  className?: string;
};

/**
 * 渲染单个 Command Motif。`pointer-events:none` 必须有——它是 378×112 的装饰层，
 * 早期实现漏了这条，把页头右侧的交互全挡住了。
 */
export function ZnMotif({ motif, className }: ZnMotifProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 378 112"
      width="378"
      height="112"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
      data-motif-board={motif.board}
      style={{ pointerEvents: 'none', display: 'block' }}
    >
      <defs>
        <linearGradient id={`zn-rule-${motif.board}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#65F5FF" stopOpacity="0" />
          <stop offset="100%" stopColor="#65F5FF" stopOpacity="0.72" />
        </linearGradient>
        <linearGradient id={`zn-beam-${motif.board}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#65F5FF" stopOpacity="0" />
          <stop offset="50%" stopColor="#65F5FF" stopOpacity="1" />
          <stop offset="100%" stopColor="#65F5FF" stopOpacity="0" />
        </linearGradient>
      </defs>
      {motif.shapes.map((shape, index) => {
        if (shape.kind === 'ellipse') {
          return (
            <ellipse
              key={index}
              cx={shape.x + shape.w / 2}
              cy={shape.y + shape.h / 2}
              rx={shape.w / 2}
              ry={shape.h / 2}
              fill={shape.fill ?? 'none'}
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth}
              opacity={shape.opacity}
            />
          );
        }
        if (shape.kind === 'path') {
          return (
            <path
              key={index}
              d={shape.d}
              transform={`translate(${shape.x} ${shape.y})`}
              fill="none"
              stroke={shape.stroke}
              strokeWidth={shape.strokeWidth}
              opacity={shape.opacity}
            />
          );
        }
        if (shape.kind === 'rule') {
          return (
            <rect
              key={index}
              x={shape.x}
              y={shape.y}
              width={shape.w}
              height={1}
              fill={`url(#zn-rule-${motif.board})`}
              opacity={shape.opacity}
            />
          );
        }
        if (shape.kind === 'text') {
          return (
            <text
              key={index}
              x={shape.x}
              y={shape.y}
              fill={shape.fill}
              fontSize={shape.size}
              fontWeight={shape.weight ?? 400}
              letterSpacing={shape.spacing}
              fontFamily='"IBM Plex Mono", ui-monospace, monospace'
            >
              {shape.text}
            </text>
          );
        }
        const isBeam = shape.fill?.includes('50%');
        return (
          <rect
            key={index}
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            rx={radiusAttribute(shape.radius)}
            fill={isBeam ? `url(#zn-beam-${motif.board})` : (shape.fill ?? 'none')}
            stroke={shape.stroke}
            strokeWidth={shape.strokeWidth}
            opacity={shape.opacity}
          />
        );
      })}
    </svg>
  );
}

/** 页头右侧的 Motif 容器：画板 03 带玻璃面板底。 */
export function ZnCommandMotif({ motif, className }: ZnMotifProps) {
  return (
    <div className={className ? `zn-motif ${className}` : 'zn-motif'} data-motif-board={motif.board} aria-hidden="true">
      {motif.panel ? <span className="zn-motif-panel" style={{ background: ZN_PANEL_GRADIENT }} /> : null}
      <ZnMotif motif={motif} className="zn-motif-svg" />
      <span className="zn-motif-label">{motif.label}</span>
    </div>
  );
}
