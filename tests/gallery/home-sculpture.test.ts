import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  SCULPTURE_DESIGN_BOUNDS,
  TitanSculpture,
} from '../../apps/gallery/app/_home/TitanSculpture.js';

// React runtime belongs to gallery; resolve from its declared dependency boundary.
const galleryRequire = createRequire(new URL('../../apps/gallery/package.json', import.meta.url));
const { createElement } = galleryRequire('react') as typeof import('react');
const { renderToStaticMarkup } = galleryRequire('react-dom/server') as typeof import('react-dom/server');

/**
 * 首屏钛金属 Möbius 雕塑（`_home/TitanSculpture.tsx`）的结构契约。
 *
 * 设计稿中的雕塑是 1860 个复合路径，按既定范围做「SVG 近似重建」。本文件锁住这次重建里
 * **看不见但会整环失效**的几何约定：
 *
 * 1. 环带是「外椭圆减内椭圆」，因此填充必须成环。SVG 的 `fill-rule` 默认是 `nonzero`，
 *    而内外两个子路径若同向绕行，绕数相加仍非 0，中空会被填实——这正是 2026-11-24
 *    修复的缺陷：当时误写了 `clip-rule`（该属性只在 `<clipPath>` 内生效，对填充毫无
 *    作用），结果雕塑渲染成一整个实心椭圆。
 * 2. 仅有 `fill-rule="evenodd"` 还不够稳：换渲染器、或有人删掉显式规则就会退化。所以
 *    再要求两个子路径**绕行方向相反**，这样 `nonzero` 与 `evenodd` 结论一致，双保险。
 * 3. 尺寸与位置钉在设计稿实测值上。设计稿雕塑（`tPIBb` 子树展开后的扫描线并集）外接盒
 *    为 x 128..587、y 113.5..523.7（700×650 帧内）。初版近似用了外 315×220、内 250×160、
 *    旋转 -22°，环大了约四分之一且偏低 45px；后按同一实测轮廓拟合出当前参数。这里断言
 *    旋转后的外接盒落在实测盒内，尺寸不再静默漂移。
 * 4. 反射层的 `clipPath` 必须与环带同一几何，否则青/紫反光会溢出到中空里，重新把洞糊住。
 * 5. 全部原生矢量：不允许出现位图或外部图像依赖（与设计稿一致）。
 *
 * 说明：Node 环境无法光栅化 SVG，所以「中空可见」以上述可判定的几何性质替代，
 * 视觉核对另由预览截图人工确认。
 */

const markup = renderToStaticMarkup(createElement(TitanSculpture, {}));

/** 取一段标签上的属性值；取不到返回空串（调用方另行断言非空）。 */
function attribute(tag: string, name: string): string {
  return new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
}

function pathByFill(markup: string, fill: string): string {
  const paths = [...markup.matchAll(/<path\b[^>]*>/g)].map((match) => match[0] ?? '');
  const found = paths.find((path) => path.includes(`fill="${fill}"`));
  expect(found, `应存在填充为 ${fill} 的路径`).toBeDefined();
  return found ?? '';
}

function clipShapePath(markup: string): string {
  const clip = /<clipPath[^>]*>([\s\S]*?)<\/clipPath>/.exec(markup);
  expect(clip, '应存在反射层 clipPath').not.toBeNull();
  const inner = clip?.[1] ?? '';
  const path = /<path\b[^>]*>/.exec(inner);
  expect(path, 'clipPath 内应有路径').not.toBeNull();
  return path?.[0] ?? '';
}

