import {
  PencilLinearGradient,
  PencilRadialGradient,
  type GradientStop,
} from './gradients';

/**
 * 资产分区「趋势洞察」艺术窗（设计稿 772 × 328）。
 *
 * 图层与取值逐条取自 `gallery.pen` 的 `ZYukF` 子树：悬浮双层玻璃、光学底板与
 * 纵向刻线、趋势体积投影幕、玻璃光带的立体侧面/后缘/前缘/下缘四层反射、
 * 聚焦节点的外环/内环/白芯与落点地面环，以及四颗曲面微刻节点。
 * 图中的 `74.8` 与横轴刻度均为设计示意，不代表真实资产数据。
 */

const VOLUME: GradientStop[] = [
  { color: '#489BFF24', position: 0 },
  { color: '#328CFF06', position: 1 },
];

const BAND_FILL: GradientStop[] = [
  { color: '#BDE6FF64', position: 0 },
  { color: '#4996E665', position: 0.5 },
  { color: '#12376678', position: 1 },
];

const BAND_SIDE: GradientStop[] = [
  { color: '#579DEC78', position: 0 },
  { color: '#163C7772', position: 0.5 },
  { color: '#081A386E', position: 1 },
];

const BAND_BACK: GradientStop[] = [
  { color: '#B1D6FF61', position: 0 },
  { color: '#4D92D259', position: 1 },
];

const BAND_HIGHLIGHT: GradientStop[] = [
  { color: '#EBF8FF', position: 0 },
  { color: '#5CC8FF', position: 0.5 },
  { color: '#C4EEFF', position: 1 },
];

const BASE_SIDE: GradientStop[] = [
  { color: '#31558739', position: 0 },
  { color: '#0B183230', position: 1 },
];

const BASE_TOP: GradientStop[] = [
  { color: '#336FC420', position: 0 },
  { color: '#122B581C', position: 1 },
];

const TOP_EDGE: GradientStop[] = [
  { color: '#BCDFFF00', position: 0 },
  { color: '#BCDFFF52', position: 0.5 },
  { color: '#BCDFFF00', position: 1 },
];

const BOTTOM_EDGE: GradientStop[] = [
  { color: '#6E8BD900', position: 0 },
  { color: '#6E8BD92C', position: 0.5 },
  { color: '#6E8BD900', position: 1 },
];

const ENV_REFLECTION: GradientStop[] = [
  { color: '#1C71E820', position: 0 },
  { color: '#080D1C00', position: 1 },
];

/** 趋势体积投影幕与玻璃光带共用的一条曲线（设计稿原始路径）。 */
const CURVE = 'M60 248c17-3.83333 68-10.83333 102-23 34-12.16667 68-47.66667 102-50 34-2.33333 68 37.83333 102 36 34-1.83333 68.5-41.66667 102-47 33.5-5.33333 64.33333 21.16667 99 15 34.66667-6.16667 90.83333-43.33333 109-52';

const NODES = [
  { x: 160, y: 223 },
  { x: 262, y: 173 },
  { x: 466, y: 162 },
  { x: 674, y: 125 },
];

