import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..');
const GLOBALS_CSS_PATH = join(REPO_ROOT, 'apps', 'admin', 'app', 'globals.css');

const SESSION = { token: 'header.payload.signature', subject: 'web-developer-alice', roles: ['publisher', 'maintainer'], channel: 'web' as const };

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}));

vi.mock('../../apps/admin/app/lib/auth.js', () => ({
  companyLoginUrl: 'http://127.0.0.1:3000/v1/auth/oidc/start?target=admin',
  platformApiOrigin: 'http://127.0.0.1:3000',
  getStoredSession: () => SESSION,
  loadCompanySession: async () => SESSION,
  saveSession: () => SESSION,
  clearSession: () => undefined,
}));

/**
 * React 19 的 `use(params)` 在 SSR 会挂起；这里直接把已解析的 params 交回组件。
 * 另有一个一次性注入开关：各页面的首屏数据（登录会话 / 接入配置视图）都写在 useEffect 的
 * 异步回调里，SSR 永远只能渲染登录门，因此把这个值注入首个 `useState(null)`，
 * 才能验证「14 个逐实现截图行」「接入设置分区页头」等登录后契约。
 */
const reactSeam = { inject: null as unknown, params: { jobId: 'job-web-manual-001' } };

const ACCESS_VIEW = {
  sections: {
    oidc: { generation: '0', history: [] as unknown[] },
    preview: { generation: '0', history: [] as unknown[] },
  },
  audit: [] as unknown[],
};

/** 形状合法的授权请求，与本地身份服务 `CompanyOidc.start` 生成的参数同形。 */
const LOGIN_QUERY = {
  client_id: 'zhinexus-web',
  redirect_uri: 'https://api.example.com/v1/auth/oidc/callback',
  state: 's'.repeat(43),
  code_challenge: 'c'.repeat(43),
  nonce: 'n'.repeat(43),
  scope: 'openid',
};

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    use: (value: unknown) => {
      if (value && typeof (value as { then?: unknown }).then === 'function') return reactSeam.params;
      return value === undefined || value === null ? undefined : actual.use(value as never);
    },
    useState: (init: unknown) => {
      if (reactSeam.inject !== null && init === null) {
        const injected = reactSeam.inject;
        reactSeam.inject = null;
        return [injected, () => undefined];
      }
      return actual.useState(init as never);
    },
  };
});

function cssClassNames(): Set<string> {
  const css = readFileSync(GLOBALS_CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set<string>();
  for (const match of css.matchAll(/\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g)) names.add(match[1]!);
  return names;
}

function cssVariables(): Set<string> {
  const css = readFileSync(GLOBALS_CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set<string>();
  for (const match of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) names.add(match[1]!);
  return names;
}

/** 收集渲染结果里用到的类名与 var() 引用。 */
function collectUsage(html: string): { classes: Set<string>; vars: Set<string> } {
  const classes = new Set<string>();
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const name of match[1]!.split(/\s+/)) if (name) classes.add(name);
  }
  const vars = new Set<string>();
  for (const match of html.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)) vars.add(match[1]!);
  return { classes, vars };
}

/**
 * 渲染一个页面组件。服务端组件（`/login`）是 async 函数，调用后拿到的是元素；
 * 客户端组件必须照旧走 `createElement` + `renderToStaticMarkup`——直接调用会让它的 hook 在
 * React 渲染之外执行，dispatcher 是 null。所以按「是不是 async 函数」分流，而不是先调用再看。
 *
 * 加载器只承诺 `default` 存在：各画板的 props 形状不同（`params`、`searchParams`、无参），
 * 写死成 `() => unknown` 会让带 props 的画板在类型上就不合法。
 */
async function renderPage(load: () => Promise<{ default: unknown }>, props: Record<string, unknown> = {}): Promise<string> {
  const module = await load();
  const component = module.default as (props: Record<string, unknown>) => unknown;
  const element = component.constructor?.name === 'AsyncFunction' ? await component(props) : createElement(component as never, props as never);
  return renderToStaticMarkup(element as never);
}

/** 类名 → 定义处；只列当前 globals.css 未覆盖的（组件内联样式类名另有来源时忽略）。 */
const KNOWN_EXTERNAL_CLASSES = new Set<string>();

