'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ComponentCatalogItem, ComponentVariantMeta } from '../../../lib/types';
import { ComponentPreview } from './ComponentPreview';
import { EchartsCompatibility } from './EchartsCompatibility';

export function ComponentDetailViewer({
  component,
}: {
  component: ComponentCatalogItem;
}) {
  const [selectedFramework, setSelectedFramework] = useState<'vue' | 'react'>(
    component.variants[0]?.framework ?? 'vue',
  );
  const [previewRevision, setPreviewRevision] = useState(0);
  const [copied, setCopied] = useState(false);

  const activeVariant: ComponentVariantMeta =
    component.variants.find((v) => v.framework === selectedFramework) ||
    component.variants[0] ||
    component.defaultVariant;

  const exactInstallCmd = activeVariant.installCommand;

  const handleCopy = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard?.writeText(exactInstallCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/components">组件目录</Link>
        <span>/</span>
        <span>{component.chineseName}</span>
      </nav>

      <header className="detail-header">
        <p className="eyebrow">{component.category} · {component.name}</p>
        <h1>{component.chineseName} ({component.name})</h1>
        <p className="lead">{component.description}</p>
      </header>

      <div className="framework-switch-bar" role="tablist" aria-label="组件框架实现切换">
        {component.variants.map((variant) => (
          <button
            key={variant.variantReleaseId}
            type="button"
            role="tab"
            aria-selected={activeVariant.variantReleaseId === variant.variantReleaseId}
            className={`framework-tab ${activeVariant.variantReleaseId === variant.variantReleaseId ? 'active' : ''}`}
            onClick={() => setSelectedFramework(variant.framework)}
          >
            <span>{variant.frameworkName} 实现</span>
            {variant.frameworkVersion && (
              <span className={`tag ${variant.framework === 'vue' ? 'tag-framework-vue' : 'tag-framework-react'}`}>
                v{variant.frameworkVersion}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeVariant.reportSource === 'manual-upload' && (
        <div style={{ padding: '12px 16px', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '8px', color: '#92400e', marginBottom: '20px', fontSize: '13px' }}>
          <strong>来源提示：</strong> 该版本为网页手动上传（manual-upload），未附带本地 Playwright 自动化验证签名，建议在本地环境安装验证后再用于生产。
        </div>
      )}

      <section className="status-grid" aria-label="资产就绪与合规状态">
        <div className="status-card">
          <span className="label">可用状态 (Availability)</span>
          <span className={`value ${activeVariant.availability === 'Ready' ? 'ready' : ''}`}>
            {activeVariant.availability === 'Ready' && <span className="live-indicator"></span>}
            {activeVariant.availability ?? '未知'}
          </span>
        </div>

        <div className="status-card">
          <span className="label">检查报告来源 (Source)</span>
          <span className="value automatic">{activeVariant.reportSource ?? 'none'}</span>
        </div>

        <div className="status-card">
          <span className="label">视觉基线 (Baseline)</span>
          <span className="value accepted">{activeVariant.baselineStatus ?? 'unconfirmed'}</span>
        </div>

        <div className="status-card">
          <span className="label">检索索引 (Index)</span>
          <span className="value">{activeVariant.indexStatus ?? 'pending'}</span>
        </div>

        <div className="status-card">
          <span className="label">发布包版本 (Version)</span>
          <span className="value" style={{ fontFamily: 'monospace' }}>
            {activeVariant.packageName}@{activeVariant.packageVersion}
          </span>
        </div>
      </section>

      <ComponentPreview
        key={`${component.id}:${activeVariant.variantReleaseId}:${previewRevision}`}
        componentId={component.id}
        componentName={component.name}
        variant={activeVariant}
        refresh={() => setPreviewRevision((revision) => revision + 1)}
        access="public"
      />

      <section className="code-section" aria-label="快速引入代码">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span className="code-header">精确版本依赖安装 (Exact Version Installation)</span>
          <button
            type="button"
            className="preview-btn"
            style={{ padding: '2px 8px', fontSize: '11px' }}
            onClick={handleCopy}
          >
            {copied ? '已复制！' : '复制命令'}
          </button>
        </div>
        <div className="code-line" style={{ color: '#38bdf8', marginBottom: '12px' }}>
          $ {exactInstallCmd}
        </div>

        <div className="code-header">ESM 模块导入 (Import)</div>
        <div className="code-line" style={{ color: '#a7f3d0' }}>
          {activeVariant.importCode}
        </div>
      </section>

      {activeVariant.props.length > 0 && (
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
                  <td><span className="code-badge">{prop.name}</span></td>
                  <td><span className="code-badge" style={{ color: '#0369a1' }}>{prop.type}</span></td>
                  <td>
                    {prop.required ? <span className="badge-required">必填</span> : <span className="badge-optional">可选</span>}
                  </td>
                  <td>{prop.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {activeVariant.events.length > 0 && (
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
                  <td><span className="code-badge">{evt.name}</span></td>
                  <td><span className="code-badge" style={{ color: '#4338ca' }}>{evt.payload}</span></td>
                  <td>{evt.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <EchartsCompatibility componentId={component.id} framework={activeVariant.framework} />
    </div>
  );
}
