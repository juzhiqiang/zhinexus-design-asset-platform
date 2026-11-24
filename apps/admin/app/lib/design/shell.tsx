'use client';

/**
 * 管理端外壳：对应 `.pen` 每张画板的 `App Sidebar` + `Topbar` + `Aurora Flow Field`。
 *
 * 注意：这里渲染 `<div className="zn-content">` 而不是 `<main>`——各页面自己渲染
 * `<main>`，嵌套会产生多个 main 地标。
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ZnIcon } from './icons';
import { ADMIN_NAV_ITEMS, resolveActiveNavKey, resolveTopbarPage } from './nav';
import { getStoredSession } from '../auth';

const SEARCH_TARGET = '/match';

/** Aurora 流场的两个模糊色块（.pen Glacier / Mint Aurora Field）。 */
function AuroraFlowField() {
  return (
    <div className="zn-aurora" aria-hidden="true">
      <span className="zn-aurora-glacier" />
      <span className="zn-aurora-mint" />
      <svg viewBox="0 0 1208 1120" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id="zn-aurora-glacier-stroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8CCFFF" stopOpacity="0" />
            <stop offset="48%" stopColor="#8CCFFF" stopOpacity="0.36" />
            <stop offset="100%" stopColor="#8CCFFF" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="zn-aurora-mint-stroke" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#78E7C2" stopOpacity="0" />
            <stop offset="50%" stopColor="#78E7C2" stopOpacity="0.29" />
            <stop offset="100%" stopColor="#78E7C2" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 430c220-310 520 130 1120-310" transform="translate(40 80)" fill="none" stroke="url(#zn-aurora-glacier-stroke)" strokeWidth="2" strokeLinecap="round" opacity="0.48" />
        <path d="M0 120c360 290 710-120 1160 180" transform="translate(10 350)" fill="none" stroke="url(#zn-aurora-mint-stroke)" strokeWidth="3" strokeLinecap="round" opacity="0.34" />
      </svg>
    </div>
  );
}

function initialsOf(subject: string): string {
  const parts = subject.split(/[-_.\s]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return subject.slice(0, 2).toUpperCase();
}

/** 顶栏快速检索：跳到 `/match?q=`，由匹配页读取并预填检索框。 */
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
        router.push(query ? `${SEARCH_TARGET}?q=${encodeURIComponent(query)}` : SEARCH_TARGET);
      }}
    >
      <ZnIcon name="search" color="var(--zn-subtle)" size={15} className="zn-quick-search-icon" />
      <input
        id="zn-quick-search-input"
        className="zn-quick-search-input"
        type="search"
        value={value}
        placeholder="搜索资产或作业"
        aria-label="搜索资产或作业"
        onChange={(event) => setValue(event.target.value)}
      />
      <kbd>⌘K</kbd>
    </form>
  );
}

export function ZnShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname() ?? '/upload';
  const activeKey = resolveActiveNavKey(pathname);
  const [subject, setSubject] = useState('');

  useEffect(() => {
    setSubject(getStoredSession()?.subject ?? '');
  }, [pathname]);

  return (
    <div className="zn-shell">
      <aside className="zn-sidebar" aria-label="管理侧栏">
        <span className="zn-sidebar-rail" />
        <div className="zn-brand">
          <span className="zn-brand-mark">Z</span>
          <span className="zn-brand-name">ZHINEXUS</span>
        </div>
        <p className="zn-workspace-label">REGISTRY / 工作台</p>
        <div className="zn-link-pulse">
          <span className="zn-link-status">
            <span className="zn-live-dot" />
            <span className="zn-link-label">SYSTEM LINK</span>
          </span>
          <span className="zn-link-latency">17ms</span>
        </div>
        <nav className="zn-nav" aria-label="控制台导航">
          {ADMIN_NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="zn-nav-item"
              aria-current={activeKey === item.key ? 'page' : undefined}
            >
              <ZnIcon name={item.icon} size={17} className="zn-nav-icon" color={activeKey === item.key ? 'var(--zn-accent)' : '#7D8796'} />
              <span>
                <span className="zn-nav-order">{item.order}</span>
                {'  '}
                {item.label}
              </span>
            </Link>
          ))}
        </nav>
        <div className="zn-sidebar-spacer" />
        <div className="zn-env">
          <span className="zn-env-label">ENV / API</span>
          <span className="zn-env-value">{process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000'}</span>
        </div>
      </aside>

      <div className="zn-body">
        <AuroraFlowField />
        <header className="zn-topbar">
          <div className="zn-topbar-context">
            <span className="zn-topbar-section">管理平台</span>
            <ZnIcon name="chevron-right" size={14} color="var(--zn-subtle)" className="zn-topbar-divider" />
            <span className="zn-topbar-page">{resolveTopbarPage(pathname)}</span>
          </div>
          <div className="zn-topbar-actions">
            <QuickSearch />
            <span className="zn-avatar" title={subject || '未登录'} aria-hidden="true">
              {subject ? initialsOf(subject) : 'ZN'}
            </span>
          </div>
        </header>
        <div className="zn-content">{children}</div>
      </div>
    </div>
  );
}