export function TrendWindow() {
  return (
    <svg className="home-window__svg" viewBox="0 0 772 328" aria-hidden="true" focusable="false">
      <defs>
        <PencilLinearGradient id="trend-volume" rotation={180} stops={VOLUME} />
        <PencilLinearGradient id="trend-band" rotation={125} stops={BAND_FILL} />
        <PencilLinearGradient id="trend-band-side" rotation={180} stops={BAND_SIDE} />
        <PencilLinearGradient id="trend-band-back" rotation={90} stops={BAND_BACK} />
        <PencilLinearGradient id="trend-band-highlight" rotation={90} stops={BAND_HIGHLIGHT} />
        <PencilLinearGradient id="trend-base-side" rotation={180} stops={BASE_SIDE} />
        <PencilLinearGradient id="trend-base-top" rotation={170} stops={BASE_TOP} />
        <PencilLinearGradient id="trend-top-edge" rotation={90} stops={TOP_EDGE} />
        <PencilLinearGradient id="trend-bottom-edge" rotation={90} stops={BOTTOM_EDGE} />
        <PencilRadialGradient id="trend-env" stops={ENV_REFLECTION} />
        <filter id="trend-soften" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        <filter id="trend-soften-strong" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>

      {/* 柔焦环境反射 */}
      <ellipse cx="428.46" cy="189" rx="297.22" ry="132" fill="url(#trend-env)" />
      {/* 顶部玻璃折射边 / 底部隐约反光 */}
      <rect x="16" y="1" width="740" height="1" fill="url(#trend-top-edge)" />
      <rect x="20" y="326" width="732" height="1" fill="url(#trend-bottom-edge)" />
      {/* 仪器角部刻线 */}
      <path d="M16 17v6" stroke="#DDE6EA60" strokeWidth="1" fill="none" />
      <path d="M756 17v6" stroke="#DDE6EA60" strokeWidth="1" fill="none" />

      {/* 悬浮后层 / 中层玻璃 */}
      <rect x="77" y="106" width="660" height="157" stroke="#B3CAD521" fill="#17376C16" />
      <rect x="62" y="118" width="660" height="157" stroke="#ABC5CE20" fill="#1536631A" />

      {/* 后层细网格 */}
      <g stroke="#89B5F011" strokeWidth="1">
        <path d="M80 142h648" />
        <path d="M80 190h648" />
        <path d="M80 236h648" />
      </g>

      {/* 光学底板：侧面 + 台面 + 纵向刻线 + 前后角连接 */}
      <path
        d="M48 277h643l36-27v6l-36 28H48z"
        fill="url(#trend-base-side)"
        stroke="#6F9ED726"
        strokeWidth="1"
      />
      <path
        d="M48 277h643l36-27H48z"
        fill="url(#trend-base-top)"
        stroke="#9BB9EC30"
        strokeWidth="1"
      />
      <g stroke="#98B6E51A" strokeWidth="1">
        <path d="M48 277l36-27" />
        <path d="M155 277l36-27" />
        <path d="M262 277l36-27" />
        <path d="M369 277l36-27" />
        <path d="M476 277l36-27" />
        <path d="M583 277l36-27" />
        <path d="M691 277l36-27" />
      </g>
      <path d="M48 277l36-27m-36-117l36-27" stroke="#B3D4FF30" strokeWidth="1" fill="none" />
      <path d="M691 277l36-27m-36-117l36-27" stroke="#B3D4FF30" strokeWidth="1" fill="none" />

      {/* 趋势体积投影幕 */}
      <path d={`${CURVE}L676 277H60Z`} fill="url(#trend-volume)" />
      {/* 地面柔影 + 参照轨迹 */}
      <path
        d="M65 273.3c17-.38333 68-1.08333 102-2.3 34-1.21667 68-4.76667 102-5 34-.23333 68 3.78333 102 3.6 34-.18333 68.5-4.16667 102-4.7 33.5-.53333 64.33333 2.11667 99 1.5 34.66667-.61667 90.83333-4.33333 109-5.2"
        stroke="#5DA7FF19"
        strokeWidth="1"
        fill="none"
        filter="url(#trend-soften)"
      />
      <path
        d="M60 259c62-23 104 4 156-18s70-22 128 3 76-30 130-15 81-7 130-22 60 14 103-22"
        stroke="#8B93A35C"
        strokeWidth="1"
        fill="none"
      />

      {/* 悬浮趋势玻璃光带：立体侧面 → 后缘 → 前缘晕光/高光 → 下缘暗反射 */}
      <path
        d={`${CURVE}L709 104c-18.16667 8.66667-74.33333 45.83333-109 52-34.66667 6.16667-65.5-20.33333-99-15-33.5 5.33333-68 45.16667-102 47-34 1.83333-68-38.33333-102-36-34 2.33333-68 37.83333-102 50-34 12.16667-85 19.16667-102 23Z`}
        fill="url(#trend-band)"
        stroke="#82BDFF27"
        strokeWidth="1"
      />
      <path
        d={`${CURVE}v7c-18.16667 8.66667-74.33333 45.83333-109 52-34.66667 6.16667-65.5-20.33333-99-15-33.5 5.33333-68 45.16667-102 47-34 1.83333-68-38.33333-102-36-34 2.33333-68 37.83333-102 50-34 12.16667-85 19.16667-102 23Z`}
        fill="url(#trend-band-side)"
      />
      <path
        d="M93 225c17-3.83333 68-10.83333 102-23 34-12.16667 68-47.66667 102-50 34-2.33333 68 37.83333 102 36 34-1.83333 68.5-41.66667 102-47 33.5-5.33333 64.33333 21.16667 99 15 34.66667-6.16667 90.83333-43.33333 109-52"
        stroke="url(#trend-band-back)"
        strokeWidth="1"
        fill="none"
      />
      <path d={CURVE} stroke="#3EA4FF48" strokeWidth="1" fill="none" filter="url(#trend-soften-strong)" />
      <path
        d={CURVE}
        stroke="url(#trend-band-highlight)"
        strokeWidth="1.5"
        fill="none"
        style={{ filter: 'drop-shadow(#3EA4FF50 0 0 5px)' }}
      />
      <path
        d="M60 255c17-3.83333 68-10.83333 102-23 34-12.16667 68-47.66667 102-50 34-2.33333 68 37.83333 102 36 34-1.83333 68.5-41.66667 102-47 33.5-5.33333 64.33333 21.16667 99 15 34.66667-6.16667 90.83333-43.33333 109-52"
        stroke="#84B4F745"
        strokeWidth="1"
        fill="none"
      />

      {/* 曲面微刻节点 */}
      {NODES.map((node) => (
        <circle
          key={`${node.x}-${node.y}`}
          cx={node.x + 2}
          cy={node.y + 2}
          r="2"
          fill="#E4F6FF"
          style={{ filter: 'drop-shadow(#76C5FF4D 0 0 4px)' }}
        />
      ))}

      {/* 聚焦垂直投影 + 落点地面环 */}
      <g fill="#6DABEB4B">
        {[193, 201, 209, 217, 225, 233, 241, 249, 257, 265].map((y) => (
          <rect key={y} x="567" y={y} width="1" height="3" />
        ))}
      </g>
      <ellipse cx="567.5" cy="270.5" rx="7.5" ry="3.5" stroke="#99CAFF45" fill="#3D9DFF10" />

      {/* 聚焦节点：外环 → 内环 → 白芯 */}
      <circle
        cx="567"
        cy="179"
        r="10"
        stroke="#87CBFF58"
        fill="#0C2B6470"
        style={{ filter: 'drop-shadow(#53B5FF4F 0 0 6.5px)' }}
      />
      <circle cx="567" cy="179" r="5" stroke="#EAF8FF" fill="#0C1A38" />
      <circle cx="567" cy="179" r="2" fill="#EAF8FF" />

      {/* 注释细引线 */}
      <path d="M593 147v9l-16 13" stroke="#80AEE95B" strokeWidth="1" fill="none" />
    </svg>
  );
}
