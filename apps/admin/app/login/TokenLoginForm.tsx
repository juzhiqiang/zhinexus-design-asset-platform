'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredSession, loadCompanySession, saveSession } from '../lib/auth';

function safeNextTarget(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) {
    return '/upload';
  }
  return value;
}

export function TokenLoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const target = safeNextTarget(nextPath);
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState('');

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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!tokenInput.trim()) return;
    const saved = saveSession(tokenInput.trim());
    if (!saved) {
      setError('凭证格式不正确，请粘贴有效的 JWT 令牌。');
      return;
    }
    router.replace(target);
  };

  return (
    <details className="zn-token-login" open>
      <summary>使用已有 OIDC 凭证登录</summary>
      {error ? <p className="access-error" role="alert">{error}</p> : null}
      <form className="zn-login-form" onSubmit={handleSubmit}>
        <label className="zn-field" htmlFor="token-input">
          <span className="zn-field-label">OIDC 凭证令牌</span>
          <input
            id="token-input"
            className="zn-input"
            type="password"
            value={tokenInput}
            placeholder="粘贴 OIDC Bearer JWT 令牌"
            autoComplete="off"
            onChange={(event) => setTokenInput(event.target.value)}
          />
        </label>
        <button className="filter-btn" type="submit">
          凭证登录
        </button>
      </form>
    </details>
  );
}
