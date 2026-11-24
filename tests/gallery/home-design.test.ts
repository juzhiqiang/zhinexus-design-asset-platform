import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACTION_SECTION,
  ASSET_SECTION,
  ATMOSPHERE_PRESETS,
  ATMOSPHERE_UNIFORMS,
  ECOSYSTEM,
  FRAMEWORK_SECTION,
  HERO,
  HOME_FOOTER,
  HOME_NAV,
  HOME_TOKENS,
  PROCESS_SECTION,
} from '../../apps/gallery/app/_home/home-content.js';

/**
 * 画廊介绍首页（画板 `00 介绍首页 · 科技朋克`）还原契约测试。
 *
 * 设计稿唯一事实来源是 `docs/design/gallery.pen` 的画板 `I0RAl`。本文件不重复
 * 抄写设计值，而是**从设计稿现读**，再与实现侧 `_home/home-content.ts` /
 * `_home/home.css` 比对，因此设计稿一改，这里立刻红——避免实现与设计稿悄悄漂移。
 *
 * 约定：
 * - 只覆盖首页自有分区；`/components`、`/library` 等既有公开页面不在本契约内；
 * - 文案比对忽略换行与连续空格（设计稿用 `\n` 断行，实现用同一字符串）；
 * - 首页导航/页脚中本应用没有路由的目标（接入文档、管理控制台）允许 `href: null`，
 *   但文案必须保留，不得静默删条。
 *
 * TDD 记录：`_home/home-content.ts` 尚未创建时本文件因无法解析导入而失败（RED）。
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const designPath = join(repoRoot, 'docs/design/gallery.pen');
const homeCssPath = join(repoRoot, 'apps/gallery/app/_home/home.css');

type PenNode = {
  id?: string;
  type?: string;
  name?: string;
  content?: string;
  children?: PenNode[];
  fill?: unknown;
  uniforms?: Record<string, unknown>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fontSize?: number;
};

function readDesignFrame(): PenNode {
  const design = JSON.parse(readFileSync(designPath, 'utf8')) as { children?: PenNode[] };
  const frame = (design.children ?? []).find((child) => child.id === 'I0RAl');
  expect(frame, 'gallery.pen 应包含画板 I0RAl（00 介绍首页 · 科技朋克）').toBeDefined();
  return frame!;
}

function collectTexts(node: PenNode, into: string[] = []): string[] {
  if (node.type === 'text' && typeof node.content === 'string' && node.content.length > 0) {
    into.push(node.content);
  }
  for (const child of node.children ?? []) collectTexts(child, into);
  return into;
}

function collectUniforms(node: PenNode, into: Record<string, unknown>[] = []): Record<string, unknown>[] {
  const fill = node.fill;
  if (Array.isArray(fill)) {
    for (const layer of fill) {
      if (layer && typeof layer === 'object' && (layer as { type?: string }).type === 'shader') {
        into.push((layer as { uniforms?: Record<string, unknown> }).uniforms ?? {});
      }
    }
  } else if (fill && typeof fill === 'object' && (fill as { type?: string }).type === 'shader') {
    into.push((fill as { uniforms?: Record<string, unknown> }).uniforms ?? {});
  }
  for (const child of node.children ?? []) collectUniforms(child, into);
  return into;
}

/** 设计稿用 `\n` 断行；JSON 序列化后会变成字面 `\\n`，先还原再去掉全部空白。 */
const normalize = (value: string): string => value.replace(/\\n/g, '\n').replace(/\s+/g, '');

