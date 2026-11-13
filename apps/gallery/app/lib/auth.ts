export type UserSession = {
  token: string;
  subject: string;
  roles: string[];
  channel: 'cli' | 'web';
};

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
  return session;
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

