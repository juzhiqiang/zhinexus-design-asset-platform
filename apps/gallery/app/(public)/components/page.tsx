import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vue 与 React 组件目录',
  description: '浏览面向 Vue 与 React 的组件资产、API、示例与验证信息。目录服务接入后仅展示获准公开的 Ready 资产。',
};

export default function CatalogPage() {
  return (
    <main>
      <p className="eyebrow">Zhinexus 组件资产平台</p>
      <h1>Vue 与 React 组件目录</h1>
      <p>浏览组件能力、API、示例、版本和验证信息。</p>
      <section className="empty-state" aria-live="polite">
        <h2>公开组件目录正在建设中</h2>
        <p>目前没有已批准公开并可检索的 Ready 组件资产。</p>
      </section>
    </main>
  );
}
