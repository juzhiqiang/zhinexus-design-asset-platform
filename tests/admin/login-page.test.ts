import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/**
 * `/login` render contract. The page is a server component with no client script: it takes the
 * authorization parameters the API hands it, puts them back into a native form, and lets the
 * browser post the credentials straight to the identity service. Everything asserted here is
 * therefore about what the server actually emits.
 *
 * `lib/auth` is used un-mocked on purpose: the form action is built from the same
 * `platformApiOrigin` every other console page uses, so the test pins that value the same way the
 * app derives it.
 */

const REPO_ROOT = join(__dirname, '..', '..');
const GLOBALS_CSS_PATH = join(REPO_ROOT, 'apps', 'admin', 'app', 'globals.css');
process.env.NEXT_PUBLIC_PLATFORM_API_URL = 'http://127.0.0.1:3000';
const API_ORIGIN = 'http://127.0.0.1:3000';

const STATE = 's'.repeat(43);
const CHALLENGE = 'c'.repeat(43);
const NONCE = 'n'.repeat(43);

/** A well-formed authorization request, as `CompanyOidc.start` builds it for the admin target. */
const request = {
  client_id: 'zhinexus-web',
  redirect_uri: 'https://api.example.com/v1/auth/oidc/callback',
  state: STATE,
  code_challenge: CHALLENGE,
  nonce: NONCE,
  scope: 'openid',
};

async function render(query: Record<string, string | string[] | undefined>): Promise<string> {
  const module = await import('../../apps/admin/app/login/page.js');
  const element = await (module.default as (props: unknown) => Promise<unknown>)({ searchParams: Promise.resolve(query) });
  return renderToStaticMarkup(element as never);
}

/** Fields the page mirrors the service's validators on, with a value the service would reject. */
const REJECTED_FIELDS: ReadonlyArray<{ field: string; value: string }> = [
  { field: 'client_id', value: 'not a client id' },
  { field: 'redirect_uri', value: 'http://api.example.com/v1/auth/oidc/callback' },
  { field: 'redirect_uri', value: 'https://api.example.com/v1/auth/oidc/callback?next=https://evil.example.com' },
  { field: 'redirect_uri', value: 'https://user:secret@api.example.com/v1/auth/oidc/callback' },
  { field: 'redirect_uri', value: 'https://api.example.com/' },
  { field: 'state', value: 'short' },
  { field: 'code_challenge', value: 'tooshort' },
  { field: 'nonce', value: 'tooshort' },
];

describe('登录页渲染授权表单', () => {
  it('接受配置匹配的精确本地回调，拒绝其他回环端口与路径', async () => {
    expect(await render({ ...request, redirect_uri: API_ORIGIN + '/v1/auth/oidc/callback' })).toContain('method="post"');
    for (const redirect_uri of ['http://127.0.0.1:3001/v1/auth/oidc/callback', API_ORIGIN + '/other', 'http://127.0.0.1.attacker.test:3000/v1/auth/oidc/callback']) {
      expect(await render({ ...request, redirect_uri })).toContain('登录入口无效或已过期');
    }
  });
  it('以原生表单把凭据直接 POST 到身份服务授权端点', async () => {
    const html = await render(request);
    expect(html).toContain('method="post"');
    expect(html).toContain(`action="${API_ORIGIN}/identity/authorize"`);
    expect((html.match(/type="hidden"/g) ?? []).length).toBe(6);
    expect(html).toContain('name="client_id" value="zhinexus-web"');
    expect(html).toContain('name="redirect_uri" value="https://api.example.com/v1/auth/oidc/callback"');
    expect(html).toContain(`name="state" value="${STATE}"`);
    expect(html).toContain(`name="code_challenge" value="${CHALLENGE}"`);
    expect(html).toContain(`name="nonce" value="${NONCE}"`);
    expect(html).toContain('name="scope" value="openid"');
    expect(html).toContain('name="username"');
    expect(html).toContain('name="password"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('name="new_password"');
    expect(html).toContain('管理员登录');
  });

  it('没有 nonce 时仍可渲染，与服务端把 nonce 当可选一致', async () => {
    const withoutNonce: Record<string, string> = {};
    for (const [key, value] of Object.entries(request)) if (key !== 'nonce') withoutNonce[key] = value;
    const html = await render(withoutNonce);
    expect(html).toContain(`action="${API_ORIGIN}/identity/authorize"`);
    expect(html).not.toContain('name="nonce"');
    expect((html.match(/type="hidden"/g) ?? []).length).toBe(5);
  });

  it('首次登录必须换密：渲染新密码字段与口令策略提示', async () => {
    const html = await render({ ...request, reason: 'first-login' });
    expect(html).toContain('name="new_password"');
    expect(html).toContain('首次登录必须设置新密码');
    expect(html).toContain('至少 12 个字符');
  });

  it('凭据被拒时只给通用文案，并保留已填写的用户名', async () => {
    const html = await render({ ...request, reason: 'credentials', username: 'lin.wei' });
    expect(html).toContain('用户名或密码不正确。');
    expect(html).toContain('name="username" value="lin.wei"');
    expect(html).not.toContain('name="new_password"');
  });

  it('未知 reason 退回到最保守的提示，而不是渲染空提示', async () => {
    const html = await render({ ...request, reason: 'something-new' });
    expect(html).toContain('本次登录未通过校验，请检查填写内容后重试。');
    expect(html).toContain(`action="${API_ORIGIN}/identity/authorize"`);
  });

  it('没有 reason 时不渲染任何错误条', async () => {
    const html = await render(request);
    expect(html).not.toContain('access-error');
  });

  for (const { field, value } of REJECTED_FIELDS) {
    it(`入口参数 ${field} 畸形时不给表单，只给重新进入的出口`, async () => {
      const html = await render({ ...request, [field]: value });
      expect(html).not.toContain('<form');
      expect(html).not.toContain('identity/authorize');
      expect(html).toContain('登录入口无效或已过期');
      expect(html).toContain(`href="${API_ORIGIN}/v1/auth/oidc/start?target=admin"`);
      expect(html).not.toContain(value);
    });
  }

  it('全部参数缺失时渲染默认登录入口与凭证登录，不渲染本地授权端点表单', async () => {
    const html = await render({});
    expect(html).not.toContain('identity/authorize');
    expect(html).toContain('登录后开放');
    expect(html).toContain(`href="${API_ORIGIN}/v1/auth/oidc/start?target=admin"`);
    expect(html).toContain('id="token-input"');
  });

  it('不引用 globals.css 未定义的类名', async () => {
    const css = readFileSync(GLOBALS_CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const defined = new Set<string>();
    for (const match of css.matchAll(/\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g)) defined.add(match[1]!);
    const html = await render({ ...request, reason: 'first-login' });
    const missing = new Set<string>();
    for (const match of html.matchAll(/class="([^"]*)"/g)) {
      for (const name of match[1]!.split(/\s+/)) if (name && !defined.has(name)) missing.add(name);
    }
    expect([...missing], '渲染出但 globals.css 未定义的类名').toEqual([]);
  });
});
