/**
 * 侧栏导航与页头元数据：对应 `.pen` 中 `App Sidebar` 的 4 个 `Nav · *` 图层与
 * 各画板 `Topbar Context` 的「管理平台 / <页面>」两段。
 *
 * 侧栏标签用完整名称（而非 .pen 的缩写「项目匹配」）：
 * `tests/browser/phase2-*.spec.ts` 依赖 `getByRole('link', { name: '项目上下文匹配' })`
 * 命中可访问名，缩写会让该选择器失效。
 */

export type AdminNavKey = 'upload' | 'match' | 'access' | 'users';

export type AdminNavItem = {
  key: AdminNavKey;
  /** 侧栏序号，.pen 的 `01`–`04`。 */
  order: string;
  /** 侧栏完整标签。 */
  label: string;
  href: string;
  icon: 'upload' | 'search' | 'settings' | 'users';
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { key: 'upload', order: '01', label: '上传发布', href: '/upload', icon: 'upload' },
  { key: 'match', order: '02', label: '项目上下文匹配', href: '/match', icon: 'search' },
  { key: 'access', order: '03', label: '接入设置', href: '/access-settings', icon: 'settings' },
  { key: 'users', order: '04', label: '用户与权限', href: '/users', icon: 'users' },
] as const;

/**
 * 按路径名解析当前高亮的导航项。
 * `/jobs/[jobId]` 是上传发布的子页面，.pen 的画板 02 同样高亮「上传发布」。
 * `/login` 不属于任何导航项：登录页没有侧栏高亮，也不该让人以为已经在某个工作台里。
 */
export function resolveActiveNavKey(pathname: string): AdminNavKey | null {
  if (pathname.startsWith('/match')) return 'match';
  if (pathname.startsWith('/access-settings')) return 'access';
  if (pathname.startsWith('/users')) return 'users';
  if (pathname.startsWith('/login')) return null;
  return 'upload';
}

/** 顶栏两段式标题：固定「管理平台」+ 当前页面名。 */
export function resolveTopbarPage(pathname: string): string {
  if (pathname.startsWith('/login')) return '账号登录';
  if (pathname.startsWith('/jobs')) return '发布作业';
  if (pathname.startsWith('/categories')) return '组件分类';
  if (pathname.startsWith('/match')) return '项目上下文匹配';
  if (pathname.startsWith('/access-settings')) return '接入设置';
  if (pathname.startsWith('/users')) return '用户与权限';
  return '上传发布';
}
