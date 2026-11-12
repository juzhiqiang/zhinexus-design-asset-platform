'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getStoredSession } from '../../../lib/auth';
import { fetchReleaseJob } from '../../../lib/uploads/manifest-form';

export default function JobDetailPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = use(params);
  const [job, setJob] = useState<any>(null);
  const [error, setError] = useState<string>('');
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const session = getStoredSession();
    const token = session?.token;
    if (!token) {
      setError('未登录或未找到凭证，请先登录控制台');
      return;
    }

    let timer: any;
    let cancelled = false;

    async function poll() {
      try {
        const data = await fetchReleaseJob('http://127.0.0.1:3000', token!, jobId);
        if (!cancelled) {
          setJob(data);
          if (data.state !== 'READY' && data.state !== 'CONFLICT' && data.state !== 'REJECTED') {
            timer = setTimeout(poll, 700);
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message);
          timer = setTimeout(poll, 1500);
        }
      }
    }

    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const handleRetry = async () => {
    const session = getStoredSession();
    if (!session?.token) return;
    setRetrying(true);
    try {
      const res = await fetch(`http://127.0.0.1:3000/v1/releases/${jobId}/retry`, {
        method: 'POST',
        headers: { authorization: `Bearer ${session.token}` },
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      setJob((prev: any) => ({ ...prev, state: 'PENDING', stage: 'PENDING' }));
    } catch (err: any) {
      setError(`重试失败: ${err.message}`);
    } finally {
      setRetrying(false);
    }
  };

  const stages = [
    'PENDING',
    'FINALIZE_OBJECTS',
    'ENSURE_PACKAGES',
    'REGISTER_ASSETS',
    'CHECK_AVAILABILITY',
    'READY_TX',
    'READY',
  ];

  const currentStageIndex = stages.indexOf(job?.stage ?? job?.state ?? 'PENDING');

  return (
    <main>
      <nav className="breadcrumb">
        <Link href="/upload">发布控制台</Link>
        <span>/</span>
        <span>作业跟踪</span>
      </nav>

      <header style={{ marginBottom: '28px' }}>
        <p className="eyebrow">发布作业状态机</p>
        <h1>作业详情: <span style={{ fontFamily: 'monospace', fontSize: '24px' }}>{jobId}</span></h1>
      </header>

      {error && (
        <div style={{ padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', marginBottom: '24px' }}>
          {error}
        </div>
      )}

      {/* 阶段指示器 */}
      <section className="spec-table-container" style={{ padding: '24px', marginBottom: '32px' }}>
        <h2 style={{ fontSize: '16px', marginTop: 0, marginBottom: '20px' }}>推进阶段 (Pipeline Stepper)</h2>
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px' }}>
          {stages.map((st, i) => {
            const isCompleted = i < currentStageIndex || job?.state === 'READY';
            const isCurrent = i === currentStageIndex && job?.state !== 'READY';
            return (
              <div
                key={st}
                style={{
                  flex: 1,
                  minWidth: '130px',
                  padding: '12px',
                  borderRadius: '8px',
                  background: isCompleted ? '#ecfdf5' : isCurrent ? '#e0f2fe' : '#f8fafc',
                  border: `1px solid ${isCompleted ? '#a7f3d0' : isCurrent ? '#7dd3fc' : '#e2e8f0'}`,
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>步骤 {i + 1}</div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: isCompleted ? '#065f46' : isCurrent ? '#0369a1' : '#475569' }}>
                  {st}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 状态看板 */}
      <section className="status-grid" style={{ marginBottom: '32px' }}>
        <div className="status-card">
          <span className="label">作业状态 (State)</span>
          <span className={`value ${job?.state === 'READY' ? 'ready' : ''}`}>
            {job?.state ?? 'PENDING'}
          </span>
        </div>

        <div className="status-card">
          <span className="label">当前推进点 (Stage)</span>
          <span className="value">{job?.stage ?? 'INITIALIZING'}</span>
        </div>

        <div className="status-card">
          <span className="label">重试计数 (Attempt)</span>
          <span className="value">{job?.attempt ?? 0}</span>
        </div>

        <div className="status-card">
          <span className="label">轮询建议间隔</span>
          <span className="value">{job?.pollAfterMs ?? 1000} ms</span>
        </div>
      </section>

      {/* 成功 / 失败处理 */}
      {job?.state === 'READY' && (
        <div style={{ padding: '20px', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '12px', color: '#065f46', marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>🎉 发布作业已成功到达 READY 状态</h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '14px' }}>
            所有 NPM 包已在注册表上线，只读静态预览已同步就绪，元数据已原子写入。
          </p>
          <Link href="/components" className="filter-btn active" style={{ display: 'inline-block' }}>
            返回画廊查看已发布资产 →
          </Link>
        </div>
      )}

      {(job?.state === 'CONFLICT' || job?.state === 'REJECTED') && (
        <div style={{ padding: '20px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px', color: '#991b1b', marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '18px' }}>发布作业失败: {job.state}</h3>
          <p style={{ margin: '0 0 16px 0', fontSize: '14px' }}>
            {job.lastError ? JSON.stringify(job.lastError) : '作业在执行状态机时被阻断'}
          </p>
          <button
            type="button"
            className="filter-btn"
            disabled={retrying}
            onClick={handleRetry}
          >
            {retrying ? '重试中...' : '重试作业 (Retry Job)'}
          </button>
        </div>
      )}
    </main>
  );
}
