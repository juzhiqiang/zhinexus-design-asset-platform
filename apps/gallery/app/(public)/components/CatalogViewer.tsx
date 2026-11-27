'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ComponentCatalogItem } from '../../lib/types';

export function CatalogViewer({
  initialItems,
}: {
  initialItems: ComponentCatalogItem[];
}) {
  const [selectedFramework, setSelectedFramework] = useState<'all' | 'vue' | 'react'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = initialItems.filter((item) => {
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

      {initialItems.length > 0 && (
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

      {filteredItems.length > 0 ? (
        <div className="components-grid">
          {filteredItems.map((item) => {
            const variant = selectedFramework === 'all'
              ? item.variants.find((entry) => entry.thumbnail) ?? item.defaultVariant
              : item.variants.find((entry) => entry.framework === selectedFramework)!;
            return (
            <article key={item.id} className="component-card">
              {variant.thumbnail && (
                <img
                  className="card-thumbnail"
                  src={variant.thumbnail.url}
                  alt={`${item.chineseName}（${variant.frameworkName}）预览图`}
                  width={variant.thumbnail.width}
                  height={variant.thumbnail.height}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="card-header">
                <div>
                  <h2 className="card-title">{item.chineseName}</h2>
                  <div className="card-subtitle">{item.name} ({item.id})</div>
                </div>
                {variant.availability && (
                  <span className="tag tag-ready">{variant.availability}</span>
                )}
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
              </div>

              <div className="card-footer">
                <span className="card-version">v{variant.packageVersion}</span>
                <Link href={`/components/${item.id}`} className="card-link">
                  查看详情与隔离预览 →
                </Link>
              </div>
            </article>
            );
          })}
        </div>
      ) : (
        <section className="empty-state" aria-live="polite">
          <h2>公开组件目录正在建设中</h2>
          <p>目前没有已批准公开并可检索的 Ready 组件资产。</p>
          <p>
            <Link href="/library" className="filter-btn active" style={{ display: 'inline-block', textDecoration: 'none' }}>
              前往「我的资产库」查看已授权内部组件 →
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
