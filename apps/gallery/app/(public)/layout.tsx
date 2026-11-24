import { SiteHeader } from '../_site/SiteHeader';

/**
 * 公开目录分区（`/components` 及其详情）沿用仓库原有的浅色站点导航。
 * 介绍首页位于 `app/(intro)/`，不经过本布局，因此可以用深色科技风导航。
 */
export default function PublicLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
