import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptySevenComponentsDraft } from '../../apps/admin/app/lib/uploads/manifest-form.js';

const REPO_ROOT = join(__dirname, '..', '..');
const GLOBALS_CSS_PATH = join(REPO_ROOT, 'apps', 'admin', 'app', 'globals.css');

const SESSION = { token: 'header.payload.signature', subject: 'web-developer-alice', roles: ['reader', 'publisher', 'maintainer'], channel: 'web' as const };

const navState = { pathname: '/assets', search: '' };

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement('a', { href, ...rest }, children as never),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(navState.search),
  redirect: vi.fn(),
}));

const authState = { session: SESSION as typeof SESSION | null };

vi.mock('../../apps/admin/app/lib/auth.js', () => ({
  SESSION_EXPIRED_EVENT: 'zhinexus:session-expired',
  companyLoginUrl: 'http://127.0.0.1:3000/v1/auth/oidc/start?target=admin',
  platformApiOrigin: 'http://127.0.0.1:3000',
  getStoredSession: () => authState.session,
  loadCompanySession: async () => authState.session,
  getAuthHeaders: () => (authState.session ? { authorization: `Bearer ${authState.session.token}` } : {}),
  getAuthCredentials: () => 'omit',
  saveSession: () => SESSION,
  clearSession: () => undefined,
  notifySessionExpired: () => undefined,
  logoutAndRedirect: () => undefined,
}));

/**
 * React 19 的 `use(params)` 在 SSR 会挂起；这里直接把已解析的 params 交回组件。
 * `injectQueue` 支持按调用顺序为指定 `useState` 注入首屏数据（如接入配置视图、作业状态或演示草稿）。
 */
const reactSeam = {
  injectNull: undefined as unknown,
  injectPredicate: null as ((init: unknown) => unknown | undefined) | null,
  params: { jobId: 'job-web-manual-001' },
};

const ACCESS_VIEW = {
  sections: {
    oidc: { generation: '0', history: [] as unknown[] },
    preview: { generation: '0', history: [] as unknown[] },
  },
  audit: [] as unknown[],
};

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
      if (reactSeam.injectPredicate) {
        const override = reactSeam.injectPredicate(init);
        if (override !== undefined) {
          return [override, () => undefined];
        }
      }
      if (reactSeam.injectNull !== undefined && init === null) {
        const injected = reactSeam.injectNull;
        reactSeam.injectNull = undefined;
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

function collectUsage(html: string): { classes: Set<string>; vars: Set<string> } {
  const classes = new Set<string>();
  for (const match of html.matchAll(/class="([^"]*)"/g)) {
    for (const name of match[1]!.split(/\s+/)) if (name) classes.add(name);
  }
  const vars = new Set<string>();
  for (const match of html.matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)) vars.add(match[1]!);
  return { classes, vars };
}

async function renderPage(load: () => Promise<{ default: unknown }>, props: Record<string, unknown> = {}): Promise<string> {
  const module = await load();
  const component = module.default as (props: Record<string, unknown>) => unknown;
  const element = component.constructor?.name === 'AsyncFunction' ? await component(props) : createElement(component as never, props as never);
  return renderToStaticMarkup(element as never);
}

const KNOWN_EXTERNAL_CLASSES = new Set<string>();

