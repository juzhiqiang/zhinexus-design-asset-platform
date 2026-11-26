import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_MOTIFS,
  AURORA_FLOW_PATHS,
} from '../../apps/admin/app/lib/design/motifs.js';
import { ZN_COLOR_TOKENS, ZN_FONT_TOKENS, ZN_TOKENS, ZN_TOKEN_DECLARATIONS } from '../../apps/admin/app/lib/design/tokens.js';
import { ADMIN_NAV_ITEMS, ADMIN_TOOL_ITEMS, resolveActiveNavKey, resolveTopbarPage } from '../../apps/admin/app/lib/design/nav.js';

const REPO_ROOT = join(__dirname, '..', '..');
const PEN_PATH = join(REPO_ROOT, 'docs', 'design', 'management-api.pen');
const GLOBALS_CSS = join(REPO_ROOT, 'apps', 'admin', 'app', 'globals.css');
const LAYOUT_TSX = join(REPO_ROOT, 'apps', 'admin', 'app', 'layout.tsx');
const SHELL_TSX = join(REPO_ROOT, 'apps', 'admin', 'app', 'lib', 'design', 'shell.tsx');

interface PenDocument {
  variables: Record<string, { value: string } | string>;
  children: { id: string; name: string; children?: unknown[] }[];
}

function readPen(): PenDocument {
  return JSON.parse(readFileSync(PEN_PATH, 'utf8')) as PenDocument;
}

/** 去掉块注释，避免注释文本干扰声明解析与结构断言。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 取 `:root { ... }` 中的自定义属性声明（值可能跨多行，如渐变）。 */
function readRootDeclarations(): Map<string, string> {
  const css = stripComments(readFileSync(GLOBALS_CSS, 'utf8'));
  const start = css.indexOf(':root {');
  expect(start, 'globals.css 必须包含 :root').toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const close = css.indexOf('\n}', open);
  const body = css.slice(open + 1, close);
  const found = new Map<string, string>();
  for (const statement of body.split(';')) {
    const match = /^\s*(--[a-z0-9-]+):\s*([\s\S]+?)\s*$/.exec(statement);
    if (match) found.set(match[1]!, match[2]!.replace(/\s+/g, ' ').trim());
  }
  return found;
}

/**
 * CSS 自定义属性里的字体族必须加引号（`'Noto Sans SC'`），而 `.pen` 的变量值是裸族名。
 * 比对时剥掉 CSS 侧的首尾引号。
 */
function normalizeCssValue(value: string): string {
  const unquoted = /^'(.*)'$/.exec(value) ?? /^"(.*)"$/.exec(value);
  return unquoted ? unquoted[1]! : value;
}

describe('管理端设计令牌与 management-api.pen 一致', () => {
  const pen = readPen();

  it('令牌总数与 .pen variables 段相等（23 色 + 3 字体 = 26）', () => {
    expect(Object.keys(pen.variables)).toHaveLength(26);
    expect(Object.keys(ZN_COLOR_TOKENS)).toHaveLength(23);
    expect(Object.keys(ZN_FONT_TOKENS)).toHaveLength(3);
    expect(Object.keys(ZN_TOKENS)).toHaveLength(26);
  });

  it('tokens.ts 的 26 个变量与 .pen variables 逐值一致', () => {
    for (const [name, declared] of Object.entries(pen.variables)) {
      const expected = typeof declared === 'string' ? declared : declared.value;
      expect(ZN_TOKENS, `.pen 变量 ${name} 必须出现在 tokens.ts`).toHaveProperty(name);
      expect(ZN_TOKENS[name as keyof typeof ZN_TOKENS]).toBe(expected);
    }
  });

  it('globals.css 的 :root 为全部 26 个令牌声明了相同值', () => {
    const declared = readRootDeclarations();
    for (const [name, value] of Object.entries(ZN_TOKENS)) {
      expect(normalizeCssValue(declared.get(`--${name}`) ?? ''), `--${name} 必须在 :root 中声明且值一致`).toBe(value);
    }
    for (const [name, declaration] of Object.entries(ZN_TOKEN_DECLARATIONS)) {
      expect(declaration).toBe(`--${name}: ${ZN_TOKENS[name as keyof typeof ZN_TOKENS]};`);
    }
  });

  it(':root 只额外声明派生值，不重复或遗漏设计变量', () => {
    const declared = readRootDeclarations();
    const derived = ['--zn-font-sans', '--zn-font-mono', '--zn-font-display', '--zn-panel', '--zn-metric', '--zn-sidebar-bg', '--zn-primary', '--zn-avatar', '--zn-rail', '--zn-on-primary'];
    for (const name of derived) expect(declared.has(name), `${name} 应存在`).toBe(true);
    expect(declared.size).toBe(Object.keys(ZN_TOKENS).length + derived.length);
  });
});

