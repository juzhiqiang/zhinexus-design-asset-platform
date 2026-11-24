export type UserSession = {
  token: string;
  subject: string;
  roles: string[];
  channel: 'cli' | 'web';
};

export const platformApiOrigin = (process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
export const companyLoginUrl = `${platformApiOrigin}/v1/auth/oidc/start?target=admin`;

let companySession: UserSession | null = null;

export async function loadCompanySession(): Promise<UserSession | null> {
  try {
    const response = await fetch(`${platformApiOrigin}/v1/auth/oidc/session`, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      companySession = null;
      return getStoredSession();
    }
    const value: unknown = await response.json();
    if (
      !value ||
      typeof value !== 'object' ||
      !('authenticated' in value) ||
      value.authenticated !== true ||
      !('subject' in value) ||
      typeof value.subject !== 'string' ||
      !('roles' in value) ||
      !Array.isArray(value.roles) ||
      !value.roles.every((role) => typeof role === 'string')
    ) {
      companySession = null;
      return getStoredSession();
    }
    companySession = { token: '__session__', subject: value.subject, roles: value.roles, channel: 'web' };
    return companySession;
  } catch {
    companySession = null;
    return getStoredSession();
  }
}

/**
 * 从 JWT Token 中解析 Payload（仅在客户端用于展示身份信息，安全性由服务端 Bearer 鉴权强制校验）
 */
export function parseTokenPayload(token: string): { sub: string; roles: string[]; azp?: string; client_id?: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1]!;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

const STORAGE_KEY = 'zhinexus_console_auth';

export function getStoredSession(): UserSession | null {
  if (typeof window === 'undefined') return null;
  if (companySession) return companySession;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as UserSession;
    if (!session.token) return null;
    return session;
  } catch {
    return null;
  }
}

export function saveSession(token: string): UserSession | null {
  if (typeof window === 'undefined') return null;
  const payload = parseTokenPayload(token);
  if (!payload || !payload.sub) return null;
  const clientId = payload.azp ?? payload.client_id ?? 'web';
  const session: UserSession = {
    token,
    subject: payload.sub,
    roles: Array.isArray(payload.roles) ? payload.roles : [],
    channel: clientId === 'cli' ? 'cli' : 'web',
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  companySession = null;
  return session;
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  companySession = null;
  void fetch(`${platformApiOrigin}/v1/auth/oidc/logout`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
  }).catch(() => {});
}
