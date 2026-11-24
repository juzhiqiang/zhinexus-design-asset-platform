import Link from 'next/link';

/**
 * 公开画廊共用的浅色站点头部。
 *
 * 介绍首页（`/`，见 `app/(intro)/page.tsx`）有自己的深色科技风导航，不使用本组件；
 * `/components`、`/library` 等既有公开页面沿用这里的外观，DOM 与样式保持原样。
 */
export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-nav">
        <Link href="/" className="site-logo">
          <span>Zhinexus</span>
          <span className="site-badge">资产画廊</span>
        </Link>
        <nav className="nav-links" aria-label="画廊导航">
          <Link href="/components">浏览组件</Link>
          <Link href="/library">我的资产库</Link>
        </nav>
      </div>
    </header>
  );
}
