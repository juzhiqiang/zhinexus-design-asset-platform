import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '发布工作区',
};

export default function UploadPage() {
  return (
    <main>
      <p className="eyebrow">Zhinexus 工作区</p>
      <h1>登录后开放</h1>
      <p>身份与权限服务接入后，此处提供组件发布功能。</p>
    </main>
  );
}