/** 环带填充路径：外椭圆起点 M95 281，填 `sculpt-body` 钛金属渐变。 */
const band = pathByFill(markup, 'url(#sculpt-body)');
const bandD = attribute(band, 'd');
const rotation = Number(/rotate\((-?\d+(?:\.\d+)?)/.exec(markup)?.[1] ?? Number.NaN);

/** 把 `d` 切成命令字母与数字；环带只用到 M/A/a/Z，别的一律视为意外。 */
function pathTokens(d: string): string[] {
  const tokens = d.match(/[MmAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  expect(tokens, '路径应可切分为命令与数字').not.toBeNull();
  return tokens!;
}

/** 每个子路径首段圆弧的扫掠标志：1 = 顺时针，0 = 逆时针（SVG 的 y 轴向下）。 */
function subpathSweeps(d: string): number[] {
  const tokens = pathTokens(d);
  const sweeps: number[] = [];
  let current: number | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token === 'M' || token === 'm') {
      if (current !== null) sweeps.push(current);
      current = null;
      i += 2; // 跳过 x y
      continue;
    }
    if (token === 'a' || token === 'A') {
      // a rx ry x-axis-rotation large-arc-flag sweep-flag x y
      if (current === null) current = Number(tokens[i + 5]);
      i += 6;
      continue;
    }
    if (token === 'Z' || token === 'z') {
      if (current !== null) sweeps.push(current);
      current = null;
    }
  }
  if (current !== null) sweeps.push(current);
  return sweeps;
}

/**
 * 从环带路径解析外椭圆的中心与半轴。
 *
 * 环带写作「左端点 → 右端点 → 回到左端点」的两段 180° 圆弧，因此两段弧的起止点
 * 横坐标中点即椭圆中心，`rx`/`ry` 就是圆弧参数。
 */
function outerEllipse(d: string): { cx: number; cy: number; rx: number; ry: number } {
  const tokens = pathTokens(d);
  // a rx ry x-axis-rotation large-arc-flag sweep-flag dx dy —— dx 是相对量，在第 9 位。
  const [, startX, startY, , rx, ry] = tokens;
  const endX = Number(startX) + Number(tokens[9]);
  expect(Number.isFinite(Number(startX)), '外椭圆起点横坐标应可解析').toBe(true);
  expect(Number.isFinite(Number(startY)), '外椭圆起点纵坐标应可解析').toBe(true);
  expect(Number.isFinite(Number(rx)), '外椭圆 rx 应可解析').toBe(true);
  expect(Number.isFinite(Number(ry)), '外椭圆 ry 应可解析').toBe(true);
  expect(Number.isFinite(endX), '外椭圆终点横坐标应可解析').toBe(true);
  return {
    cx: (Number(startX) + endX) / 2,
    cy: Number(startY),
    rx: Number(rx),
    ry: Number(ry),
  };
}

/** 旋转后半椭圆外接盒。 */
function rotatedBounds(ellipse: { cx: number; cy: number; rx: number; ry: number }, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const halfWidth = Math.hypot(ellipse.rx * cos, ellipse.ry * sin);
  const halfHeight = Math.hypot(ellipse.rx * sin, ellipse.ry * cos);
  return {
    left: ellipse.cx - halfWidth,
    right: ellipse.cx + halfWidth,
    top: ellipse.cy - halfHeight,
    bottom: ellipse.cy + halfHeight,
  };
}

const ellipse = outerEllipse(bandD);
const bounds = rotatedBounds(ellipse, rotation);

describe('首屏雕塑 · 环带中空几何', () => {
  it('环带由外椭圆与内椭圆两个子路径构成，且内椭圆更小', () => {
    expect(subpathSweeps(bandD)).toHaveLength(2);
    const [, , , , innerRx, innerRy] = pathTokens(bandD.slice(bandD.indexOf('M', 1)));
    expect(Number(innerRx)).toBeLessThan(ellipse.rx);
    expect(Number(innerRy)).toBeLessThan(ellipse.ry);
  });

  it('环带填充显式声明 evenodd，内椭圆被挖空', () => {
    expect(band).toContain('fill-rule="evenodd"');
  });

  it('两个子路径绕行方向相反，nonzero 规则下同样成环', () => {
    const [outer, inner] = subpathSweeps(bandD);
    expect(outer, '外椭圆扫掠标志').not.toBe(inner);
  });

  it('反射层裁剪路径与环带同一几何', () => {
    const clipPath = clipShapePath(markup);
    expect(clipPath).toContain('clip-rule="evenodd"');
    expect(attribute(clipPath, 'd')).toBe(bandD);
  });
});

describe('首屏雕塑 · 与设计稿实测轮廓的尺寸贴合', () => {
  const design = SCULPTURE_DESIGN_BOUNDS;
  const designWidth = design.right - design.left;
  const designHeight = design.bottom - design.top;

  it('雕塑帧与设计稿一致（700×650）', () => {
    expect(attribute(markup, 'viewBox')).toBe('0 0 700 650');
  });

  it('旋转后的外接盒落在设计稿实测盒内', () => {
    // 容差 12px：设计稿是扭曲的莫比乌斯带，本身就不是标准椭圆，允许近似环略有出入；
    // 但 2026-11-24 之前那版大了约四分之一（左侧外溢约 80px），这个量级必须拦住。
    const slack = 12;
    expect(bounds.left).toBeGreaterThanOrEqual(design.left - slack);
    expect(bounds.right).toBeLessThanOrEqual(design.right + slack);
    expect(bounds.top).toBeGreaterThanOrEqual(design.top - slack);
    expect(bounds.bottom).toBeLessThanOrEqual(design.bottom + slack);
  });

  it('外接盒宽度贴近设计稿实测宽度', () => {
    const width = bounds.right - bounds.left;
    expect(width).toBeGreaterThan(designWidth * 0.88);
    expect(width).toBeLessThanOrEqual(designWidth * 1.06);
  });

  it('外接盒高度不低于设计稿实测高度的八成', () => {
    // 设计稿是扭曲的莫比乌斯带，比同心椭圆环更"鼓"，允许近似环略矮。
    const height = bounds.bottom - bounds.top;
    expect(height).toBeGreaterThan(designHeight * 0.8);
    expect(height).toBeLessThanOrEqual(designHeight * 1.06);
  });

  it('中空口径与设计稿同级：内椭圆不超过外椭圆的三分之二', () => {
    const [, , , , innerRx, innerRy] = pathTokens(bandD.slice(bandD.indexOf('M', 1)));
    expect(Number(innerRx) / ellipse.rx).toBeLessThan(2 / 3);
    expect(Number(innerRy) / ellipse.ry).toBeLessThan(2 / 3);
  });
});

describe('首屏雕塑 · 原生矢量约束', () => {
  it('不引入位图或外部图像依赖', () => {
    expect(markup).not.toMatch(/<image\b/);
    expect(markup).not.toMatch(/data:image\//);
    expect(markup).not.toMatch(/https?:\/\//);
  });

  it('保留设计稿的钛金属层次：环带、亮缘、青/鸢尾反射、底部压暗', () => {
    expect(markup).toContain('id="sculpt-body"');
    expect(markup).toContain('id="sculpt-rim"');
    expect(markup).toContain('id="sculpt-teal"');
    expect(markup).toContain('id="sculpt-iris"');
    expect(markup).toContain('id="sculpt-underside"');
    expect(markup).toContain('clip-path="url(#sculpt-clip)"');
    expect(markup).toContain('transform="rotate(-32 350 281)"');
  });
});
