import { ZnIcon } from '../lib/design/icons';
import { COMMAND_MOTIFS, ZnCommandMotif } from '../lib/design/motifs';
import { companyLoginUrl, platformApiOrigin } from '../lib/auth';

/** 接入设置「公司登录」分区的 motif：登录页与它同属登录议题。 */
const MOTIF = COMMAND_MOTIFS[2]!;

/**
 * 后台登录页。本地身份模式（`PLATFORM_IDENTITY_MODE=local`）下，
 * `/v1/auth/oidc/start?target=admin` 不再把浏览器送到返回 JSON 描述符的授权端点，而是送到这里，
 * 并带上该端点要用的全部参数；本页把它们原样放回表单隐藏域，凭据以一次普通表单 POST 直接提交到
 * 身份服务——成功由身份服务 303 跳 OIDC 回调，失败同样 303 跳回本页并带 `reason`。
 *
 * 因此本页是服务端组件、不带任何客户端脚本，也从不经手凭据：浏览器与身份服务之间是直连的。
 */

/** 与 `apps/api/src/identity/local/service.ts` 的 `request()` 同一套形状；服务端仍是最终裁判。 */
const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const STATE = /^[A-Za-z0-9_-]{8,512}$/;

type AuthorizationRequest = { clientId: string; redirectUri: string; state: string; codeChallenge: string; nonce: string };

/**
 * 提前拒掉被手改或已失效的入口，避免把用户推向一个必然失败的 POST。判不出的都留给服务端：
 * 这里只做形状校验，不做 allow-list 校验，也不检查 redirect_uri 是否与部署一致。
 */
function authorizationRequest(params: URLSearchParams): AuthorizationRequest | null {
  const clientId = params.get('client_id') ?? '';
  const redirectUri = params.get('redirect_uri') ?? '';
  const state = params.get('state') ?? '';
  const codeChallenge = params.get('code_challenge') ?? '';
  const nonce = params.get('nonce') ?? '';
  if (!CLIENT_ID.test(clientId) || !STATE.test(state) || !TOKEN.test(codeChallenge) || (nonce && !TOKEN.test(nonce))) return null;
  let redirect: URL;
  try { redirect = new URL(redirectUri); } catch { return null; }
  if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname === '/' || redirect.href !== redirectUri) return null;
  return { clientId, redirectUri, state, codeChallenge, nonce };
}

/**
 * 身份服务只回一个封闭集合里的 `reason`，文案由本页所有。未知取值按入口失效处理，
 * 这样服务端新增一种原因时，页面退回到最保守的提示而不是显示空串。
 */
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
  const reason = query.get('reason') ?? '';
  // An unknown reason falls back to the most conservative text rather than rendering nothing: the
  // API may grow a reason this build has never heard of, and a silent page looks like a success.
  const notice = reason ? REASON_TEXT[reason] ?? REASON_TEXT['invalid-request'] : undefined;
  const username = query.get('username') ?? '';
  // 首次登录必须在同一次提交里换掉临时口令，否则平台签发的凭据永远退不掉。
  const firstLogin = reason === 'first-login';

  return (
    <main>
      <div className="access-heading zn-page-header">
        <div className="zn-header-copy">
          <p className="eyebrow">05 / IDENTITY LEDGER</p>
          <h1>管理员登录</h1>
          <p className="lead">使用部署登记的平台管理员账号登录管理端。临时口令只在建栈时打印一次，首次登录必须立即更换。</p>
        </div>
        <ZnCommandMotif motif={MOTIF} className="zn-motif" />
      </div>

      {request ? (
        <section className="access-panel">
          <h2>账号登录</h2>
          <p className="access-hint">登录成功后返回上传发布工作台。连续输错不会提示账号是否存在。</p>
          {notice ? <p className="access-error" role="alert">{notice}</p> : null}
          <form className="zn-login-form" method="post" action={`${platformApiOrigin}/identity/authorize`}>
            <input type="hidden" name="client_id" value={request.clientId} />
            <input type="hidden" name="redirect_uri" value={request.redirectUri} />
            <input type="hidden" name="state" value={request.state} />
            <input type="hidden" name="code_challenge" value={request.codeChallenge} />
            <input type="hidden" name="scope" value="openid" />
            {request.nonce ? <input type="hidden" name="nonce" value={request.nonce} /> : null}
            <div className="zn-field-row">
              <label className="zn-field">
                <span className="zn-field-label">用户名</span>
                <input className="zn-input" name="username" defaultValue={username} autoComplete="username" required />
              </label>
              <label className="zn-field">
                <span className="zn-field-label">密码</span>
                <input className="zn-input" name="password" type="password" autoComplete="current-password" required />
              </label>
              {firstLogin ? (
                <label className="zn-field">
                  <span className="zn-field-label">新密码</span>
                  <input className="zn-input" name="new_password" type="password" autoComplete="new-password" required />
                  <span className="zn-hint">至少 12 个字符，且不能与当前口令相同。</span>
                </label>
              ) : null}
            </div>
            <button className="zn-btn zn-btn-primary zn-btn-block zn-btn-tall" type="submit">
              <ZnIcon name="key-round" size={15} color="var(--zn-on-primary)" />登录
            </button>
          </form>
        </section>
      ) : (
        <section className="access-panel">
          <h2>无法开始登录</h2>
          <p className="access-error" role="alert">{ENTRY_INVALID_TEXT}</p>
          <p><a className="filter-btn active" href={companyLoginUrl}>重新进入</a></p>
        </section>
      )}
    </main>
  );
}
