import type { ReactNode } from 'react';

/**
 * 设计稿渐变 → SVG 渐变的小桥。
 *
 * `gallery.pen` 的线性渐变用 `rotation`（度，0 指向上、90 指向右，与 CSS
 * `linear-gradient` 角度同向）+ 归一化色标描述，且色标区间铺满图形边界框。
 * 这里换算成 SVG `linearGradient` 的 `objectBoundingBox` 向量，避免手推坐标。
 */

export type GradientStop = { color: string; position: number };

export function gradientVector(rotation: number): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const radians = (rotation * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return {
    x1: 0.5 - sin / 2,
    y1: 0.5 + cos / 2,
    x2: 0.5 + sin / 2,
    y2: 0.5 - cos / 2,
  };
}

export function PencilLinearGradient({
  id,
  rotation,
  stops,
}: {
  id: string;
  rotation: number;
  stops: readonly GradientStop[];
}) {
  return (
    <linearGradient id={id} {...gradientVector(rotation)}>
      {stops.map((stop) => (
        <stop key={`${stop.position}-${stop.color}`} offset={stop.position} stopColor={stop.color} />
      ))}
    </linearGradient>
  );
}

export function PencilRadialGradient({
  id,
  stops,
}: {
  id: string;
  stops: readonly GradientStop[];
}): ReactNode {
  return (
    <radialGradient id={id} cx="0.5" cy="0.5" r="0.5">
      {stops.map((stop) => (
        <stop key={`${stop.position}-${stop.color}`} offset={stop.position} stopColor={stop.color} />
      ))}
    </radialGradient>
  );
}
