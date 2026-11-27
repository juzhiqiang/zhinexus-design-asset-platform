import { NotFoundContent } from '../_site/NotFoundContent';

/**
 * 公开路由组内调用 `notFound()` 时使用本组件，外层已由 `(public)/layout.tsx`
 * 渲染 `.gallery-shell`、`SiteHeader` 与 `SiteFooter`，避免重复导航与页脚。
 */
export default function PublicNotFound() {
  return <NotFoundContent />;
}
