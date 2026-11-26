'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { getAuthCredentials, getAuthHeaders, getStoredSession, loadCompanySession, platformApiOrigin } from '../../lib/auth';
import { fetchReleaseJob } from '../../lib/uploads/manifest-form';
import { ZnIcon } from '../../lib/design/icons';
import { COMMAND_MOTIFS, ZnCommandMotif } from '../../lib/design/motifs';

const MOTIF = COMMAND_MOTIFS[1]!;

/** 步骤器固定 7 步（tests/browser/manual-release.spec.ts 断言 `.pipeline-step` 为 7）。 */
const stages = [
  'PENDING',
  'FINALIZE_OBJECTS',
  'ENSURE_PACKAGES',
  'REGISTER_ASSETS',
  'CHECK_AVAILABILITY',
  'READY_TX',
  'READY',
];

const CHECKPOINT_ORDER = ['PENDING', 'FINALIZE_OBJECTS', 'ENSURE_PACKAGES', 'REGISTER_ASSETS', 'CHECK_AVAILABILITY', 'READY_TX', 'READY'];

type CheckRow = { key: string; label: string; at: string };

/** 可达性检查清单：按当前推进点推导真实状态，不写死示例数据。 */
const AVAILABILITY_CHECKS: { key: string; label: string; stage: string }[] = [
  { key: 'objects', label: '冻结对象摘要', stage: 'FINALIZE_OBJECTS' },
  { key: 'packages', label: 'Verdaccio 包版本', stage: 'ENSURE_PACKAGES' },
  { key: 'preview', label: '静态预览入口', stage: 'CHECK_AVAILABILITY' },
  { key: 'database', label: 'PostgreSQL 事务', stage: 'READY_TX' },
];

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
    let token = getStoredSession()?.token;

    let timer: any;
    let cancelled = false;

    async function poll() {
      try {
        const data = await fetchReleaseJob(platformApiOrigin, token!, jobId);
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

    if (token) {
      void poll();
    } else {
      void loadCompanySession().then((session) => {
        token = session?.token;
        if (cancelled) return;
        if (token) void poll();
        else setError('未登录或未找到凭证，请先登录控制台');
      });
    }

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
      const res = await fetch(`${platformApiOrigin}/v1/releases/${jobId}/retry`, {
        credentials: getAuthCredentials(session),
        redirect: 'error',
        method: 'POST',
        headers: getAuthHeaders(session),
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

  const currentStageIndex = stages.indexOf(job?.stage ?? job?.state ?? 'PENDING');
  const isReady = job?.state === 'READY';

  const checkState = (stage: string): 'done' | 'current' | 'todo' => {
    const target = CHECKPOINT_ORDER.indexOf(stage);
    const now = currentStageIndex < 0 ? 0 : currentStageIndex;
    if (isReady || target < now) return 'done';
    if (target === now) return 'current';
    return 'todo';
  };

  const timeline: CheckRow[] = stages
    .map((stage, index) => ({ stage, index }))
    .filter(({ index }) => index <= (currentStageIndex < 0 ? 0 : currentStageIndex) || isReady)
    .reverse()
    .map(({ stage }) => ({ key: stage, label: stage, at: stage === (job?.stage ?? job?.state) && !isReady ? '当前' : '完成' }));

  return (
    <main>
      <nav className="breadcrumb" aria-label="面包屑">
        <Link href="/jobs">发布作业</Link>
        <span>/</span>
        <span>作业跟踪</span>
      </nav>

      <div className="zn-page-header access-heading">
        <div className="zn-header-copy">
          <p className="eyebrow">02 / RELEASE JOB · {jobId}</p>
          <h1>发布作业流水线状态跟踪</h1>
          <p className="lead">跟踪不可变产物从对象冻结到可用性确认的完整流水线。作业编号：<span style={{ fontFamily: 'var(--zn-font-mono)', fontSize: 16 }}>{jobId}</span></p>
        </div>
        <ZnCommandMotif motif={MOTIF} className="zn-motif" />
        <div className="zn-header-actions">
          <button className="filter-btn" onClick={() => window.location.reload()}>
            <ZnIcon name="refresh-cw" size={15} color="var(--zn-muted)" />刷新状态
          </button>
        </div>
      </div>

      {error && <p className="access-error" role="alert">{error}</p>}

      {/* 阶段指示器 */}
      <section className="zn-card-raised zn-stack" aria-label="推进阶段">
        <div className="zn-card-head" style={{ marginBottom: 0 }}>
          <div>
            <h2 className="zn-card-title">推进阶段</h2>
            <p className="zn-card-subtitle">自动轮询 · {job?.pollAfterMs ?? 1000} ms</p>
          </div>
          <span className={`zn-badge ${isReady ? 'zn-badge-success' : 'zn-badge-warning'}`}>
            <span className="zn-badge-dot" />
            {job?.state ?? 'PENDING'}
          </span>
        </div>
        <div className="zn-stepper">
          {stages.map((st, i) => {
            const state = isReady ? 'done' : i < currentStageIndex ? 'done' : i === currentStageIndex ? 'current' : 'todo';
            return (
              <div key={st} className={`zn-step zn-step-${state} pipeline-step`} data-step={st}>
                <div className="zn-step-state">
                  <ZnIcon
                    name={state === 'todo' ? 'circle' : state === 'current' ? 'loader-circle' : 'check'}
                    size={14}
                    className="zn-step-icon"
                    color={state === 'done' ? 'var(--zn-success)' : state === 'current' ? 'var(--zn-accent)' : 'var(--zn-muted)'}
                  />
                  <span className="zn-step-status">{state === 'done' ? '已完成' : state === 'current' ? '进行中' : '待执行'}</span>
                </div>
                <div className="zn-step-name">{st}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 状态看板 */}
      <div className="status-grid">
        <div className="status-card">
          <span className="label"><ZnIcon name="activity" size={14} color="var(--zn-muted)" />作业状态 (State)</span>
          <span className={`value ${job?.state === 'READY' ? 'ready' : ''}`}>{job?.state ?? 'PENDING'}</span>
        </div>
        <div className="status-card">
          <span className="label"><ZnIcon name="git-commit-horizontal" size={14} color="var(--zn-muted)" />当前推进点 (Stage)</span>
          <span className="value">{job?.stage ?? 'INITIALIZING'}</span>
        </div>
        <div className="status-card">
          <span className="label"><ZnIcon name="rotate-ccw" size={14} color="var(--zn-muted)" />重试计数 (Attempt)</span>
          <span className="value">{job?.attempt ?? 0}</span>
        </div>
        <div className="status-card">
          <span className="label"><ZnIcon name="timer" size={14} color="var(--zn-muted)" />轮询建议间隔</span>
          <span className="value">{job?.pollAfterMs ?? 1000} ms</span>
        </div>
      </div>

      {/* 成功 / 失败处理 */}
      {job?.state === 'READY' && (
        <div className="access-message" role="status">
          <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>发布作业已成功到达 READY 状态</h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px' }}>
            所有 NPM 包已在注册表上线，只读静态预览已同步就绪，元数据已原子写入。
          </p>
          <Link href="/upload" className="filter-btn active" style={{ display: 'inline-block' }}>
            返回发布控制台 →
          </Link>
        </div>
      )}

      {(job?.state === 'CONFLICT' || job?.state === 'REJECTED') && (
        <div className="access-error" role="alert">
          <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>发布作业失败: {job.state}</h3>
          <p style={{ margin: '0 0 16px', fontSize: '13px' }}>
            {job.lastError ? JSON.stringify(job.lastError) : '作业在执行状态机时被阻断'}
          </p>
          <button type="button" className="filter-btn" disabled={retrying} onClick={handleRetry}>
            {retrying ? '重试中...' : '重试作业 (Retry Job)'}
          </button>
        </div>
      )}

      <div className="zn-grid-2">
        {/* 当前操作与可达性检查 */}
        <section className="zn-card-raised zn-stack" aria-label="当前操作">
          <div className="zn-card-head" style={{ marginBottom: 0 }}>
            <div className="zn-row" style={{ gap: 10 }}>
              <span className="zn-motif" style={{ position: 'static', width: 34, height: 34, opacity: 1, background: 'var(--zn-accent-soft)', borderRadius: 10, display: 'grid', placeItems: 'center' }}>
                <ZnIcon name="scan-line" size={16} color="var(--zn-accent)" />
              </span>
              <div>
                <h2 className="zn-card-title">正在检查产物可达性</h2>
                <p className="zn-card-subtitle">检查冻结文件、预览入口及已登记的 npm 包</p>
              </div>
            </div>
            <span className={`zn-badge ${isReady ? 'zn-badge-success' : 'zn-badge-warning'}`}>
              <span className="zn-badge-dot" />
              {isReady ? '已完成' : '进行中'}
            </span>
          </div>

          <div className="zn-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, Math.round(((currentStageIndex < 0 ? 0 : currentStageIndex) / (CHECKPOINT_ORDER.length - 1)) * 100)))}>
            <span className="zn-progress-value" style={{ width: `${Math.max(0, Math.min(100, Math.round(((currentStageIndex < 0 ? 0 : currentStageIndex) / (CHECKPOINT_ORDER.length - 1)) * 100)))}%` }} />
          </div>

          <div className="zn-checks">
            {AVAILABILITY_CHECKS.map(check => {
              const state = checkState(check.stage);
              return (
                <div className="zn-check" key={check.key}>
                  <span className="zn-check-group">
                    <ZnIcon
                      name={state === 'done' ? 'check' : state === 'current' ? 'loader-circle' : 'clock-3'}
                      size={15}
                      className="zn-check-icon"
                      color={state === 'done' ? 'var(--zn-success)' : state === 'current' ? 'var(--zn-accent)' : 'var(--zn-subtle)'}
                    />
                    <span className="zn-check-label">{check.label}</span>
                  </span>
                  <span className="zn-check-status" style={{ color: state === 'done' ? 'var(--zn-success)' : state === 'current' ? 'var(--zn-accent)' : 'var(--zn-muted)' }}>
                    {state === 'done' ? '已确认' : state === 'current' ? '检查中' : '等待中'}
                  </span>
                </div>
              );
            })}
            {!!job?.missingArtifacts?.length && (
              <div className="zn-check">
                <span className="zn-check-group">
                  <ZnIcon name="triangle-alert" size={15} className="zn-check-icon" color="var(--zn-danger)" />
                  <span className="zn-check-label">缺失产物</span>
                </span>
                <span className="zn-check-status" style={{ color: 'var(--zn-danger)' }}>{job.missingArtifacts.join('、')}</span>
              </div>
            )}
          </div>
        </section>

        {/* 作业动态 */}
        <section className="zn-card-raised zn-stack" aria-label="作业动态">
          <h2 className="zn-card-title" style={{ marginBottom: 0 }}>作业动态</h2>
          <div className="zn-timeline">
            {timeline.map(event => (
              <div className="zn-event" key={event.key}>
                <span className="zn-event-dot" style={{ background: event.at === '当前' ? 'var(--zn-accent)' : 'var(--zn-success)' }} />
                <span className="zn-event-copy">
                  <span className="zn-event-label">{event.label}</span>
                  <span className="zn-event-time">{event.at === '当前' ? `当前 · 第 ${(job?.attempt ?? 0) + 1} 次尝试` : '完成'}</span>
                </span>
              </div>
            ))}
            {!timeline.length && <p className="access-hint">等待作业开始推进。</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
