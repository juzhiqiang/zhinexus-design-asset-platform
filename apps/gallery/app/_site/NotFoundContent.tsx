import Link from 'next/link';

export function NotFoundContent() {
  return (
    <main>
      <section className="not-found-panel">
        <p className="not-found-code">404 · ASSET NOT FOUND</p>
        <h1>未找到该页面或组件资产</h1>
        <p className="lead" style={{ margin: '0 auto 28px' }}>
          目标页面不存在，或该组件尚未批准公开。您可以返回公开组件目录，或登录「我的资产库」查看内部授权资产。
        </p>
        <div className="empty-state-actions">
          <Link href="/components" className="titanium-btn">
            浏览公开组件目录 →
          </Link>
          <Link href="/" className="ghost-btn">
            返回画廊首页
          </Link>
        </div>
      </section>
    </main>
  );
}
