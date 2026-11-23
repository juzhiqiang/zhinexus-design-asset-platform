#version 100
precision highp float;

/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/** @label Motion speed — set 0 to freeze
 * @default 1
 * @range 0, 1
 */
uniform float u_speed;
/** @label Still frame in seconds
 * @default 0
 * @range 0, 60
 */
uniform float u_frame;
/** @label Section composition
 * @default 0
 * @range 0, 4
 */
uniform float u_mode;
/** @label Deep midnight
 * @color
 * @default #080D1C
 */
uniform vec3 u_base;
/** @label Sapphire light
 * @color
 * @default #387BFF
 */
uniform vec3 u_blue;
/** @label Iris reflection
 * @color
 * @default #9164FF
 */
uniform vec3 u_iris;

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float light(vec2 uv, vec2 center, vec2 size) {
  vec2 p = (uv - center) / size;
  return exp(-dot(p, p) * 2.4);
}

void main() {
  vec2 uv = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_resolution;
  float t = u_time * u_speed + u_frame;
  float edge = smoothstep(0.0, 0.12, uv.y) * (1.0 - smoothstep(0.88, 1.0, uv.y));
  float right = smoothstep(0.38, 0.68, uv.x);
  vec2 drift = vec2(sin(t * 0.12), cos(t * 0.09)) * 0.018;
  vec3 color = u_base;
  vec2 center = vec2(0.82, 0.49);
  float power = 0.17;
  if (u_mode > 0.5 && u_mode < 1.5) {
    center = vec2(0.59, 0.61);
    power = 0.11;
  } else if (u_mode > 1.5 && u_mode < 2.5) {
    center = vec2(0.72, 0.41);
    power = 0.15;
  } else if (u_mode > 2.5 && u_mode < 3.5) {
    center = vec2(0.56, 0.68);
    power = 0.075;
  } else if (u_mode > 3.5) {
    center = vec2(0.83, 0.59);
    power = 0.14;
  }
  color += u_blue * light(uv, center + drift, vec2(0.36, 0.64)) * power * edge;
  color += u_iris * light(uv, vec2(0.98, 0.83) - drift, vec2(0.30, 0.38)) * 0.075 * edge;
  color += u_blue * light(uv, vec2(0.04, 0.86) + drift, vec2(0.12, 0.45)) * 0.065 * edge;

  float px = 1.0 / u_resolution.y;
  if (u_mode < 0.5) {
    vec2 p = uv - vec2(0.77, 0.45);
    p.y *= u_resolution.y / u_resolution.x;
    float a = -0.30;
    p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
    vec2 q = p / vec2(0.38, 0.225);
    float r = length(q);
    float ring = 1.0 - smoothstep(0.001, 0.007, abs(r - 1.0));
    float outer = 1.0 - smoothstep(0.001, 0.004, abs(r - 1.10));
    float segment = smoothstep(0.51, 0.65, uv.x) * (0.3 + 0.7 * smoothstep(0.38, 0.80, uv.y));
    float az = atan(q.y, q.x);
    float beadDistance = sin((az - t * 0.13) * 0.5) / 0.025;
    float bead = exp(-beadDistance * beadDistance);
    color += mix(u_blue, u_iris, uv.y) * (ring * 0.17 + outer * 0.075) * segment * edge;
    color += vec3(0.64, 0.80, 1.0) * ring * bead * 0.55 * segment * edge;
  } else if (u_mode < 1.5 || u_mode > 3.5) {
    float curve = 0.95 + 0.022 * sin(uv.x * 3.3 + u_mode * 0.7 + sin(t * 0.08) * 0.12);
    float line = 1.0 - smoothstep(px * 0.25, px * 1.0, abs(uv.y - curve));
    float glowDistance = (uv.y - curve) / 0.018;
    float travelDistance = (uv.x - fract(t / 28.0 + u_mode * 0.19)) / 0.035;
    float glow = exp(-glowDistance * glowDistance);
    float traveling = exp(-travelDistance * travelDistance);
    float end = u_mode < 1.5 ? 0.76 : 0.96;
    float margin = smoothstep(0.02, 0.20, uv.x) * (1.0 - smoothstep(end - 0.14, end, uv.x));
    color += mix(u_blue, u_iris, uv.x) * (line * (0.13 + 0.38 * traveling) + glow * 0.025) * margin * edge;
  }

  vec2 grid = vec2(17.0, max(4.0, u_resolution.y / 82.0));
  vec2 cell = floor(uv * grid);
  float seed = hash21(cell + u_mode * 21.0);
  vec2 star = vec2(hash21(cell + 7.3), hash21(cell + 9.8));
  star += vec2(sin(t * 0.06 + seed * 6.28), cos(t * 0.05 + seed * 6.28)) * 0.035;
  vec2 d = (fract(uv * grid) - (0.18 + star * 0.64)) * u_resolution / grid;
  float dotLight = exp(-dot(d, d) / 0.9);
  float twinkle = 0.48 + 0.18 * sin(t * 0.34 + seed * 25.0);
  float sparse = step(0.83, seed);
  float safe = max(right * 0.70, 1.0 - smoothstep(0.04, 0.12, uv.x));
  color += vec3(0.58, 0.73, 1.0) * dotLight * sparse * twinkle * safe * edge;
  gl_FragColor = vec4(color, 1.0);
}
