import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getComponentDetail } from '../../../lib/catalog';
import { ComponentDetailViewer } from './ComponentDetailViewer';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const component = await getComponentDetail(slug);
  if (!component) {
    return {
      title: '组件未找到',
    };
  }

  return {
    title: `${component.chineseName} (${component.name}) 组件详情`,
    description: `${component.chineseName} 图表组件面向 Vue 3 与 React 19 的 API 规范、状态看板与沙箱隔离预览。`,
  };
}

export default async function ComponentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const component = await getComponentDetail(slug);

  if (!component) {
    notFound();
  }

  return (
    <main>
      <ComponentDetailViewer component={component} />
    </main>
  );
}
