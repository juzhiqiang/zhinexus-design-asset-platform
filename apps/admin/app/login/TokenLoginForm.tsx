'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { companyLoginUrl, getStoredSession, loadCompanySession, platformApiOrigin, saveSession } from '../lib/auth';
import { ZnIcon } from '../lib/design/icons';

function safeNextTarget(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) {
    return '/assets';
  }
  return value;
}

export function TokenLoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const target = safeNextTarget(nextPath);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [requireNewPassword, setRequireNewPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');

  useEffect(() => {
    if (getStoredSession()) {
      router.replace(target);
      return;
    }
    let cancelled = false;
    void loadCompanySession().then((session) => {
      if (!cancelled && session) {
        router.replace(target);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [router, target]);

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPasswordError('');
    if (!username.trim() || !password) return;
    setSubmitting(true);
    try {
      const response = await fetch(`${platformApiOrigin}/identity/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          username: username.trim(),
          password,
          ...(requireNewPassword && newPassword ? { new_password: newPassword } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        access_token?: unknown;
        code?: unknown;
        message?: unknown;
        details?: Array<{ path?: string; message?: string }>;
      } | null;
      if (!response.ok) {
        if (response.status === 503 || payload?.code === 'INFRA_UNAVAILABLE') {
          setPasswordError('账号服务暂时不可用，请检查 API 启动日志及身份服务配置。本地开发请完成基础设施启动和数据库迁移后重启 pnpm dev。');
          return;
        }
        const firstLoginIssue = payload?.details?.find((item) => item.path === 'newPassword');
        if (firstLoginIssue) {
          setRequireNewPassword(true);
          setPasswordError(firstLoginIssue.message || '首次登录必须设置新密码（至少 12 个字符）。');
          return;
        }
        if (response.status === 403) {
          setPasswordError('该账号已停用，请联系平台管理员。');
          return;
        }
        setPasswordError(payload?.details?.[0]?.message || (typeof payload?.message === 'string' ? payload.message : '') || '用户名或密码不正确。');
        return;
      }
      if (typeof payload?.access_token !== 'string' || !saveSession(payload.access_token)) {
        setPasswordError('登录响应缺少有效令牌，请重试或联系管理员。');
        return;
      }
      router.replace(target);
    } catch {
      setPasswordError('无法连接到登录服务，请确认 API 服务已启动。');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTokenSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setTokenError('');
    if (!tokenInput.trim()) return;
    const saved = saveSession(tokenInput.trim());
    if (!saved) {
      setTokenError('凭证格式不正确，请粘贴有效的 JWT 令牌。');
      return;
    }
    router.replace(target);
  };

  return (
    <div className="zn-login-modes">
      {passwordError ? <p className="access-error" role="alert">{passwordError}</p> : null}

      <form className="zn-login-form" onSubmit={handlePasswordSubmit}>
        <label className="zn-field" htmlFor="direct-username">
          <span className="zn-field-label">用户名</span>
          <input
            id="direct-username"
            className="zn-input"
            name="username"
            value={username}
            placeholder="输入管理员用户名"
            autoComplete="username"
            disabled={submitting}
            required
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="zn-field" htmlFor="direct-password">
          <span className="zn-field-label">密码</span>
          <input
            id="direct-password"
            className="zn-input"
            name="password"
            type="password"
            value={password}
            placeholder="输入密码"
            autoComplete="current-password"
            disabled={submitting}
            required
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        {requireNewPassword ? (
          <label className="zn-field" htmlFor="direct-new-password">
            <span className="zn-field-label">新密码</span>
            <input
              id="direct-new-password"
              className="zn-input"
              name="new_password"
              type="password"
              value={newPassword}
              placeholder="设置新密码（至少 12 个字符）"
              autoComplete="new-password"
              disabled={submitting}
              required
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <span className="zn-hint">至少 12 个字符，且不能与当前口令相同。</span>
          </label>
        ) : null}

        <button className="zn-btn zn-btn-primary zn-btn-block zn-btn-tall" type="submit" disabled={submitting}>
          {submitting ? '正在登录…' : '密码登录'}
        </button>
      </form>

      <div className="zn-login-divider" role="separator">
        <span>或</span>
      </div>

      <a className="zn-btn zn-btn-block zn-btn-tall" href={companyLoginUrl}>
        <ZnIcon name="shield-check" size={16} color="currentColor" />
        账号登录
      </a>

      <details className="zn-token-login">
        <summary>使用已有 OIDC 凭证登录</summary>
        {tokenError ? <p className="access-error" role="alert">{tokenError}</p> : null}
        <form className="zn-login-form" onSubmit={handleTokenSubmit}>
          <label className="zn-field" htmlFor="token-input">
            <span className="zn-field-label">OIDC 凭证令牌</span>
            <input
              id="token-input"
              className="zn-input zn-input-mono"
              type="password"
              value={tokenInput}
              placeholder="粘贴 OIDC Bearer JWT 令牌"
              autoComplete="off"
              onChange={(event) => setTokenInput(event.target.value)}
            />
          </label>
          <button className="zn-btn zn-btn-block" type="submit">
            凭证登录
          </button>
        </form>
      </details>
    </div>
  );
}
