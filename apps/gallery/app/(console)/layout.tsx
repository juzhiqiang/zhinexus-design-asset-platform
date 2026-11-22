import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function ConsoleLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <nav className="console-nav" aria-label="控制台导航">
        <span className="console-nav-brand">组件发布控制台</span>
        <span className="console-nav-links">
          <Link href="/upload" className="console-nav-link">上传发布</Link>
          <Link href="/match" className="console-nav-link">项目上下文匹配</Link>
          <Link href="/access-settings" className="console-nav-link">接入设置</Link>
          <Link href="/users" className="console-nav-link">用户与权限</Link>
        </span>
      </nav>
      {children}
    </>
  );
}
