'use client';

/**
 * 管理端外壳：Apple macOS Sequoia / App Store Connect 风格侧栏与通透顶栏。
 *
 * 注意：这里渲染 `<div className="zn-content">` 而不是 `<main>`——各页面自己渲染
 * `<main>`，嵌套会产生多个 main 地标。
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ZnIcon } from './icons';
import { ADMIN_NAV_ITEMS, ADMIN_TOOL_ITEMS, resolveActiveNavKey, resolveTopbarPage } from './nav';
import { getStoredSession, loadCompanySession, logoutAndRedirect, platformApiOrigin, SESSION_EXPIRED_EVENT } from '../auth';
import { changeOwnPassword } from '../managed-accounts-client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const THEME_KEY = 'zhinexus_admin_theme';
type ThemeMode = 'auto' | 'light' | 'dark';

function initialsOf(subject: string): string {
  const parts = subject.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return subject.slice(0, 2).toUpperCase();
}

function QuickSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById('zn-quick-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <form
      className="zn-quick-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const query = value.trim();
        if (!query) {
          router.push('/assets');
          return;
        }
        if (UUID_RE.test(query)) {
          router.push(`/jobs/${encodeURIComponent(query)}`);
          return;
        }
        router.push(`/assets?q=${encodeURIComponent(query)}`);
      }}
    >
      <ZnIcon name="search" color="currentColor" size={14} className="zn-quick-search-icon" />
      <input
        id="zn-quick-search-input"
        className="zn-quick-search-input"
        type="search"
        value={value}
        placeholder="搜索资产 ID 或粘贴作业 UUID"
        aria-label="搜索资产或作业"
        onChange={(event) => setValue(event.target.value)}
      />
      <kbd>⌘K</kbd>
    </form>
  );
}

type LinkHealth = { status: 'checking' | 'online' | 'offline'; latencyMs: number | null };

export function ZnShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname() ?? '/assets';
  const router = useRouter();
  const isLoginPage = pathname === '/login';
  const activeKey = resolveActiveNavKey(pathname);
  const [subject, setSubject] = useState('');
  const [theme, setTheme] = useState<ThemeMode>('auto');
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'redirecting'>(() =>
    isLoginPage ? 'authenticated' : 'checking',
  );
  const [health, setHealth] = useState<LinkHealth>({ status: 'checking', latencyMs: null });
  const pwdDialogRef = useRef<HTMLDialogElement | null>(null);
  const [pwdUsername, setPwdUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwdSubmitting, setPwdSubmitting] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);

  useEffect(() => {
    const dialog = pwdDialogRef.current;
    if (!dialog || typeof HTMLDialogElement === 'undefined' || 'closedBy' in HTMLDialogElement.prototype) return;
    const outside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const onDown = (e: PointerEvent) => { pressedOutside = outside(e); };
    const onUp = (e: PointerEvent) => { if (pressedOutside && outside(e)) dialog.close(); };
    dialog.addEventListener('pointerdown', onDown);
    dialog.addEventListener('pointerup', onUp);
    return () => {
      dialog.removeEventListener('pointerdown', onDown);
      dialog.removeEventListener('pointerup', onUp);
    };
  }, [authStatus]);

  const openPasswordDialog = () => {
    setPwdUsername(subject.startsWith('oidc:') ? '' : subject);
    setCurrentPassword('');
    setNewPassword('');
    setPwdError(null);
    setPwdSuccess(null);
    pwdDialogRef.current?.showModal();
  };

  const handlePasswordChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pwdUsername.trim() || !currentPassword || newPassword.length < 12) {
      setPwdError('请填写用户名、当前密码，并设置至少 12 个字符的新密码。');
      return;
    }
    setPwdSubmitting(true);
    setPwdError(null);
    setPwdSuccess(null);
    try {
      await changeOwnPassword({ username: pwdUsername, currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setPwdSuccess('密码已更新，请使用新密码重新登录。');
      setTimeout(() => {
        pwdDialogRef.current?.close();
        logoutAndRedirect(router);
      }, 900);
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : '修改密码失败。');
    } finally {
      setPwdSubmitting(false);
    }
  };

  useEffect(() => {
    const saved = (localStorage.getItem(THEME_KEY) as ThemeMode | null) ?? 'auto';
    if (saved === 'light' || saved === 'dark' || saved === 'auto') {
      setTheme(saved);
      document.documentElement.dataset.theme = saved;
    }
  }, []);

  const applyTheme = (next: ThemeMode) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (isLoginPage) {
      setAuthStatus('authenticated');
      return;
    }
    const stored = getStoredSession();
    if (stored) {
      setSubject(stored.subject);
      setAuthStatus('authenticated');
    } else {
      setAuthStatus('checking');
    }
    let cancelled = false;
    void loadCompanySession().then((session) => {
      if (cancelled) return;
      if (session) {
        setSubject(session.subject);
        setAuthStatus('authenticated');
        return;
      }
      setSubject('');
      setAuthStatus('redirecting');
      const next = pathname && pathname.startsWith('/') && !pathname.startsWith('//') && pathname !== '/login'
        ? `?next=${encodeURIComponent(pathname === '/' ? '/assets' : pathname)}`
        : '';
      router.replace(`/login${next}`);
    });
    return () => {
      cancelled = true;
    };
  }, [isLoginPage, pathname, router]);

  useEffect(() => {
    if (isLoginPage) return;
    const onExpired = () => {
      setSubject('');
      setAuthStatus('redirecting');
      const next = pathname && pathname.startsWith('/') && !pathname.startsWith('//') && pathname !== '/login'
        ? `?next=${encodeURIComponent(pathname === '/' ? '/assets' : pathname)}`
        : '';
      router.replace(`/login${next}`);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [isLoginPage, pathname, router]);

  useEffect(() => {
    if (isLoginPage || authStatus !== 'authenticated') return;
    let cancelled = false;
    const probe = async () => {
      const started = performance.now();
      try {
        const res = await fetch(`${platformApiOrigin}/healthz`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(4000),
        });
        if (cancelled) return;
        const elapsed = Math.max(1, Math.round(performance.now() - started));
        setHealth(res.ok ? { status: 'online', latencyMs: elapsed } : { status: 'offline', latencyMs: null });
      } catch {
        if (!cancelled) setHealth({ status: 'offline', latencyMs: null });
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [isLoginPage, authStatus]);

  if (isLoginPage) {
    return (
      <div className="zn-login-shell">
        <div className="zn-login-content">{children}</div>
      </div>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <div className="zn-login-shell">
        <div className="zn-login-content">
          <p className="zn-auth-checking">{authStatus === 'redirecting' ? '正在前往登录页…' : '正在核验登录状态…'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="zn-shell">
      <aside className="zn-sidebar" aria-label="管理侧栏">
        <div className="zn-brand">
          <span className="zn-brand-mark" aria-hidden="true">Z</span>
          <div className="zn-brand-copy">
            <span className="zn-brand-name">Zhinexus</span>
            <span className="zn-brand-sub">资产管理控制台</span>
          </div>
        </div>

        <p className="zn-workspace-label">工作台</p>
        <nav className="zn-nav" aria-label="控制台导航">
          {ADMIN_NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="zn-nav-item"
              aria-current={activeKey === item.key ? 'page' : undefined}
            >
              <ZnIcon name={item.icon} size={16} className="zn-nav-icon" color="currentColor" />
              <span>
                <span className="zn-nav-order">{item.order}</span>
                {item.label}
              </span>
            </Link>
          ))}
        </nav>

        <p className="zn-workspace-label" style={{ marginTop: 14 }}>工具</p>
        <nav className="zn-nav" aria-label="辅助工具">
          {ADMIN_TOOL_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="zn-nav-item"
              aria-current={activeKey === item.key ? 'page' : undefined}
            >
              <ZnIcon name={item.icon} size={15} className="zn-nav-icon" color="currentColor" />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="zn-sidebar-spacer" />

        <div className="zn-sidebar-footer">
          <div className="zn-theme-switch" role="group" aria-label="外观模式">
            {([['light', '浅色'], ['dark', '深色'], ['auto', '自动']] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className="zn-theme-option"
                aria-pressed={theme === mode}
                onClick={() => applyTheme(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="zn-link-pulse" data-health={health.status} title={`API: ${platformApiOrigin}`}>
            <span className="zn-link-status">
              <span className="zn-live-dot" />
              <span className="zn-link-label">
                {health.status === 'online' ? 'API ONLINE' : health.status === 'offline' ? 'API OFFLINE' : 'CHECKING'}
              </span>
            </span>
            <span className="zn-link-latency">
              {health.status === 'online' && health.latencyMs !== null ? `${health.latencyMs}ms` : health.status === 'offline' ? '离线' : '…'}
            </span>
          </div>
        </div>
      </aside>

      <div className="zn-body">
        <header className="zn-topbar">
          <div className="zn-topbar-context">
            <span className="zn-topbar-section">管理平台</span>
            <ZnIcon name="chevron-right" size={13} color="currentColor" className="zn-topbar-divider" />
            <span className="zn-topbar-page">{resolveTopbarPage(pathname)}</span>
          </div>
          <div className="zn-topbar-actions">
            <QuickSearch />
            <div className="zn-topbar-user">
              <span className="zn-avatar" title={subject || '未登录'} aria-hidden="true">
                {subject ? initialsOf(subject) : 'ZN'}
              </span>
              {subject ? <span className="zn-topbar-username">{subject}</span> : null}
              <button
                type="button"
                className="zn-btn"
                onClick={openPasswordDialog}
              >
                <ZnIcon name="key-round" size={13} color="currentColor" />
                修改密码
              </button>
              <button
                type="button"
                className="zn-btn zn-btn-logout"
                onClick={() => logoutAndRedirect(router)}
              >
                <ZnIcon name="log-out" size={13} color="currentColor" />
                退出登录
              </button>
            </div>
          </div>
        </header>
        <div className="zn-content">{children}</div>
      </div>

      <dialog
        ref={pwdDialogRef}
        className="zn-dialog"
        aria-labelledby="change-password-title"
        {...({ closedby: 'any' } as Record<string, string>)}
      >
        <div className="zn-dialog-head">
          <div>
            <h1 id="change-password-title" className="zn-card-title">修改登录密码</h1>
            <p className="zn-card-subtitle">适用于平台自管身份服务账号，修改成功后需使用新密码重新登录</p>
          </div>
          <button type="button" className="zn-icon-btn" aria-label="关闭修改密码对话框" onClick={() => pwdDialogRef.current?.close()}>
            ×
          </button>
        </div>
        <form className="zn-stack" onSubmit={handlePasswordChange}>
          {pwdError ? <p className="access-error" role="alert">{pwdError}</p> : null}
          {pwdSuccess ? <p className="access-message" role="status">{pwdSuccess}</p> : null}
          <label className="zn-field">
            <span className="zn-field-label">用户名</span>
            <input
              className="zn-input zn-input-mono"
              value={pwdUsername}
              autoComplete="username"
              autoFocus
              required
              placeholder="输入登录用户名"
              onChange={(e) => setPwdUsername(e.target.value)}
            />
          </label>
          <label className="zn-field">
            <span className="zn-field-label">当前密码</span>
            <input
              className="zn-input"
              type="password"
              value={currentPassword}
              autoComplete="current-password"
              required
              placeholder="输入当前密码"
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </label>
          <label className="zn-field">
            <span className="zn-field-label">新密码</span>
            <input
              className="zn-input"
              type="password"
              value={newPassword}
              autoComplete="new-password"
              required
              minLength={12}
              placeholder="至少 12 个字符，且不能与当前密码相同"
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <div className="zn-dialog-actions">
            <button type="button" className="zn-btn" disabled={pwdSubmitting} onClick={() => pwdDialogRef.current?.close()}>
              取消
            </button>
            <button type="submit" className="zn-btn zn-btn-primary" disabled={pwdSubmitting}>
              {pwdSubmitting ? '正在保存…' : '确认修改密码'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
