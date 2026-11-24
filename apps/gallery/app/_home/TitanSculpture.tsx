/**
 * 首屏钛金属 Möbius 雕塑的 SVG 近似重建。
 *
 * 设计稿里的雕塑由 1860 个复合路径构成（`gallery.pen` 中 `tPIBb` 子树，帧 700×650，
 * 位于首屏 x=678 / y=8）。逐路径转会生成数万行无法维护的代码，因此按既定范围用
 * 「环带 + 顶部亮缘 + 左青右紫反射 + 底部压暗」五层重建同一视觉。
 *
 * 尺寸不是估的：把 1860 条路径展开成多边形、按扫描线求并集，得到设计稿雕塑的
 * 实测轮廓（占用图 70×65 格）：外接盒 x 128..587、y 113..524，即 459 × 410，
 * 中心约 (357, 319)，环带在帧内呈倾斜莫比乌斯环。再用同一张占用图拟合椭圆环带
 * 参数（中心 / 外半径 / 内半径 / 旋转角），得到下面的取值：
 *
 *   中心 (350, 281) · 外 255 × 138 · 内 128 × 83 · 旋转 -32°
 *
 * 拟合前用的是外 315×220、内 250×160、旋转 -22°，占用图 IoU 只有 0.14——环大了
 * 约四分之一、位置偏低 45px、环带偏薄。换成拟合值后 IoU 0.82。这些数字由
 * `tests/gallery/home-sculpture.test.ts` 钉住，避免再次静默漂移。
 *
 * 全部为原生矢量，无位图、无外部图像依赖（与设计稿一致）。
 */

/**
 * 未旋转的环带：外椭圆减内椭圆，evenodd 成环。
 *
 * 两条弧的扫掠标志分别取 0 与 1，使内外子路径**绕行方向相反**：这样 `fill-rule`
 * 无论是默认的 `nonzero` 还是显式的 `evenodd`，内椭圆都被挖空。只写其中一道保险是不够的——
 * 2026-11-24 之前的版本在这里误写了 `clip-rule`（该属性只在 `<clipPath>` 内生效，对填充
 * 毫无作用），加上两个子路径同向，中空被填实，整环退化成一只实心椭圆。
 * 回归测试见 `tests/gallery/home-sculpture.test.ts`。
 */
const BAND = [
  'M95 281a255 138 0 1 0 510 0a255 138 0 1 0 -510 0Z',
  'M222 281a128 83 0 1 1 256 0a128 83 0 1 1 -256 0Z',
].join(' ');

/** 环带上缘亮弧：外椭圆顶部 ±10°，经过正上方。 */
const RIM = 'M98.9 257A255 138 0 0 1 502.3 0';

/** 设计稿实测雕塑外接盒（700×650 帧内），用于测试比对。 */
export const SCULPTURE_DESIGN_BOUNDS = { left: 128, right: 587, top: 113.5, bottom: 523.7 } as const;

export function TitanSculpture() {
  return (
    <svg
      className="home-sculpture"
      viewBox="0 0 700 650"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="sculpt-body" x1="0.08" y1="0" x2="0.92" y2="1">
          <stop offset="0" stopColor="#E9F0F5" />
          <stop offset="0.16" stopColor="#8D9AA6" />
          <stop offset="0.38" stopColor="#262D36" />
          <stop offset="0.58" stopColor="#7C8894" />
          <stop offset="0.78" stopColor="#14191F" />
          <stop offset="1" stopColor="#0C1015" />
        </linearGradient>
        <linearGradient id="sculpt-rim" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="0.18" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="#E8F4FF" stopOpacity="0.72" />
          <stop offset="0.85" stopColor="#CFE2F2" stopOpacity="0.35" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="sculpt-teal" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#8FEDE1" stopOpacity="0.62" />
          <stop offset="0.45" stopColor="#3E9C94" stopOpacity="0.3" />
          <stop offset="1" stopColor="#0B2A2A" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sculpt-iris" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#BFA9FF" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#6152A8" stopOpacity="0.26" />
          <stop offset="1" stopColor="#150F2A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sculpt-underside" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#05070C" stopOpacity="0" />
          <stop offset="0.62" stopColor="#05070C" stopOpacity="0.28" />
          <stop offset="1" stopColor="#05070C" stopOpacity="0.72" />
        </linearGradient>
        <clipPath id="sculpt-clip">
          <path d={BAND} clipRule="evenodd" />
        </clipPath>
      </defs>

      <g transform="rotate(-32 350 281)">
        <path d={BAND} fillRule="evenodd" fill="url(#sculpt-body)" />
        <g clipPath="url(#sculpt-clip)">
          <ellipse cx="200" cy="345" rx="210" ry="130" fill="url(#sculpt-teal)" />
          <ellipse cx="500" cy="345" rx="210" ry="130" fill="url(#sculpt-iris)" />
          <rect x="0" y="230" width="700" height="420" fill="url(#sculpt-underside)" />
        </g>
        <path d={RIM} fill="none" stroke="url(#sculpt-rim)" strokeWidth="3.5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
