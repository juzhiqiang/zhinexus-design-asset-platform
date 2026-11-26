'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { JobsApiError, listReleaseJobs, retryReleaseJob, type ReleaseJobSummary } from '../lib/jobs-client';
import { ZnIcon } from '../lib/design/icons';
import { COMMAND_MOTIFS, ZnCommandMotif } from '../lib/design/motifs';
import { ServiceUnavailableState } from '../lib/design/ServiceUnavailableState';

const MOTIF = COMMAND_MOTIFS[1]!;

const STATE_OPTIONS = ['ALL', 'UPLOADING', 'VALIDATING', 'PENDING', 'PUBLISHING', 'RETRY_WAIT', 'READY', 'REJECTED', 'CONFLICT'] as const;

function badgeClass(state: ReleaseJobSummary['state']): string {
  if (state === 'READY') return 'zn-badge-success';
  if (state === 'REJECTED' || state === 'CONFLICT') return 'zn-badge-danger';
  return 'zn-badge-warning';
}

export default function JobsListPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<ReleaseJobSummary[]>([]);
  const [stateFilter, setStateFilter] = useState<(typeof STATE_OPTIONS)[number]>('ALL');
  const [jumpJobId, setJumpJobId] = useState('');
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const items = await listReleaseJobs({ state: stateFilter, limit: 50 });
      setJobs(items);
    } catch (err) {
      setError({
        status: err instanceof JobsApiError ? err.status : undefined,
        message: err instanceof Error ? err.message : '读取发布作业列表失败。',
      });
    } finally {
      setLoading(false);
    }
  }, [stateFilter]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const handleRetry = async (jobId: string) => {
    setRetryingId(jobId);
    setNotice(null);
    try {
      await retryReleaseJob(jobId);
      setNotice(`作业 ${jobId} 已重新入队。`);
      await loadJobs();
    } catch (err) {
      setError({
        status: err instanceof JobsApiError ? err.status : undefined,
        message: err instanceof Error ? err.message : '重试作业失败。',
      });
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <main>
      <div className="zn-page-header access-heading">
        <div className="zn-header-copy">
          <p className="eyebrow">03 / RELEASE JOBS</p>
          <h1>发布作业</h1>
          <p className="lead">查看 CLI 与网页通道提交的发布流水线记录，追踪三存储同步阶段并对可重试作业发起恢复。</p>
        </div>
        <ZnCommandMotif motif={MOTIF} className="zn-motif" />
        <div className="zn-header-actions">
          <Link href="/upload" className="filter-btn active">
            <ZnIcon name="upload" size={15} color="var(--zn-on-primary)" />
            新建发布
          </Link>
          <button type="button" className="filter-btn" disabled={loading} onClick={() => void loadJobs()}>
            <ZnIcon name="refresh-cw" size={15} color="var(--zn-muted)" />
            刷新列表
          </button>
        </div>
      </div>

      {notice ? <p className="access-message" role="status">{notice}</p> : null}

      <section className="zn-card" aria-label="作业筛选与直达">
        <div className="zn-card-head" style={{ marginBottom: 0 }}>
          <div className="zn-row" style={{ gap: 10 }}>
            <label className="zn-row" style={{ gap: 8 }}>
              <span className="zn-field-label">状态筛选</span>
              <select
                className="zn-input"
                style={{ width: 160, height: 34 }}
                value={stateFilter}
                aria-label="作业状态筛选"
                onChange={(e) => setStateFilter(e.target.value as (typeof STATE_OPTIONS)[number])}
              >
                {STATE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt === 'ALL' ? '全部状态' : opt}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <form
            className="zn-row"
            style={{ gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = jumpJobId.trim();
              if (trimmed) router.push(`/jobs/${encodeURIComponent(trimmed)}`);
            }}
          >
            <input
              className="zn-input zn-input-mono"
              style={{ width: 260, height: 34 }}
              value={jumpJobId}
              placeholder="输入作业 ID 快速直达"
              aria-label="输入作业 ID 快速直达"
              onChange={(e) => setJumpJobId(e.target.value)}
            />
            <button type="submit" className="filter-btn" disabled={!jumpJobId.trim()}>
              打开详情
            </button>
          </form>
        </div>
      </section>

      {error ? (
        <ServiceUnavailableState status={error.status} message={error.message} onRetry={() => void loadJobs()} />
      ) : (
        <section className="zn-card" aria-label="发布作业列表">
          <div className="zn-table-scroll">
            <table className="zn-table">
              <thead>
                <tr>
                  <th>作业 ID</th>
                  <th>状态</th>
                  <th>推进阶段</th>
                  <th>通道</th>
                  <th>发布包</th>
                  <th>操作者</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.jobId}>
                    <td className="zn-table-cell-strong zn-table-cell-mono">
                      <Link href={`/jobs/${encodeURIComponent(job.jobId)}`}>{job.jobId.slice(0, 14)}…</Link>
                    </td>
                    <td>
                      <span className={`zn-badge ${badgeClass(job.state)}`}>
                        <span className="zn-badge-dot" />
                        {job.state}
                      </span>
                    </td>
                    <td className="zn-table-cell-mono">{job.stage}</td>
                    <td>{job.channel === 'cli' ? 'CLI 自动' : '网页手动'}</td>
                    <td className="zn-table-cell-mono">
                      {job.packages.length ? job.packages.map((p) => `${p.name}@${p.version}`).join(', ') : `${job.variantCount} 个实现`}
                    </td>
                    <td>{job.subject}</td>
                    <td>{new Date(job.updatedAt).toLocaleString('zh-CN')}</td>
                    <td>
                      <div className="zn-row" style={{ gap: 6 }}>
                        <Link href={`/jobs/${encodeURIComponent(job.jobId)}`} className="filter-btn">
                          详情
                        </Link>
                        {job.state === 'RETRY_WAIT' && (
                          <button
                            type="button"
                            className="filter-btn"
                            disabled={retryingId === job.jobId}
                            onClick={() => void handleRetry(job.jobId)}
                          >
                            {retryingId === job.jobId ? '重试中…' : '重试'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {!jobs.length && (
                  <tr>
                    <td colSpan={8}>{loading ? '正在读取发布作业…' : '暂无发布作业记录。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
