import { ZnIcon } from '../lib/design/icons';
import { companyLoginUrl, platformApiOrigin } from '../lib/auth';
import { TokenLoginForm } from './TokenLoginForm';

/** 与 `apps/api/src/identity/local/service.ts` 的 `request()` 同一套形状；服务端仍是最终裁判。 */
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^[A-Za-z0-9_-]{8,512}$/;

type AuthorizationRequest = { clientId: string; redirectUri: string; state: string; codeChallenge: string; nonce: string };

function authorizationRequest(params: URLSearchParams): AuthorizationRequest | null {
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const state = params.get('state') ?? '';
  const codeChallenge = params.get('code_challenge') ?? '';
  const nonce = params.get('nonce') ?? '';
  if (!CLIENT_ID.test(clientId) || !STATE.test(state) || !TOKEN.test(codeChallenge) || (nonce && !TOKEN.test(nonce))) return null;
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { return null; }
  const api = new URL(platformApiOrigin);
  const localCallback = process.env.NODE_ENV !== 'production' && api.protocol === 'http:' && api.hostname === '127.0.0.1'
    && redirect.origin === api.origin && redirectUri === api.origin + '/v1/auth/oidc/callback';
  if ((redirect.protocol !== 'https:' && !localCallback) || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname === '/' || redirect.href !== redirectUri) return null;
  return { clientId, redirectUri, state, codeChallenge, nonce };
}

const REASON_TEXT: Record<string, string> = {
  credentials: '用户名或密码不正确。',
  'first-login': '首次登录必须设置新密码，设置完成后即可进入管理端。',
  disabled: '该账号已停用，请联系平台管理员。',
  'invalid-request': '本次登录未通过校验，请检查填写内容后重试。',
  unavailable: '登录服务暂时不可用，请稍后重试。',
};
const ENTRY_INVALID_TEXT = '登录入口无效或已过期，请从管理端重新进入。';

export const metadata = { title: '管理员登录' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === 'string') query.set(key, value);
  const request = authorizationRequest(query);
  const hasAuthParams = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'nonce', 'reason'].some(key => query.has(key));
  const nextPath = query.get('next') ?? undefined;
  const reason = query.get('reason') ?? '';
  const notice = reason ? REASON_TEXT[reason] ?? REASON_TEXT['invalid-request'] : undefined;
  const username = query.get('username') ?? '';
  const firstLogin = reason === 'first-login';

  return (
    <main className="zn-login-main">
      <section className="access-panel zn-login-card">
        <div className="zn-login-brand">
          <span className="zn-login-app-icon" aria-hidden="true">Z</span>
          <h1>管理员登录</h1>
          <p className="zn-login-subtitle">Zhinexus 组件资产管理控制台</p>
        </div>

        {request ? (
          <>
            <h2 className="zn-sr-only">账号登录</h2>
            {notice ? <p className="access-error" role="alert">{notice}</p> : null}
            <form className="zn-login-form" method="post" action={`${platformApiOrigin}/identity/authorize`}>
              <input type="hidden" name="client_id" value={request.clientId} />
              <input type="hidden" name="redirect_uri" value={request.redirectUri} />
              <input type="hidden" name="state" value={request.state} />
              <input type="hidden" name="code_challenge" value={request.codeChallenge} />
              <input type="hidden" name="scope" value="openid" />
              {request.nonce ? <input type="hidden" name="nonce" value={request.nonce} /> : null}
              <label className="zn-field">
                <span className="zn-field-label">用户名</span>
                <input className="zn-input" name="username" defaultValue={username} autoComplete="username" placeholder="输入管理员账号" required />
              </label>
              <label className="zn-field">
                <span className="zn-field-label">密码</span>
                <input className="zn-input" name="password" type="password" autoComplete="current-password" placeholder="输入密码" required />
              </label>
              {firstLogin ? (
                <label className="zn-field">
                  <span className="zn-field-label">新密码</span>
                  <input className="zn-input" name="new_password" type="password" autoComplete="new-password" placeholder="至少 12 个字符" required />
                  <span className="zn-hint">首次登录需更换临时口令，至少 12 个字符。</span>
                </label>
              ) : null}
              <button className="zn-btn zn-btn-primary zn-btn-block zn-btn-tall" type="submit">
                <ZnIcon name="key-round" size={15} color="currentColor" />
                登录
              </button>
            </form>
          </>
        ) : hasAuthParams ? (
          <div className="zn-stack-sm" style={{ textAlign: 'center' }}>
            <h2>无法开始登录</h2>
            <p className="access-error" role="alert">{ENTRY_INVALID_TEXT}</p>
            <p><a className="zn-btn zn-btn-primary zn-btn-block zn-btn-tall" href={companyLoginUrl}>重新进入</a></p>
          </div>
        ) : (
          <>
            <h2 className="zn-sr-only">登录后开放</h2>
            <TokenLoginForm nextPath={nextPath} />
          </>
        )}
      </section>
      <p className="zn-login-footnote">支持本地管理员账号密码与企业 OIDC PKCE 统一认证</p>
    </main>
  );
}
