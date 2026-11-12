'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ComponentCatalogItem, ComponentVariantMeta } from '../../../lib/types';

export function ComponentDetailViewer({
  component,
}: {
  component: ComponentCatalogItem;
}) {
  const [selectedFramework, setSelectedFramework] = useState<'vue' | 'react'>('vue');
  const [iframeKey, setIframeKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const activeVariant: ComponentVariantMeta =
    component.variants.find((v) => v.framework === selectedFramework) ||
    component.variants[0] ||
    component.defaultVariant;

  const handleCopy = () => {
    if (activeVariant?.installCommand && typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(activeVariant.installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div>
      {/* 面包屑导航 */}
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/components">组件目录</Link>
        <span>/</span>
        <span>{component.chineseName}</span>
      </nav>

      {/* 头部信息 */}
      <header className="detail-header">
        <p className="eyebrow">{component.category} · {component.name}</p>
        <h1>{component.chineseName} ({component.name})</h1>
        <p className="lead">{component.description}</p>
      </header>

      {/* 框架切换选项卡 */}
      <div className="framework-switch-bar" role="tablist" aria-label="组件框架实现切换">
        <button
          type="button"
          role="tab"
          aria-selected={selectedFramework === 'vue'}
          className={`framework-tab ${selectedFramework === 'vue' ? 'active' : ''}`}
          onClick={() => setSelectedFramework('vue')}
        >
          <span>Vue 3 实现</span>
          <span className="tag tag-framework-vue">v3.5.45</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedFramework === 'react'}
          className={`framework-tab ${selectedFramework === 'react' ? 'active' : ''}`}
          onClick={() => setSelectedFramework('react')}
        >
          <span>React 19 实现</span>
          <span className="tag tag-framework-react">v19.3.1</span>
        </button>
      </div>

      {/* 状态看板 */}
      <section className="status-grid" aria-label="资产就绪与合规状态">
        <div className="status-card">
          <span className="label">可用状态 (Availability)</span>
          <span className="value ready">
            <span className="live-indicator"></span>
            {activeVariant.availability}
          </span>
        </div>

        <div className="status-card">
          <span className="label">检查报告来源 (Source)</span>
          <span className="value automatic">{activeVariant.reportSource}</span>
        </div>

        <div className="status-card">
          <span className="label">视觉基线 (Baseline)</span>
          <span className="value accepted">{activeVariant.baselineStatus}</span>
        </div>

        <div className="status-card">
          <span className="label">检索索引 (Index)</span>
          <span className="value">{activeVariant.indexStatus}</span>
        </div>

        <div className="status-card">
          <span className="label">发布包版本 (Version)</span>
          <span className="value" style={{ fontFamily: 'monospace' }}>
            {activeVariant.packageName}@{activeVariant.packageVersion}
          </span>
        </div>
      </section>

      {/* 交互与隔离预览 iframe */}
      <section className="preview-section" aria-label="组件沙箱隔离预览">
        <div className="preview-toolbar">
          <div className="preview-badge-group">
            <span className="live-indicator" title="预览服务正常"></span>
            <strong>{activeVariant.frameworkName} 沙箱交互预览</strong>
            <span className="shield-badge">独立域沙箱安全隔离 (sandbox allow-scripts allow-same-origin)</span>
          </div>

          <div className="preview-actions">
            <span style={{ fontSize: '12px', color: '#64748b', alignSelf: 'center' }}>800 × 400</span>
            <button
              type="button"
              className="preview-btn"
              onClick={() => setIframeKey((k) => k + 1)}
              title="重新加载预览沙箱"
            >
              刷新预览
            </button>
          </div>
        </div>

        <div className="iframe-container">
          <iframe
            key={`${activeVariant.variantId}-${iframeKey}`}
            src={activeVariant.previewUrl}
            className="preview-frame"
            sandbox="allow-scripts allow-same-origin"
            title={`${component.name} (${activeVariant.frameworkName}) 交互预览`}
          />
        </div>
      </section>

      {/* 快速安装与导入 */}
      <section className="code-section" aria-label="快速引入代码">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span className="code-header">安装依赖 (Package Installation)</span>
          <button
            type="button"
            className="preview-btn"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={handleCopy}
          >
            {copied ? '已复制！' : '复制命令'}
          </button>
        </div>
        <div className="code-line" style={{ color: '#38bdf8', marginBottom: '16px' }}>
          $ {activeVariant.installCommand}
        </div>

        <div className="code-header">ESM 模块导入 (Import)</div>
        <div className="code-line" style={{ color: '#a7f3d0' }}>
          {activeVariant.importCode}
        </div>
      </section>

      {/* API 规范属性表 */}
      <section className="spec-table-container" aria-label="API 属性规范">
        <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>Props 属性规范</h2>
        </div>

        <table className="spec-table">
          <thead>
            <tr>
              <th style={{ width: '20%' }}>属性名</th>
              <th style={{ width: '25%' }}>类型 (Type)</th>
              <th style={{ width: '15%' }}>是否必填</th>
              <th style={{ width: '40%' }}>说明</th>
            </tr>
          </thead>
          <tbody>
            {activeVariant.props.map((prop) => (
              <tr key={prop.name}>
                <td>
                  <span className="code-badge">{prop.name}</span>
                </td>
                <td>
                  <span className="code-badge" style={{ color: '#0369a1' }}>{prop.type}</span>
                </td>
                <td>
                  {prop.required ? (
                    <span className="badge-required">必填</span>
                  ) : (
                    <span className="badge-optional">可选</span>
                  )}
                </td>
                <td>{prop.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* API 事件规范 */}
      <section className="spec-table-container" aria-label="事件规范">
        <div style={{ padding: '16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <h2 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>Events 事件规范</h2>
        </div>

        <table className="spec-table">
          <thead>
            <tr>
              <th style={{ width: '25%' }}>事件名称</th>
              <th style={{ width: '30%' }}>载荷类型 (Payload)</th>
              <th style={{ width: '45%' }}>说明</th>
            </tr>
          </thead>
          <tbody>
            {activeVariant.events.map((evt) => (
              <tr key={evt.name}>
                <td>
                  <span className="code-badge">{evt.name}</span>
                </td>
                <td>
                  <span className="code-badge" style={{ color: '#4338ca' }}>{evt.payload}</span>
                </td>
                <td>{evt.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 验证与兼容性凭证 */}
      <section className="verification-box" aria-label="验证与环境记录">
        <h3>全链路验证与环境凭证</h3>
        <div className="verification-item">
          <span className="check-icon">✓</span>
          <span><strong>图表底层引擎：</strong> Apache ECharts {activeVariant.echartsVersion}（按需摇树引入）</span>
        </div>
        <div className="verification-item">
          <span className="check-icon">✓</span>
          <span><strong>目标框架兼容：</strong> {activeVariant.frameworkName} ({activeVariant.frameworkVersion}) 纯净 ESM 导出</span>
        </div>
        <div className="verification-item">
          <span className="check-icon">✓</span>
          <span><strong>产物冻结机制：</strong> 工作区外干净消费者实测安装，确定性 LF 行尾与时间戳固定</span>
        </div>
        <div className="verification-item">
          <span className="check-icon">✓</span>
          <span><strong>服务端安全策略：</strong> 服务端零执行代码，静态预览通过独立 preview-gateway 沙箱 iframe 呈现</span>
        </div>
      </section>
    </div>
  );
}
