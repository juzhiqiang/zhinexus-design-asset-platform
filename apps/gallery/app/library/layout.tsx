import type { Metadata } from 'next';
import { SiteHeader } from '../_site/SiteHeader';

export const metadata: Metadata = {
  title: '我的资产库',
  description: '登录后按授权查看内部组件目录与详情。',
  robots: {
    index: false,
    follow: false,
  },
};

export default function LibraryLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
