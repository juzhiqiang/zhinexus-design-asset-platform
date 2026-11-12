import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: siteUrl ? new URL(siteUrl) : undefined,
  title: {
    default: 'Zhinexus 组件资产平台',
    template: '%s | Zhinexus',
  },
  description: '面向 Vue 与 React 的组件资产目录。',
  applicationName: 'Zhinexus 组件资产平台',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <div className="site-nav">
            <Link href="/" className="site-logo">
              <span>Zhinexus</span>
              <span className="site-badge">资产画廊</span>
            </Link>
            <nav className="nav-links">
              <Link href="/components">浏览组件</Link>
              <Link href="/upload" style={{ color: '#64748b' }}>资产发布控制台</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