/** `HOME_TOKENS` 用 camelCase 键，CSS 自定义属性惯例用 kebab-case。 */
const cssProperty = (name: string): string => `--home-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

function implementedCopy(): string {
  return normalize(
    JSON.stringify({
      nav: HOME_NAV,
      hero: HERO,
      ecosystem: ECOSYSTEM,
      assets: ASSET_SECTION,
      frameworks: FRAMEWORK_SECTION,
      process: PROCESS_SECTION,
      action: ACTION_SECTION,
      footer: HOME_FOOTER,
    }),
  );
}

describe('画廊首页还原 · 设计稿文案覆盖', () => {
  const frame = readDesignFrame();
  const texts = collectTexts(frame);

  it('设计稿首页画板存在可见文案', () => {
    expect(texts.length).toBeGreaterThan(80);
  });

  it('设计稿中每条首页文案都出现在实现侧内容模块', () => {
    const implemented = implementedCopy();
    const missing = [...new Set(texts)].filter((text) => !implemented.includes(normalize(text)));
    expect(missing, '设计稿有文案未落到 home-content.ts').toEqual([]);
  });

  it('内容模块不引入设计稿之外的首页营销文案', () => {
    // 只校验实现侧确实产出了设计稿的条数级别，不逐条反查（允许同文案多处复用）。
    expect(implementedCopy().length).toBeGreaterThan(600);
  });
});

describe('画廊首页还原 · 五层氛围背景契约', () => {
  const frame = readDesignFrame();
  const uniformsList = collectUniforms(frame);

  it('设计稿首页有且仅有五层 shader 背景', () => {
    expect(uniformsList).toHaveLength(5);
  });

  it('氛围预置与设计稿 shader 的 u_mode 一一对应', () => {
    const modes = uniformsList.map((uniforms) => uniforms.u_mode);
    expect(ATMOSPHERE_PRESETS.map((preset) => preset.mode)).toEqual(modes);
  });

  it('氛围预置的颜色与速度参数同设计稿一致', () => {
    for (const uniforms of uniformsList) {
      expect(ATMOSPHERE_UNIFORMS.u_speed).toBe(uniforms.u_speed);
      expect(ATMOSPHERE_UNIFORMS.u_frame).toBe(uniforms.u_frame);
      expect(ATMOSPHERE_UNIFORMS.u_base).toBe(uniforms.u_base);
      expect(ATMOSPHERE_UNIFORMS.u_blue).toBe(uniforms.u_blue);
      expect(ATMOSPHERE_UNIFORMS.u_iris).toBe(uniforms.u_iris);
    }
  });
});

describe('画廊首页还原 · 分区结构数量', () => {
  it('生态横带为四项双框架技术', () => {
    expect(ECOSYSTEM.items.map((item) => item.label)).toEqual(['Vue 3', 'React 19', 'ECharts 6', 'TypeScript']);
  });

  it('双框架徽章为 Vue 3 与 React 19', () => {
    expect(FRAMEWORK_SECTION.badges.map((badge) => badge.name)).toEqual(['Vue 3', 'React 19']);
  });

  it('接入流程为四步', () => {
    expect(PROCESS_SECTION.steps.map((step) => step.order)).toEqual(['01', '02', '03', '04']);
    expect(PROCESS_SECTION.steps.map((step) => step.title)).toEqual(['发现资产', '沙箱预览', '精确接入', '本地验证']);
  });

  it('空间序列为八根金属柱、趋势横轴为六个刻度', () => {
    expect(ASSET_SECTION.structure.window.sequenceLabels).toEqual(['01', '02', '03', '04', '05', '06', '07', '08']);
    expect(ASSET_SECTION.trend.window.axisLabels).toEqual(['01', '03', '05', '07', '09', '12']);
  });

  it('首页只暴露本应用真实存在的路由', () => {
    expect(HOME_NAV.links.filter((link) => link.href !== null).map((link) => link.href)).toEqual(['/', '/components']);
    expect(HOME_FOOTER.links.filter((link) => link.href !== null).map((link) => link.href)).toEqual(['/components']);
    // 设计稿保留接入文档与管理控制台入口文案，但不得指向不存在的公开路由。
    expect(HOME_FOOTER.links.map((link) => link.label)).toEqual(['组件画廊', '接入文档', '管理控制台']);
  });
});

describe('画廊首页还原 · 设计令牌落到 home.css', () => {
  const frame = readDesignFrame();
  const css = readFileSync(homeCssPath, 'utf8');
  const byId = new Map<string, PenNode>();
  (function index(node: PenNode): void {
    if (node.id) byId.set(node.id, node);
    for (const child of node.children ?? []) index(child);
  })(frame);

  const node = (id: string): PenNode => {
    const found = byId.get(id);
    expect(found, `设计稿画板应包含图层 ${id}`).toBeDefined();
    return found!;
  };

  it('home.css 存在', () => {
    expect(css.length).toBeGreaterThan(0);
  });

  it('每个设计令牌都在 home.css 中以设计稿取值声明', () => {
    for (const [name, token] of Object.entries(HOME_TOKENS)) {
      const declaration = `${cssProperty(name)}: ${token.value};`;
      expect(css, `home.css 缺少 ${declaration}`).toContain(declaration);
    }
  });

  it('午夜蓝底色来自设计稿画板填充', () => {
    expect(frame.fill).toBe(HOME_TOKENS.surface.value);
  });

  it('分区高度与留白取自设计稿度量', () => {
    expect(node('XfnxU').height).toBe(88);
    expect(HOME_TOKENS.navHeight.value).toBe('88px');
    expect(node('DkEmJ').height).toBe(720);
    expect(HOME_TOKENS.heroHeight.value).toBe('720px');
    // p5WT4「导航发丝线」：x=80、宽 1280，即内容宽与左右留白。
    expect(node('p5WT4').x).toBe(80);
    expect(node('p5WT4').width).toBe(1280);
    expect(HOME_TOKENS.gutter.value).toBe('80px');
    expect(HOME_TOKENS.containerWidth.value).toBe('1280px');
  });

  it('标题字号取自设计稿文字图层', () => {
    expect(node('T6bG4u').fontSize).toBe(76);
    expect(HOME_TOKENS.heroTitleSize.value).toBe('76px');
    expect(node('tPBZo').fontSize).toBe(42);
    expect(HOME_TOKENS.sectionTitleSize.value).toBe('42px');
  });

  it('文字与强调色取自设计稿填充', () => {
    expect(node('T6bG4u').fill).toBe(HOME_TOKENS.textPrimary.value);
    expect(node('d9HEG3').fill).toBe(HOME_TOKENS.textSecondary.value);
    expect(node('x9YccF').fill).toBe(HOME_TOKENS.textMuted.value);
    expect(node('OG6JD').fill).toBe(HOME_TOKENS.textFaint.value);
    expect(node('R5kOh').fill).toBe(HOME_TOKENS.accent.value);
    expect(node('i9VkUd').fill).toBe(HOME_TOKENS.accentIris.value);
  });
});
