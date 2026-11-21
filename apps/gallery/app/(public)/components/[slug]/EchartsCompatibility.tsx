'use client';

import { useEffect, useState } from 'react';
import type { Framework } from '@company/contracts';
import { discoverOfficialEcharts, fetchMeasuredCompatibility, OFFICIAL_ECHARTS_SOURCE, type MeasuredCompatibility, type OfficialEchartsDiscovery } from '../../../lib/echarts-compatibility';

type LoadState<T> = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; value: T };

function OfficialDiscovery() {
  const [state, setState] = useState<LoadState<OfficialEchartsDiscovery>>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    discoverOfficialEcharts({ signal: controller.signal }).then(
      value => { if (!controller.signal.aborted) setState({ status: 'loaded', value }); },
      () => { if (!controller.signal.aborted) setState({ status: 'error' }); },
    );
    return () => controller.abort();
  }, []);

  return (
    <section className="compatibility-source" aria-label="官方 ECharts 发现">
      <h4>官方 ECharts 发现</h4>
      {state.status === 'loading' && <p role="status">正在查询官方稳定版…</p>}
      {state.status === 'error' && <p role="status">官方源暂不可用或元数据无效，未获得发现结果。</p>}
      {state.status === 'loaded' && <>
        <p>官方最新稳定版：<strong>{state.value.version}</strong></p>
        <p className="compatibility-meta">查询时间：<time dateTime={state.value.checkedAt}>{state.value.checkedAt}</time></p>
      </>}
      <p className="compatibility-meta">来源：<a href={OFFICIAL_ECHARTS_SOURCE} target="_blank" rel="noopener noreferrer">npm 官方 ECharts 元数据 ↗</a></p>
      <p className="compatibility-note">发现结果不代表组件已兼容；实际支持以独立接收的实测记录为准。</p>
    </section>
  );
}

function MeasuredSupport({ componentId, framework }: { componentId: string; framework: Framework }) {
  const [state, setState] = useState<LoadState<MeasuredCompatibility>>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    fetchMeasuredCompatibility(componentId, framework, { signal: controller.signal }).then(
      value => { if (!controller.signal.aborted) setState({ status: 'loaded', value }); },
      () => { if (!controller.signal.aborted) setState({ status: 'error' }); },
    );
    return () => controller.abort();
  }, [componentId, framework]);
  const result = state.status === 'loaded' ? state.value : undefined;

  return (
    <section className="compatibility-source" aria-label="已接收实测支持">
      <h4>已接收实测支持 · {framework === 'vue' ? 'Vue' : 'React'}</h4>
      {state.status === 'loading' && <p role="status">正在读取实测记录…</p>}
      {state.status === 'error' && <p role="status">实测记录暂不可用，当前无法确认兼容性。</p>}
      {result?.kind === 'unpublished' && <p role="status">当前框架实现尚无公开发布，未验证兼容性。</p>}
      {result?.kind === 'published' && <>
        <p className="compatibility-package"><strong>{result.packageName}@{result.packageVersion}</strong></p>
        {result.records.length === 0 ? <p role="status">暂无已接收的实测兼容记录，未验证兼容性。</p> : <ul className="compatibility-records">
          {result.records.map(record => <li key={record.compatibilityId}>
            <p><strong>ECharts {record.echartsVersion}</strong> · {record.framework === 'vue' ? 'Vue' : 'React'} {record.frameworkVersion}</p>
            <p className="compatibility-meta">记录 {record.compatibilityId} · <time dateTime={record.createdAt}>{record.createdAt}</time></p>
          </li>)}
        </ul>}
      </>}
    </section>
  );
}

export function EchartsCompatibility({ componentId, framework }: { componentId: string; framework: Framework }) {
  return (
    <section className="echarts-compatibility" aria-label="ECharts 版本与实测兼容">
      <h3>ECharts 版本与实测兼容</h3>
      <div className="compatibility-grid">
        <OfficialDiscovery />
        <MeasuredSupport key={`${componentId}:${framework}`} componentId={componentId} framework={framework} />
      </div>
    </section>
  );
}
