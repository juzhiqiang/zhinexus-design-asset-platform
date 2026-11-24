export type UserSession = {
  token: string;
  subject: string;
  roles: string[];
  channel: 'cli' | 'web';
};

export const platformApiOrigin = (process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
export const companyLoginUrl = `${platformApiOrigin}/v1/auth/oidc/start?target=gallery`;

let companySession: UserSession | null = null;
let authGeneration = 0;
let logoutInFlight: Promise<void> | null = null;
let activeSessionAbort: AbortController | null = null;

export async function loadCompanySession(): Promise<UserSession | null> {
  if (logoutInFlight) {
    return null;
  }
  const gen = authGeneration;
  activeSessionAbort?.abort();
  const controller = new AbortController();
  activeSessionAbort = controller;
  try {
    const response = await fetch(`${platformApiOrigin}/v1/auth/oidc/session`, {
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    });
    if (gen !== authGeneration || logoutInFlight || controller.signal.aborted) {
      return null;
    }
    if (!response.ok) {
      companySession = null;
      return getStoredSession();
    }
    const value: unknown = await response.json();
    if (gen !== authGeneration || logoutInFlight || controller.signal.aborted) {
      return null;
    }
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
    if (gen !== authGeneration || logoutInFlight || controller.signal.aborted) {
      return null;
    }
    companySession = null;
    return getStoredSession();
  } finally {
    if (activeSessionAbort === controller) {
      activeSessionAbort = null;
    }
  }
}

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
  if (logoutInFlight) return null;
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
  authGeneration += 1;
  activeSessionAbort?.abort();
  activeSessionAbort = null;
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
  authGeneration += 1;
  activeSessionAbort?.abort();
  activeSessionAbort = null;
  localStorage.removeItem(STORAGE_KEY);
  companySession = null;
  const logoutPromise = fetch(`${platformApiOrigin}/v1/auth/oidc/logout`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
  })
    .catch(() => {})
    .then(() => undefined)
    .finally(() => {
      if (logoutInFlight === logoutPromise) {
        logoutInFlight = null;
      }
    });
  logoutInFlight = logoutPromise;
}
