import { SiteFooter } from '../_site/SiteFooter';
import { SiteHeader } from '../_site/SiteHeader';

/**
 * 公开目录分区（`/components` 及其详情）共用深蓝钛金属导航与页脚。
 * 介绍首页位于 `app/(intro)/`，保留独立的全幅画板布局。
 */
export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="gallery-shell">
      <SiteHeader />
      {children}
      <SiteFooter />
    </div>
  );
}