describe('Command Motif 与画板一一对应', () => {
  const pen = readPen();
  const businessBoards = pen.children.filter(board => !board.name.includes('Design System'));

  it('六个业务画板各有一个 Command Motif，顺序即画板顺序', () => {
    expect(businessBoards).toHaveLength(6);
    expect(COMMAND_MOTIFS).toHaveLength(6);
    COMMAND_MOTIFS.forEach((motif, index) => {
      expect(motif.board).toBe(String(index + 1).padStart(2, '0'));
      expect(businessBoards[index]!.name).toContain(motif.board);
    });
  });

  it('Motif 标签与 .pen 的 Motif Telemetry Label 一致', () => {
    const expected = ['INGEST ORBIT / 01', 'SEQUENCE LOCK / 04', 'IDENTITY MESH / OIDC', 'GATE APERTURE / TLS', 'ACCESS CONSTELLATION / RBAC', 'VECTOR MATCH / 0.94'];
    expect(COMMAND_MOTIFS.map(motif => motif.label)).toEqual(expected);
  });

  it('每个 Motif 都有信号轨，且只有画板 03 带玻璃面板', () => {
    for (const motif of COMMAND_MOTIFS) {
      expect(motif.shapes.some(shape => shape.kind === 'rule')).toBe(true);
      expect(motif.shapes.length).toBeGreaterThan(1);
    }
    expect(COMMAND_MOTIFS.filter(motif => motif.panel).map(motif => motif.board)).toEqual(['03']);
  });

  it('Aurora 流径复用 .pen 的两条贝塞尔曲线几何', () => {
    expect(AURORA_FLOW_PATHS.map(path => path.d)).toEqual(['M0 430c220-310 520 130 1120-310', 'M0 120c360 290 710-120 1160 180']);
  });
});

describe('外壳结构约束', () => {
  it('layout 渲染 ZnShell，由外壳提供 div.zn-content 而不是 main，避免嵌套 main 地标', () => {
    const layout = stripComments(readFileSync(LAYOUT_TSX, 'utf8'));
    const shell = stripComments(readFileSync(SHELL_TSX, 'utf8'));
    expect(layout).toContain('<ZnShell>');
    expect(layout).not.toContain('<main');
    expect(shell).toContain('className="zn-content"');
    expect(shell).not.toContain('<main');
  });

  it('.zn-motif 必须 pointer-events:none，否则挡住页头交互', () => {
    const css = stripComments(readFileSync(GLOBALS_CSS, 'utf8'));
    const motifBlock = /\.zn-motif\s*\{[^}]*\}/.exec(css);
    expect(motifBlock, 'globals.css 必须定义 .zn-motif').not.toBeNull();
    expect(motifBlock![0]).toContain('pointer-events: none');
  });

  it('窄视口下不产生横向溢出：shell 在 960px 以下改为纵向堆叠', () => {
    const css = readFileSync(GLOBALS_CSS, 'utf8');
    expect(css).toMatch(/@media \(max-width: 960px\)/);
    expect(css).toMatch(/@media \(max-width: 640px\)/);
    expect(css).toContain('overflow-x: hidden');
  });
});

describe('侧栏导航与顶栏标题', () => {
  it('主导航为 6 个真实业务域，序号 01–06，辅助工具包含项目上下文匹配', () => {
    expect(ADMIN_NAV_ITEMS.map(item => item.order)).toEqual(['01', '02', '03', '04', '05', '06']);
    expect(ADMIN_NAV_ITEMS.map(item => item.href)).toEqual(['/assets', '/upload', '/jobs', '/categories', '/users', '/access-settings']);
    expect(ADMIN_TOOL_ITEMS.map(item => item.href)).toEqual(['/match']);
  });

  it('导航标签使用完整名称，保证 getByRole link 名称可命中', () => {
    expect(ADMIN_NAV_ITEMS.map(item => item.label)).toEqual(['资产管理', '上传发布', '发布作业', '组件分类', '成员与权限', '接入与配置']);
    expect(ADMIN_TOOL_ITEMS.map(item => item.label)).toEqual(['项目上下文匹配']);
  });

  it('路由与分区高亮一一对应，/login 不属于任何分区', () => {
    expect(resolveActiveNavKey('/assets')).toBe('assets');
    expect(resolveActiveNavKey('/upload')).toBe('upload');
    expect(resolveActiveNavKey('/jobs')).toBe('jobs');
    expect(resolveActiveNavKey('/jobs/job-web-manual-001')).toBe('jobs');
    expect(resolveActiveNavKey('/categories')).toBe('categories');
    expect(resolveActiveNavKey('/users')).toBe('users');
    expect(resolveActiveNavKey('/access-settings')).toBe('access');
    expect(resolveActiveNavKey('/match')).toBe('match');
    expect(resolveActiveNavKey('/login')).toBeNull();
  });

  it('顶栏页面名跟随路由', () => {
    expect(resolveTopbarPage('/assets')).toBe('资产管理');
    expect(resolveTopbarPage('/upload')).toBe('上传发布');
    expect(resolveTopbarPage('/jobs')).toBe('发布作业');
    expect(resolveTopbarPage('/jobs/job-web-manual-001')).toBe('发布作业');
    expect(resolveTopbarPage('/categories')).toBe('组件分类');
    expect(resolveTopbarPage('/users')).toBe('成员与权限');
    expect(resolveTopbarPage('/access-settings')).toBe('接入与配置');
    expect(resolveTopbarPage('/match')).toBe('项目上下文匹配');
    expect(resolveTopbarPage('/login')).toBe('账号登录');
  });
});
