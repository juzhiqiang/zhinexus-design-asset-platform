'use client';

import { ZnIcon } from './icons';

export type ServiceUnavailableProps = {
  status?: number;
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ServiceUnavailableState({ status, title, message, onRetry }: ServiceUnavailableProps) {
  const isInfra = status === 503 || /基础设施|未连接|暂时不可用|INFRA_UNAVAILABLE/i.test(message);
  const isForbidden = status === 403;
  const heading = title ?? (isForbidden ? '当前账号无访问权限' : '服务暂时不可用');

  return (
    <section className="access-panel zn-state-card" role="alert">
      <div className="zn-row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <ZnIcon
          name={isForbidden ? 'lock-keyhole' : 'triangle-alert'}
          size={20}
          color={isForbidden ? 'var(--zn-warning)' : 'var(--zn-danger)'}
        />
        <div className="zn-stack" style={{ gap: 6, flex: 1 }}>
          <h2>{heading}</h2>
          <p className="access-hint">{message}</p>
          {isInfra ? (
            <p className="zn-hint">
              请检查 API 启动日志及对应服务配置。本地开发可运行 <code>pnpm infra:up</code>、<code>pnpm dev:infra-migrate</code> 后重新启动 <code>pnpm dev</code>。
            </p>
          ) : null}
          {onRetry ? (
            <div style={{ marginTop: 6 }}>
              <button type="button" className="zn-btn" onClick={onRetry}>
                <ZnIcon name="refresh-cw" size={14} color="var(--zn-muted)" />
                重新加载
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
