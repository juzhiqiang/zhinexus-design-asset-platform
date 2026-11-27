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
        <div className="manual-upload-notice" role="note">
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
          <span className="value value--mono">
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
        <div className="code-section-head">
          <span className="code-header">精确版本依赖安装 (Exact Version Installation)</span>
          <button
            type="button"
            className="preview-btn"
            onClick={handleCopy}
          >
            {copied ? '已复制！' : '复制命令'}
          </button>
        </div>
        <div className="code-line code-line--install">
          $ {exactInstallCmd}
        </div>

        <div className="code-header">ESM 模块导入 (Import)</div>
        <div className="code-line code-line--import">
          {activeVariant.importCode}
        </div>
      </section>

      {activeVariant.props.length > 0 && (
        <section className="spec-table-container" aria-label="API 属性规范">
          <div className="spec-table-header">
            <h2 id="props-spec-heading">Props 属性规范</h2>
          </div>

          <div className="table-wrapper" tabIndex={0} role="region" aria-labelledby="props-spec-heading">
            <table className="spec-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: '20%' }}>属性名</th>
                  <th scope="col" style={{ width: '25%' }}>类型 (Type)</th>
                  <th scope="col" style={{ width: '15%' }}>是否必填</th>
                  <th scope="col" style={{ width: '40%' }}>说明</th>
                </tr>
              </thead>
              <tbody>
                {activeVariant.props.map((prop) => (
                  <tr key={prop.name}>
                    <td data-label="属性名"><span className="code-badge">{prop.name}</span></td>
                    <td data-label="类型 (Type)"><span className="code-badge code-badge--type">{prop.type}</span></td>
                    <td data-label="是否必填">
                      {prop.required ? <span className="badge-required">必填</span> : <span className="badge-optional">可选</span>}
                    </td>
                    <td data-label="说明">{prop.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {activeVariant.events.length > 0 && (
        <section className="spec-table-container" aria-label="事件规范">
          <div className="spec-table-header">
            <h2 id="events-spec-heading">Events 事件规范</h2>
          </div>

          <div className="table-wrapper" tabIndex={0} role="region" aria-labelledby="events-spec-heading">
            <table className="spec-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: '25%' }}>事件名称</th>
                  <th scope="col" style={{ width: '30%' }}>载荷类型 (Payload)</th>
                  <th scope="col" style={{ width: '45%' }}>说明</th>
                </tr>
              </thead>
              <tbody>
                {activeVariant.events.map((evt) => (
                  <tr key={evt.name}>
                    <td data-label="事件名称"><span className="code-badge">{evt.name}</span></td>
                    <td data-label="载荷类型 (Payload)"><span className="code-badge code-badge--payload">{evt.payload}</span></td>
                    <td data-label="说明">{evt.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <EchartsCompatibility componentId={component.id} framework={activeVariant.framework} />
    </div>
  );
}