describe('控制台各画板可渲染且不引用未定义的样式', () => {
  let defined: Set<string>;
  let declared: Set<string>;

  beforeEach(() => {
    defined = cssClassNames();
    declared = cssVariables();
    authState.session = SESSION;
    navState.pathname = '/assets';
    navState.search = '';
    reactSeam.injectNull = undefined;
    reactSeam.injectPredicate = null;
  });

  it('全局外壳：未登录时拦截保护页并渲染登录核验态，已登录时提供自助改密入口', async () => {
    const { ZnShell } = await import('../../apps/admin/app/lib/design/shell.js');
    authState.session = null;
    navState.pathname = '/upload';
    const guestHtml = renderToStaticMarkup(createElement(ZnShell, null, createElement('div', null, 'secret')));
    expect(guestHtml).toContain('正在核验登录状态');
    expect(guestHtml).not.toContain('secret');

    authState.session = SESSION;
    reactSeam.injectPredicate = (init) => {
      if (typeof init === 'function') {
        const evaluated = (init as () => unknown)();
        if (evaluated === 'checking') return 'authenticated';
      }
      if (init === '') return SESSION.subject;
      return undefined;
    };
    const authedHtml = renderToStaticMarkup(createElement(ZnShell, null, createElement('div', null, 'workspace')));
    expect(authedHtml).toContain('workspace');
    expect(authedHtml).toContain('修改密码');
    expect(authedHtml).toContain('退出登录');
  });

  it('上传画板：默认空工作台与加载 14 个逐实现截图行及阻断提示均正常渲染', async () => {
    const emptyHtml = await renderPage(() => import('../../apps/admin/app/upload/page.js'));
    expect(emptyHtml).toContain('资产发布工作区 (Manual Release)');
    expect(emptyHtml).toContain('当前登录身份：');
    expect(emptyHtml).toContain('加载 7 组件演示草稿');
    expect(emptyHtml).toContain('尚未导入冻结发布清单');
    expect(emptyHtml).toContain('id="import-manifest-input"');
    expect(emptyHtml).toContain('id="import-files-input"');
    expect(emptyHtml).toContain('id="import-screenshots-input"');
    expect(emptyHtml).toContain('确认并提交发布');

    const demo = createEmptySevenComponentsDraft('0.0.6');
    reactSeam.injectPredicate = (init) => {
      if (init && typeof init === 'object' && 'channel' in init && (init as { channel?: unknown }).channel === 'web') {
        return demo.manifest;
      }
      if (Array.isArray(init) && init.length === 0) {
        return demo.manifest.variants.map((v) => v.variantId);
      }
      if (init && typeof init === 'object' && 'missingVariantIds' in init) {
        return {
          ok: false,
          missingVariantIds: demo.manifest.variants.map((v) => v.variantId),
          issues: [{ code: 'SCREENSHOT_REQUIRED', path: '/variants/0/screenshots', message: '缺少展示截图' }],
        };
      }
      return undefined;
    };
    const draftHtml = await renderPage(() => import('../../apps/admin/app/upload/page.js'));
    expect(draftHtml).toContain('阻断发布：存在未关联有效截图的组件实现');
    expect(draftHtml).toContain('SCREENSHOT_REQUIRED');
    expect(draftHtml).toContain('id="missing-screenshots-alert"');
    expect((draftHtml.match(/class="[^"]*variant-shot-card/g) ?? []).length).toBe(14);
    expect(draftHtml).toContain('data-upload-shot="line-vue"');
  });

  it('发布作业列表与详情画板：对齐 PUBLISHING 状态筛选，仅在 RETRY_WAIT 显示重试，READY 展示基线候选与资产入口', async () => {
    const listHtml = await renderPage(() => import('../../apps/admin/app/jobs/page.js'));
    expect(listHtml).toContain('发布作业');
    expect(listHtml).toContain('PUBLISHING');
    expect(listHtml).not.toContain('>RUNNING<');

    // RETRY_WAIT：允许重试
    reactSeam.injectNull = { state: 'RETRY_WAIT', stage: 'ENSURE_PACKAGES', attempt: 2, lastError: { code: 'REGISTRY_UNAVAILABLE' }, missingArtifacts: [] };
    const retryHtml = await renderPage(() => import('../../apps/admin/app/jobs/[jobId]/page.js'), {
      params: Promise.resolve({ jobId: 'job-web-manual-001' }),
    });
    expect(retryHtml).toContain('发布作业流水线状态跟踪');
    expect((retryHtml.match(/class="[^"]*pipeline-step/g) ?? []).length).toBe(7);
    expect(retryHtml).toContain('重试作业');

    // CONFLICT：不可变冲突终态不渲染重试按钮
    reactSeam.injectNull = { state: 'CONFLICT', stage: 'ENSURE_PACKAGES', attempt: 1, lastError: { code: 'CONFLICT' }, missingArtifacts: [] };
    const conflictHtml = await renderPage(() => import('../../apps/admin/app/jobs/[jobId]/page.js'), {
      params: Promise.resolve({ jobId: 'job-web-manual-001' }),
    });
    expect(conflictHtml).not.toContain('重试作业');

    // READY：展示基线候选与查看已发布资产链接
    reactSeam.injectNull = {
      state: 'READY',
      stage: 'READY',
      attempt: 1,
      missingArtifacts: [],
      baselineCandidates: [{ screenshotId: 'shot-uuid-1', sourceScreenshotId: 'shot-line-vue', variantId: 'line-vue', exampleId: 'default', environmentKey: 'a'.repeat(64) }],
    };
    const readyHtml = await renderPage(() => import('../../apps/admin/app/jobs/[jobId]/page.js'), {
      params: Promise.resolve({ jobId: 'job-web-manual-001' }),
    });
    expect(readyHtml).toContain('查看已发布资产');
    expect(readyHtml).toContain('line-vue');
  });

  it('资产管理与组件分类画板：支持分类筛选、分页、可见性切换、历史版本切换、基线修订更新、沙箱预览、材料报告与兼容登记', async () => {
    const assetsHtml = await renderPage(() => import('../../apps/admin/app/assets/page.js'));
    expect(assetsHtml).toContain('<h1>资产管理</h1>');
    expect(assetsHtml).toContain('01 / ASSET REGISTRY');
    expect(assetsHtml).toContain('aria-label="分类筛选"');
    expect(assetsHtml).toContain('aria-label="资产列表分页"');

    // 注入选中资产详情，验证完整检查器标签页与治理能力
    const releaseId = '11111111-1111-4111-8111-111111111111';
    const revisionId = '22222222-2222-4222-8222-222222222222';
    let nullIdx = 0;
    reactSeam.injectPredicate = (init) => {
      if (init === null) {
        nullIdx += 1;
        if (nullIdx === 2) return releaseId; // selectedId
        if (nullIdx === 3) {
          return {
            variantReleaseId: releaseId,
            availability: 'Ready',
            reportSource: 'local-automatic',
            baselineStatus: 'accepted',
            indexStatus: 'indexed',
            isPublic: false,
            baselineHeads: [{ exampleId: 'default', environmentKey: 'e'.repeat(64), revisionId, screenshotId: 'shot-1' }],
            package: {
              name: '@company/charts-vue',
              version: '0.1.0',
              dependencies: {},
              peerDependencies: { vue: '3.5.45', echarts: '6.1.0' },
              sourceDigest: 'c'.repeat(64),
              tarball: { path: 'packages/charts-vue-0.1.0.tgz', sha256: 'a'.repeat(64), bytes: 1024 },
            },
            variant: {
              componentId: 'line',
              variantId: 'line-vue',
              framework: 'vue',
              category: 'charts',
              packageName: '@company/charts-vue',
              packageVersion: '0.1.0',
              exportPath: './line',
              exportName: 'LineChart',
              api: { path: 'api/line-vue.json', sha256: 'd'.repeat(64), bytes: 120 },
              docs: { path: 'docs/line-vue.md', sha256: 'f'.repeat(64), bytes: 240 },
              examples: [],
              compatibility: [],
              screenshots: [
                {
                  id: 'shot-1',
                  variantId: 'line-vue',
                  framework: 'vue',
                  packageVersion: '0.1.0',
                  packageSha256: 'a'.repeat(64),
                  exampleId: 'default',
                  state: 'default',
                  environmentKey: 'e'.repeat(64),
                  source: 'local-automatic',
                  image: { path: 'screenshots/line-vue.png', sha256: 'b'.repeat(64), bytes: 512 },
                },
              ],
            },
          };
        }
      }
      if (init === '') {
        return 'shot-1';
      }
      return undefined;
    };
    const detailHtml = await renderPage(() => import('../../apps/admin/app/assets/page.js'));
    expect(detailHtml).toContain('role="tablist"');
    expect(detailHtml).toContain('概览与运维');
    expect(detailHtml).toContain('预览与截图');
    expect(detailHtml).toContain('文档与契约');
    expect(detailHtml).toContain('报告与兼容');
    expect(detailHtml).toContain('更新视觉基线');
    expect(detailHtml).toContain('组件可见性');
    expect(detailHtml).toContain('复制摘要');

    reactSeam.injectPredicate = null;
    const categoriesHtml = await renderPage(() => import('../../apps/admin/app/categories/page.js'));
    expect(categoriesHtml).toContain('<h1>组件分类</h1>');
    expect(categoriesHtml).toContain('04 / CATEGORY REGISTRY');
  });

  it('接入与配置画板：默认分区页头为「接入与配置」，标签页与审计区域齐备', async () => {
    reactSeam.injectNull = ACCESS_VIEW;
    const html = await renderPage(() => import('../../apps/admin/app/access-settings/page.js'));
    expect(html).toContain('<h1>接入与配置</h1>');
    expect(html).toContain('06 / ACCESS REGISTRY');
    expect(html).toContain('公司登录（OIDC）');
    expect(html).toContain('预览入口');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('保存草稿');
    expect(html).toContain('运行检查');
    expect(html).toContain('启用此版本');
    expect(html).toContain('aria-label="变更审计"');
    expect(html).toContain('data-testid="check-discovery"');
  });

  it('成员与权限画板：渲染指标行、成员目录、分页栏与不确定状态锁定提示', async () => {
    const html = await renderPage(() => import('../../apps/admin/app/users/page.js'));
    expect(html).toContain('成员与权限');
    expect(html).toContain('05 / IDENTITY LEDGER');
    expect(html).toContain('成员账号');
    expect(html).toContain('待设置密码');
    expect(html).toContain('新建成员');
    expect(html).toContain('操作审计');
    expect(html).toContain('aria-label="成员列表分页"');
  });

  it('匹配画板：渲染权限边界、上下文表单与两个精确匹配面板', async () => {
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

  it('全部画板与全局外壳的类名与 CSS 变量都在 globals.css 中有定义', async () => {
    const pages: Array<{ name: string; load: () => Promise<{ default: unknown }>; props: Record<string, unknown>; injectNull?: unknown }> = [
      { name: 'assets', load: () => import('../../apps/admin/app/assets/page.js'), props: {} },
      { name: 'upload', load: () => import('../../apps/admin/app/upload/page.js'), props: {} },
      { name: 'jobs', load: () => import('../../apps/admin/app/jobs/page.js'), props: {} },
      { name: 'job-detail', load: () => import('../../apps/admin/app/jobs/[jobId]/page.js'), props: { params: Promise.resolve({ jobId: 'job-web-manual-001' }) } },
      { name: 'categories', load: () => import('../../apps/admin/app/categories/page.js'), props: {} },
      { name: 'access-settings', load: () => import('../../apps/admin/app/access-settings/page.js'), props: {}, injectNull: ACCESS_VIEW },
      { name: 'users', load: () => import('../../apps/admin/app/users/page.js'), props: {} },
      { name: 'match', load: () => import('../../apps/admin/app/match/page.js'), props: {} },
      { name: 'login', load: () => import('../../apps/admin/app/login/page.js'), props: { searchParams: Promise.resolve(LOGIN_QUERY) } },
    ];
    const missingClasses = new Set<string>();
    const missingVars = new Set<string>();
    for (const { load, props, injectNull } of pages) {
      reactSeam.injectNull = injectNull;
      const { classes, vars } = collectUsage(await renderPage(load, props));
      for (const name of classes) if (!defined.has(name) && !KNOWN_EXTERNAL_CLASSES.has(name)) missingClasses.add(name);
      for (const name of vars) if (!declared.has(name)) missingVars.add(name);
    }
    const { ZnShell } = await import('../../apps/admin/app/lib/design/shell.js');
    reactSeam.injectPredicate = (init) => {
      if (typeof init === 'function' && (init as () => unknown)() === 'checking') return 'authenticated';
      return undefined;
    };
    const shellUsage = collectUsage(renderToStaticMarkup(createElement(ZnShell, null, createElement('div', null, 'ok'))));
    for (const name of shellUsage.classes) if (!defined.has(name) && !KNOWN_EXTERNAL_CLASSES.has(name)) missingClasses.add(name);
    for (const name of shellUsage.vars) if (!declared.has(name)) missingVars.add(name);

    expect([...missingClasses], '渲染出但 globals.css 未定义的类名').toEqual([]);
    expect([...missingVars], '引用到但 globals.css 未声明的 CSS 变量').toEqual([]);
  });
});
