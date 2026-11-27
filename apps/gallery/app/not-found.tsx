import { NotFoundContent } from './_site/NotFoundContent';
import { SiteFooter } from './_site/SiteFooter';
import { SiteHeader } from './_site/SiteHeader';

/**
 * 顶层未匹配路径的 404 页面（直接挂载于根 `app/layout.tsx`）。
 */
export default function GalleryNotFound() {
  return (
    <div className="gallery-shell">
      <SiteHeader />
      <NotFoundContent />
      <SiteFooter />
    </div>
  );
}
