import type { Metadata, Viewport } from 'next';
import { ZnShell } from './lib/design/shell';
import './globals.css';

export const viewport: Viewport = {
  colorScheme: 'light dark',
};

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
        <ZnShell>{children}</ZnShell>
      </body>
    </html>
  );
}
