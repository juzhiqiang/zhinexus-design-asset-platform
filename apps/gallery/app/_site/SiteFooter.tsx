import Link from 'next/link';

/**
 * 画廊子页面共用的深蓝钛金属页脚，与首页 `.home-footer` 视觉语言一致。
 * 使用独立渐变 ID，避免与顶部导航的 ZhinexusMark SVG ID 重复。
 */
function FooterMark() {
  return (
    <svg width="24" height="23" viewBox="0 0 28 27" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="zhinexus-footer-mark-titanium" x1="0" y1="0.5" x2="1" y2="0.5">
          <stop offset="0" stopColor="#F2F7FA" />
          <stop offset="1" stopColor="#717984" />
        </linearGradient>
      </defs>
      <path d="M0 0h28L9 27H0l18-23H0z" fill="url(#zhinexus-footer-mark-titanium)" />
      <path d="M16 0h12l-4 5H4z" fill="#84EEE5" />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__rule" aria-hidden="true" />
      <div className="site-footer__inner">
        <div className="site-footer__top">
          <div className="site-footer__brand">
            <FooterMark />
            <span className="site-footer__wordmark">ZHINEXUS</span>
          </div>
          <span className="site-footer__tagline">企业级图表与组件资产平台</span>

          <div className="site-footer__links">
            <Link href="/" className="site-footer__link">
              首页
            </Link>
            <Link href="/components" className="site-footer__link">
              组件画廊
            </Link>
            <Link href="/library" className="site-footer__link">
              我的资产库
            </Link>
          </div>
        </div>

        <div className="site-footer__bottom">
          <span>© 2026 ZHINEXUS</span>
          <span className="site-footer__concept">GALLERY · TITANIUM EDITION</span>
        </div>
      </div>
    </footer>
  );
}
