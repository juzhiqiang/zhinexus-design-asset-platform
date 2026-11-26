/**
 * 侧栏导航与页头元数据：面向真实后台管理业务域的 6 个主导航入口 + 辅助工具入口。
 *
 * 注意：保留「项目上下文匹配」完整可访问名，以兼容既有浏览器测试选择器。
 */
import type { ZnIconName } from './icons';

export type AdminNavKey = 'assets' | 'upload' | 'jobs' | 'categories' | 'users' | 'access' | 'match';

export type AdminNavItem = {
  key: AdminNavKey;
  order: string;
  label: string;
  href: string;
  icon: ZnIconName;
};

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { key: 'assets', order: '01', label: '资产管理', href: '/assets', icon: 'layers' },
  { key: 'upload', order: '02', label: '上传发布', href: '/upload', icon: 'upload' },
  { key: 'jobs', order: '03', label: '发布作业', href: '/jobs', icon: 'list-checks' },
  { key: 'categories', order: '04', label: '组件分类', href: '/categories', icon: 'folder-tree' },
  { key: 'users', order: '05', label: '成员与权限', href: '/users', icon: 'users' },
  { key: 'access', order: '06', label: '接入与配置', href: '/access-settings', icon: 'settings' },
] as const;

export const ADMIN_TOOL_ITEMS: readonly AdminNavItem[] = [
  { key: 'match', order: 'T1', label: '项目上下文匹配', href: '/match', icon: 'search' },
] as const;

/**
 * 按路径名解析当前高亮的导航项。
 * `/login` 不属于任何导航项。
 */
export function resolveActiveNavKey(pathname: string): AdminNavKey | null {
  if (pathname.startsWith('/login')) return null;
  if (pathname.startsWith('/assets')) return 'assets';
  if (pathname.startsWith('/upload')) return 'upload';
  if (pathname.startsWith('/jobs')) return 'jobs';
  if (pathname.startsWith('/categories')) return 'categories';
  if (pathname.startsWith('/users')) return 'users';
  if (pathname.startsWith('/access-settings')) return 'access';
  if (pathname.startsWith('/match')) return 'match';
  return 'assets';
}

/** 顶栏两段式标题：固定「管理平台」+ 当前页面名。 */
export function resolveTopbarPage(pathname: string): string {
  if (pathname.startsWith('/login')) return '账号登录';
  if (pathname.startsWith('/assets')) return '资产管理';
  if (pathname.startsWith('/upload')) return '上传发布';
  if (pathname.startsWith('/jobs')) return '发布作业';
  if (pathname.startsWith('/categories')) return '组件分类';
  if (pathname.startsWith('/users')) return '成员与权限';
  if (pathname.startsWith('/access-settings')) return '接入与配置';
  if (pathname.startsWith('/match')) return '项目上下文匹配';
  return '资产管理';
}
