import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Zhinexus 内网管理端',
    template: '%s | Zhinexus 管理端',
  },
  description: 'Zhinexus 组件资产平台内网发布、匹配、权限与接入管理控制台。',
  applicationName: 'Zhinexus 内网管理端',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <div className="site-nav">
            <Link href="/upload" className="site-logo">
              <span>Zhinexus</span>
              <span className="site-badge">内网管理端</span>
            </Link>
            <nav className="nav-links" aria-label="控制台导航">
              <Link href="/upload" className="console-nav-link">上传发布</Link>
              <Link href="/categories" className="console-nav-link">组件分类</Link>
              <Link href="/match" className="console-nav-link">项目上下文匹配</Link>
              <Link href="/access-settings" className="console-nav-link">接入设置</Link>
              <Link href="/users" className="console-nav-link">用户与权限</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
