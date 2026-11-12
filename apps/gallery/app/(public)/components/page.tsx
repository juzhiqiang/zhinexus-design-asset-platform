import type { Metadata } from 'next';
import { getCatalogComponents } from '../../lib/catalog';
import { CatalogViewer } from './CatalogViewer';

export const metadata: Metadata = {
  title: 'Vue 与 React 组件目录',
  description: '浏览面向 Vue 与 React 的组件资产、API、示例与验证信息。目录服务接入后仅展示获准公开的 Ready 资产。',
};

export default async function CatalogPage() {
  const initialItems = await getCatalogComponents();
  const fallbackItems = await getCatalogComponents({ allowFallback: true });

  return (
    <main>
      <CatalogViewer initialItems={initialItems} fallbackItems={fallbackItems} />
    </main>
  );
}
