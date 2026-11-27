'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeIcon, ZhinexusMark } from '../_home/icons';

/**
 * 画廊子页面共用的深蓝钛金属顶部导航。
 *
 * 与介绍首页（`/`，`docs/design/gallery.pen` 画板 `I0RAl`）保持一致的
 * 88px 高度、字标、青色当前页指示线与极细描边入口按钮。
 */
export function SiteHeader() {
  const pathname = usePathname() ?? '/';
  const isComponents = pathname === '/components' || pathname.startsWith('/components/');
  const isLibrary = pathname === '/library' || pathname.startsWith('/library/');

  const ctaHref = isLibrary ? '/components' : '/library';
  const ctaLabel = isLibrary ? '浏览公开组件' : '我的资产库';

  return (
    <header className="site-header">
      <div className="site-nav">
        <Link href="/" className="site-logo">
          <ZhinexusMark size={28} />
          <span className="site-wordmark">ZHINEXUS</span>
          <span className="site-badge">GALLERY</span>
        </Link>

        <nav className="nav-links" aria-label="画廊导航">
          <Link href="/" aria-current={pathname === '/' ? 'page' : undefined}>
            首页
          </Link>
          <Link href="/components" aria-current={isComponents ? 'page' : undefined}>
            组件画廊
          </Link>
          <Link href="/library" aria-current={isLibrary ? 'page' : undefined}>
            我的资产库
          </Link>
        </nav>

        <Link href={ctaHref} className="site-header-cta">
          <span>{ctaLabel}</span>
          <HomeIcon name="arrow-up-right" size={14} />
        </Link>
      </div>
      <div className="site-header__rule" aria-hidden="true" />
    </header>
  );
}
