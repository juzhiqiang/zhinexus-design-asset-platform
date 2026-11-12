'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ComponentCatalogItem } from '../../lib/types';

export function CatalogViewer({
  initialItems,
  fallbackItems,
}: {
  initialItems: ComponentCatalogItem[];
  fallbackItems: ComponentCatalogItem[];
}) {
  const [selectedFramework, setSelectedFramework] = useState<'all' | 'vue' | 'react'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [useFallback, setUseFallback] = useState(false);

  const activeSource = initialItems.length > 0 ? initialItems : useFallback ? fallbackItems : [];

  const filteredItems = activeSource.filter((item) => {
    if (selectedFramework !== 'all') {
      const hasFramework = item.variants.some((v) => v.framework === selectedFramework);
      if (!hasFramework) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const match =
        item.name.toLowerCase().includes(q) ||
        item.chineseName.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div>
      <p className="eyebrow">Zhinexus 组件资产平台</p>
      <h1>Vue 与 React 组件目录</h1>
      <p className="lead">浏览组件能力、API、示例、版本和验证信息。</p>

      {/* 工具条：搜索与框架过滤 */}
      {(initialItems.length > 0 || useFallback) && (
        <div className="catalog-toolbar">
          <div className="framework-filters" role="tablist" aria-label="按框架筛选">
            <button
              type="button"
              className={`filter-btn ${selectedFramework === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedFramework('all')}
            >
              全部框架
            </button>
            <button
              type="button"
              className={`filter-btn ${selectedFramework === 'vue' ? 'active' : ''}`}
              onClick={() => setSelectedFramework('vue')}
            >
              Vue 3
            </button>
            <button
              type="button"
              className={`filter-btn ${selectedFramework === 'react' ? 'active' : ''}`}
              onClick={() => setSelectedFramework('react')}
            >
              React 19
            </button>
          </div>

          <input
            type="search"
            className="search-box"
            placeholder="搜索图表或组件名称..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="搜索组件"
          />
        </div>
      )}

      {/* 组件网格展示 */}
      {filteredItems.length > 0 ? (
        <div className="components-grid">
          {filteredItems.map((item) => (
            <article key={item.id} className="component-card">
              <div className="card-header">
                <div>
                  <h2 className="card-title">{item.chineseName}</h2>
                  <div className="card-subtitle">{item.name} ({item.id})</div>
                </div>
                <span className="tag tag-ready">Ready</span>
              </div>

              <p className="card-desc">{item.description}</p>

              <div className="card-tags">
                <span className="tag">{item.category}</span>
                {item.variants.some((v) => v.framework === 'vue') && (
                  <span className="tag tag-framework-vue">Vue 3</span>
                )}
                {item.variants.some((v) => v.framework === 'react') && (
                  <span className="tag tag-framework-react">React 19</span>
                )}
                <span className="tag">ECharts 6.1.0</span>
              </div>

              <div className="card-footer">
                <span className="card-version">v{item.defaultVariant?.packageVersion || '0.0.4'}</span>
                <Link href={`/components/${item.id}`} className="card-link">
                  查看详情与隔离预览 →
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <section className="empty-state" aria-live="polite">
          <h2>公开组件目录正在建设中</h2>
          <p>目前没有已批准公开并可检索的 Ready 组件资产。</p>
          {!useFallback && (
            <button
              type="button"
              className="filter-btn active"
              onClick={() => setUseFallback(true)}
              style={{ marginTop: '8px' }}
            >
              浏览官方预置资产规范（折线、柱状、饼图、散点图）
            </button>
          )}
        </section>
      )}
    </div>
  );
}
