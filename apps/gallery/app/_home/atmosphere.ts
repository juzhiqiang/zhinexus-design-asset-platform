/**
 * 画廊首页五层氛围背景的 Canvas 2D 复刻。
 *
 * 设计稿是 `docs/design/shaders/gallery-atmosphere.glsl`（WebGL1）。本文件按同一
 * 套公式在 Canvas 2D 里逐项重算：午夜蓝底色、三处高斯光场、`u_mode` 分区构图
 * （0 倾斜星轨环 + 单颗游走光珠；1 / 4 底部光纤与慢速游光）、稀疏微粒与上下缘淡出。
 *
 * 坐标约定与 GLSL 一致：`uv.y` 自**上往下**（GLSL 里由 `u_resolution.y - gl_FragCoord.y`
 * 得到），因此 `edge` 淡出画布上缘 12% 与下缘 12%，光纤曲线 `uv.y ≈ 0.95` 位于底部。
 *
 * 纯计算模块，不 import React 或 DOM 类型。
 */

export type AtmosphereMode = 0 | 1 | 2 | 3 | 4;

const BASE: [number, number, number] = [0x08, 0x0d, 0x1c];
const BLUE: [number, number, number] = [0x38, 0x7b, 0xff];
const IRIS: [number, number, number] = [0x91, 0x64, 0xff];

/** GLSL 里按 `u_mode` 选择的主光场中心与强度。 */
const MODE_LIGHT: Record<AtmosphereMode, { x: number; y: number; power: number }> = {
  0: { x: 0.82, y: 0.49, power: 0.17 },
  1: { x: 0.59, y: 0.61, power: 0.11 },
  2: { x: 0.72, y: 0.41, power: 0.15 },
  3: { x: 0.56, y: 0.68, power: 0.075 },
  4: { x: 0.83, y: 0.59, power: 0.14 },
};

