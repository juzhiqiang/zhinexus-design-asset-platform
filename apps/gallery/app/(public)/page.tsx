import Link from 'next/link';

export default function PublicHomePage() {
  return (
    <main>
      <p className="eyebrow">组件资产平台</p>
      <h1>Zhinexus 组件资产平台</h1>
      <p>面向 Vue 与 React 的组件资产目录。</p>
      <p><Link href="/components">组件目录</Link></p>
    </main>
  );
}