describe('控制台各画板可渲染且不引用未定义的样式', () => {
  let defined: Set<string>;
  let declared: Set<string>;

  beforeEach(() => {
    defined = cssClassNames();
    declared = cssVariables();
  });

  it('上传画板：登录后渲染 14 个逐实现截图行与阻断提示', async () => {
    reactSeam.inject = SESSION;
    const html = await renderPage(() => import('../../apps/admin/app/upload/page.js'));
    expect(html).toContain('资产发布工作区 (Manual Release)');
    expect(html).toContain('当前登录身份：');
    expect(html).toContain('逐实现截图关联与必检清单');
    expect(html).toContain('阻断发布：存在未关联有效截图的组件实现');
    expect(html).toContain('SCREENSHOT_REQUIRED');
    expect(html).toContain('id="import-manifest-input"');
    expect(html).toContain('id="import-files-input"');
    expect(html).toContain('id="import-screenshots-input"');
    expect(html).toContain('id="missing-screenshots-alert"');
    expect(html).toContain('确认并提交发布');
    expect((html.match(/class="[^"]*variant-shot-card/g) ?? []).length).toBe(14);
    expect(html).toContain('data-upload-shot="line-vue"');
  });

  it('上传画板：未登录时渲染登录门', async () => {
    reactSeam.inject = null;
    const auth = await import('../../apps/admin/app/lib/auth.js');
    (auth as { getStoredSession: () => unknown }).getStoredSession = () => null;
    const html = await renderPage(() => import('../../apps/admin/app/upload/page.js'));
    expect(html).toContain('登录后开放');
    expect(html).toContain('此处提供组件发布功能');
    expect(html).toContain('id="token-input"');
    (auth as { getStoredSession: () => unknown }).getStoredSession = () => SESSION;
  });

  it('发布作业画板：渲染 7 步步骤器与四个可达性检查', async () => {
    const html = await renderPage(() => import('../../apps/admin/app/jobs/[jobId]/page.js'), {
      params: Promise.resolve({ jobId: 'job-web-manual-001' }),
    });
    expect(html).toContain('发布作业流水线状态跟踪');
    expect(html).toContain('作业编号：');
    for (const stage of ['PENDING', 'FINALIZE_OBJECTS', 'ENSURE_PACKAGES', 'REGISTER_ASSETS', 'CHECK_AVAILABILITY', 'READY_TX', 'READY']) {
      expect(html).toContain(stage);
    }
    expect((html.match(/class="[^"]*pipeline-step/g) ?? []).length).toBe(7);
    expect(html).toContain('冻结对象摘要');
    expect(html).toContain('Verdaccio 包版本');
    expect(html).toContain('静态预览入口');
    expect(html).toContain('PostgreSQL 事务');
  });

  it('接入设置画板：默认分区页头为「接入设置」，标签页与审计区域齐备', async () => {
    reactSeam.inject = ACCESS_VIEW;
    const html = await renderPage(() => import('../../apps/admin/app/access-settings/page.js'));
    expect(html).toContain('<h1>接入设置</h1>');
    expect(html).toContain('03 / ACCESS REGISTRY');
    expect(html).toContain('公司登录（OIDC）');
    expect(html).toContain('预览入口');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('保存草稿');
    expect(html).toContain('运行检查');
    expect(html).toContain('启用此版本');
    expect(html).toContain('aria-label="变更审计"');
    // 默认分区是公司登录，check-tls 属于预览入口分区（Playwright 切 tab 后才断言它）
    expect(html).toContain('data-testid="check-discovery"');
  });

  it('用户与权限画板：渲染指标行、成员目录与账号操作', async () => {
    reactSeam.inject = SESSION;
    const html = await renderPage(() => import('../../apps/admin/app/users/page.js'));
    expect(html).toContain('用户与权限');
    expect(html).toContain('05 / IDENTITY LEDGER');
    expect(html).toContain('成员账号');
    expect(html).toContain('待首次改密');
    expect(html).toContain('创建账号');
    expect(html).toContain('读取记录');
  });

  it('匹配画板：渲染权限边界、上下文表单与两个精确匹配面板', async () => {
    reactSeam.inject = SESSION;
    const html = await renderPage(() => import('../../apps/admin/app/match/page.js'));
    expect(html).toContain('项目上下文匹配');
    expect(html).toContain('06 / PROJECT INTELLIGENCE');
    expect(html).toContain('权限边界 / 本地项目保持私有');
    for (const id of ['framework-select', 'framework-version-input', 'echarts-version-input', 'package-manager-select', 'requirement-input', 'requirements-list', 'context-submit', 'search-query-input', 'react-dom-version-input', 'search-submit']) {
      expect(html, `缺少 #${id}`).toContain(`id="${id}"`);
    }
    expect(html).toContain('校验项目上下文');
    expect(html).toContain('检索候选');
  });

  it('全部画板的类名与 CSS 变量都在 globals.css 中有定义', async () => {
    const pages: Array<{ load: () => Promise<{ default: unknown }>; props: Record<string, unknown> }> = [
      { load: () => import('../../apps/admin/app/upload/page.js'), props: {} },
      { load: () => import('../../apps/admin/app/jobs/[jobId]/page.js'), props: { params: Promise.resolve({ jobId: 'job-web-manual-001' }) } },
      { load: () => import('../../apps/admin/app/access-settings/page.js'), props: {} },
      { load: () => import('../../apps/admin/app/users/page.js'), props: {} },
      { load: () => import('../../apps/admin/app/match/page.js'), props: {} },
      { load: () => import('../../apps/admin/app/login/page.js'), props: { searchParams: Promise.resolve(LOGIN_QUERY) } },
    ];
    const missingClasses = new Set<string>();
    const missingVars = new Set<string>();
    for (const { load, props } of pages) {
      reactSeam.inject = load === pages[2]!.load ? ACCESS_VIEW : SESSION;
      const { classes, vars } = collectUsage(await renderPage(load, props));
      for (const name of classes) if (!defined.has(name) && !KNOWN_EXTERNAL_CLASSES.has(name)) missingClasses.add(name);
      for (const name of vars) if (!declared.has(name)) missingVars.add(name);
    }
    expect([...missingClasses], '渲染出但 globals.css 未定义的类名').toEqual([]);
    expect([...missingVars], '引用到但 :root 未声明的 CSS 变量').toEqual([]);
  });
});