/** 与 GLSL `hash21` 同式，保证微粒位置在帧间与刷新间确定。 */
function hash21(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function mixChannel(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixRgb(t: number): [number, number, number] {
  return [
    mixChannel(BLUE[0], IRIS[0], t),
    mixChannel(BLUE[1], IRIS[1], t),
    mixChannel(BLUE[2], IRIS[2], t),
  ];
}

function rgba(color: [number, number, number], alpha: number): string {
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${clamped})`;
}

/** 加色叠加一处高斯光场：`exp(-|p|² * 2.4)`，`size` 为 uv 半宽。 */
function addLight(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  sizeX: number,
  sizeY: number,
  color: [number, number, number],
  power: number,
): void {
  const rx = sizeX * width;
  const ry = sizeY * height;
  if (rx <= 0 || ry <= 0 || power <= 0) return;
  ctx.save();
  ctx.translate(centerX * width, centerY * height);
  ctx.scale(rx, ry);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (let step = 0; step <= 8; step += 1) {
    const r = step / 8;
    gradient.addColorStop(r, rgba(color, Math.exp(-r * r * 2.4) * power));
  }
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 椭圆上按参数角取点；`scale` 1 为轨道本体、1.1 为外侧伴环。 */
function orbitPoint(
  phi: number,
  scale: number,
  cx: number,
  cy: number,
  ax: number,
  ay: number,
  cos: number,
  sin: number,
): [number, number] {
  const dx = scale * ax * Math.cos(phi);
  const dy = scale * ay * Math.sin(phi);
  return [cx + (cos * dx - sin * dy), cy + (sin * dx + cos * dy)];
}

function traceOrbit(
  ctx: CanvasRenderingContext2D,
  scale: number,
  cx: number,
  cy: number,
  ax: number,
  ay: number,
  cos: number,
  sin: number,
): void {
  ctx.beginPath();
  for (let step = 0; step <= 180; step += 1) {
    const phi = (step / 180) * Math.PI * 2;
    const [x, y] = orbitPoint(phi, scale, cx, cy, ax, ay, cos, sin);
    if (step === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** `u_mode = 0`：倾斜椭圆星轨 + 外侧伴环 + 一颗沿轨游走的细光珠。 */
function drawOrbit(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void {
  const cx = 0.77 * width;
  const cy = 0.45 * height;
  const ax = 0.38 * width;
  const ay = 0.225 * width;
  const angle = -0.3;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const lineWidth = Math.max(1.5, Math.min(ax, ay) * 0.014);

  ctx.save();
  // segment 的 x 分量：0.51 以下完全淡出。
  ctx.beginPath();
  ctx.rect(0.51 * width, 0, 0.49 * width, height);
  ctx.clip();
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';

  const stroke = (power: number): CanvasGradient => {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    const low = mixRgb(0.38);
    const mid = mixRgb(0.62);
    const high = mixRgb(1);
    gradient.addColorStop(0, rgba(low, 0.3 * power));
    gradient.addColorStop(0.38, rgba(low, 0.3 * power));
    gradient.addColorStop(0.62, rgba(mid, 0.65 * power));
    gradient.addColorStop(0.8, rgba(high, power));
    gradient.addColorStop(1, rgba(high, power));
    return gradient;
  };

  ctx.strokeStyle = stroke(0.17);
  traceOrbit(ctx, 1, cx, cy, ax, ay, cos, sin);
  ctx.stroke();

  ctx.strokeStyle = stroke(0.075);
  traceOrbit(ctx, 1.1, cx, cy, ax, ay, cos, sin);
  ctx.stroke();

  const beadPhi = (time * 0.13) % (Math.PI * 2);
  const [bx, by] = orbitPoint(beadPhi, 1, cx, cy, ax, ay, cos, sin);
  const radius = Math.max(2, width / 190);
  const bead = ctx.createRadialGradient(bx, by, 0, bx, by, radius);
  bead.addColorStop(0, 'rgba(163,204,255,0.55)');
  bead.addColorStop(1, 'rgba(163,204,255,0)');
  ctx.fillStyle = bead;
  ctx.beginPath();
  ctx.arc(bx, by, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** `u_mode = 1 / 4`：贴近底部的光纤横线、宽晕光与一段慢速游光。 */
function drawFiber(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  mode: AtmosphereMode,
): void {
  const end = mode < 1.5 ? 0.76 : 0.96;
  const phase = mode * 0.7 + Math.sin(time * 0.08) * 0.12;
  const curveAt = (u: number): number => 0.95 + 0.022 * Math.sin(u * 3.3 + phase);

  // margin：x 自 0.02 淡入，到 end 收束。
  const margin = (u: number): number =>
    smoothstep(0.02, 0.2, u) * (1 - smoothstep(end - 0.14, end, u));

  const horizontal = (power: number): CanvasGradient => {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    for (let step = 0; step <= 24; step += 1) {
      const u = step / 24;
      gradient.addColorStop(u, rgba(mixRgb(u), power * margin(u)));
    }
    return gradient;
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.lineWidth = Math.max(2, 0.036 * height);
  ctx.strokeStyle = horizontal(0.025);
  ctx.beginPath();
  for (let step = 0; step <= 120; step += 1) {
    const u = step / 120;
    const y = curveAt(u) * height;
    if (step === 0) ctx.moveTo(0, y);
    else ctx.lineTo(u * width, y);
  }
  ctx.stroke();

  ctx.lineWidth = Math.max(1, height / 720);
  ctx.strokeStyle = horizontal(0.13);
  ctx.beginPath();
  for (let step = 0; step <= 120; step += 1) {
    const u = step / 120;
    const y = curveAt(u) * height;
    if (step === 0) ctx.moveTo(0, y);
    else ctx.lineTo(u * width, y);
  }
  ctx.stroke();

  const travelU = (time / 28 + mode * 0.19) % 1;
  const tx = travelU * width;
  const ty = curveAt(travelU) * height;
  const rx = 0.035 * width;
  const ry = 0.018 * height;
  ctx.save();
  ctx.translate(tx, ty);
  ctx.scale(rx, ry);
  const travel = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  travel.addColorStop(0, rgba(IRIS, 0.38 * margin(travelU)));
  travel.addColorStop(1, rgba(IRIS, 0));
  ctx.fillStyle = travel;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

/** 稀疏微粒：17 × max(4, h/82) 网格中约 17% 的格子各有一颗慢漂微光。 */
function drawParticles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  mode: AtmosphereMode,
): void {
  const columns = 17;
  const rows = Math.max(4, height / 82);
  const cellH = height / rows;

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < Math.floor(rows); row += 1) {
      const seed = hash21(column + mode * 21, row);
      if (seed <= 0.83) continue;
      const starX = hash21(column + 7.3, row + mode * 21) + Math.sin(time * 0.06 + seed * 6.28) * 0.035;
      const starY = hash21(column + 9.8, row + mode * 21) + Math.cos(time * 0.05 + seed * 6.28) * 0.035;
      const u = (column + 0.18 + starX * 0.64) / columns;
      const v = (row + 0.18 + starY * 0.64) / rows;
      // safe：右侧整体压暗 30%，左侧 12% 保持全亮。
      const safe = Math.max(smoothstep(0.38, 0.68, u) * 0.7, 1 - smoothstep(0.04, 0.12, u));
      const alpha = (0.48 + 0.18 * Math.sin(time * 0.34 + seed * 25)) * safe;
      if (alpha <= 0.01) continue;
      const x = u * width;
      const y = v * height;
      const radius = Math.max(1.1, cellH * 0.3);
      const dot = ctx.createRadialGradient(x, y, 0, x, y, radius);
      dot.addColorStop(0, `rgba(148,186,255,${alpha})`);
      dot.addColorStop(1, 'rgba(148,186,255,0)');
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** 上下缘 12% 淡出，与 GLSL `edge` 一致；淡出后由分区底色接住。 */
function applyEdgeMask(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const mask = ctx.createLinearGradient(0, 0, 0, height);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(0.12, 'rgba(0,0,0,1)');
  mask.addColorStop(0.88, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * 绘制一帧氛围背景。
 *
 * @param time 累计秒；设计稿 `u_speed = 1`，因此直接传运行时长即可。
 */
export function drawAtmosphere(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: AtmosphereMode,
  time: number,
): void {
  if (width <= 0 || height <= 0) return;
  const light = MODE_LIGHT[mode];
  const driftX = Math.sin(time * 0.12) * 0.018;
  const driftY = Math.cos(time * 0.09) * 0.018;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = rgba(BASE, 1);
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = 'lighter';
  addLight(ctx, width, height, light.x + driftX, light.y + driftY, 0.36, 0.64, BLUE, light.power);
  addLight(ctx, width, height, 0.98 - driftX, 0.83 - driftY, 0.3, 0.38, IRIS, 0.075);
  addLight(ctx, width, height, 0.04 + driftX, 0.86 + driftY, 0.12, 0.45, BLUE, 0.065);

  if (mode === 0) drawOrbit(ctx, width, height, time);
  else if (mode === 1 || mode === 4) drawFiber(ctx, width, height, time, mode);

  drawParticles(ctx, width, height, time, mode);
  ctx.globalCompositeOperation = 'source-over';

  applyEdgeMask(ctx, width, height);
}

/** `u_speed = 0` 的静止代表帧（设计稿默认 `u_frame = 0`）。 */
export function drawAtmosphereStill(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: AtmosphereMode,
): void {
  drawAtmosphere(ctx, width, height, mode, 0);
}
