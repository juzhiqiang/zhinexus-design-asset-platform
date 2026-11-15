'use client';

import { useEffect, useState } from 'react';
import type { ProjectContext, ValidationResult } from '@company/contracts';
import { getStoredSession, saveSession, clearSession, type UserSession } from '../../lib/auth';
import { buildProjectContext } from '../../lib/project-context-form';

/**
 * 二期 B1：`/match` 项目上下文本地表单（本地校验）。
 *
 * 边界（与 kickoff 计划 B1 一致）：
 * - 只做 `ProjectContext` 采集与本地校验，不接入尚未交付的 Candidate/MatchPlan 或 search API；
 * - 不写项目需求，既有登录仍写会话（无 fetch、不持久化项目需求；`saveSession` 为既有 auth，未改）；
 * - 沿用控制台既有会话门（`getStoredSession`，仅展示用途），不改 auth；
 * - 未输入框架/版本时不猜测默认版本（空值交给本地校验报字段错误）。
 */
export default function ProjectContextMatchPage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [tokenInput, setTokenInput] = useState('');

  const [framework, setFramework] = useState('');
  const [frameworkVersion, setFrameworkVersion] = useState('');
  const [echartsVersion, setEchartsVersion] = useState('');
  const [packageManager, setPackageManager] = useState('');
  const [requirements, setRequirements] = useState<string[]>([]);
  const [requirementInput, setRequirementInput] = useState('');

  const [result, setResult] = useState<ValidationResult<ProjectContext> | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    const stored = getStoredSession();
    if (stored) setSession(stored);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    const saved = saveSession(tokenInput.trim());
    if (saved) {
      setSession(saved);
      setStatusMessage('');
    } else {
      setStatusMessage('Token 格式无效，无法解析身份');
    }
  };

  const handleLogout = () => {
    clearSession();
    setSession(null);
    setTokenInput('');
    setFramework('');
    setFrameworkVersion('');
    setEchartsVersion('');
    setPackageManager('');
    setRequirements([]);
    setRequirementInput('');
    setResult(null);
    setStatusMessage('');
  };

  // 任意字段/草稿/增删编辑都清理上一次校验结果与提示，过期成功/错误不得残留
  const clearOutcome = () => { setResult(null); setStatusMessage(''); };
  const onFramework = (v: string) => { setFramework(v); clearOutcome(); };
  const onFrameworkVersion = (v: string) => { setFrameworkVersion(v); clearOutcome(); };
  const onEchartsVersion = (v: string) => { setEchartsVersion(v); clearOutcome(); };
  const onPackageManager = (v: string) => { setPackageManager(v); clearOutcome(); };
  const onRequirementInput = (v: string) => { setRequirementInput(v); clearOutcome(); };

  const addRequirement = () => {
    if (!requirementInput.trim()) {
      clearOutcome();
      setStatusMessage('需求内容不能为空白');
      return;
    }
    setRequirements((prev) => [...prev, requirementInput]);
    setRequirementInput('');
    clearOutcome();
  };

  const removeRequirement = (index: number) => {
    setRequirements((prev) => prev.filter((_, i) => i !== index));
    clearOutcome();
  };

  const handleValidate = () => {
    // 存在非空未添加草稿时阻止校验并保留草稿：不静默丢失、不自动忽略
    if (requirementInput.trim()) {
      clearOutcome();
      setStatusMessage('请先添加当前需求');
      return;
    }
    const res = buildProjectContext({ framework, frameworkVersion, echartsVersion, packageManager, requirements });
    setResult(res);
    setStatusMessage(res.ok ? '本地校验通过' : '本地校验未通过，请修正字段错误');
  };

  // 未登录：复用控制台登录门（仅展示，安全性由服务端 Bearer 强制）
  if (!session) {
    return (
      <main>
        <p className="eyebrow">Zhinexus 工作区</p>
        <h1>登录后开放</h1>
        <p className="lead">项目上下文匹配需要登录。请输入开发者凭证（OIDC Bearer Token）以继续：</p>
        <form onSubmit={handleLogin} className="auth-form" style={{ maxWidth: 480, marginTop: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="token-input" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
              开发者 Bearer Token (或测试凭证):
            </label>
            <input
              id="token-input"
              type="text"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: 13, fontFamily: 'monospace' }}
            />
          </div>
          <button type="submit" className="filter-btn active">凭证登录</button>
          {statusMessage && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 12 }}>{statusMessage}</p>}
        </form>
      </main>
    );
  }

  const issues = result && !result.ok ? result.issues : [];
  const fieldError = (field: string): { id: string; message: string } | null => {
    const issue = issues.find((i) => i.path === `/${field}` || i.path.startsWith(`/${field}/`));
    return issue ? { id: `err-${field}`, message: issue.message } : null;
  };
  const frameworkError = fieldError('framework');
  const frameworkVersionError = fieldError('frameworkVersion');
  const echartsVersionError = fieldError('echartsVersion');
  const packageManagerError = fieldError('packageManager');
  const requirementsError = fieldError('requirements');

  return (
    <main>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <p className="eyebrow">Zhinexus 组件资产平台 · 项目上下文匹配</p>
          <h1>项目上下文</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            当前登录身份：<strong>{session.subject}</strong> · 渠道: <code>{session.channel}</code>
          </p>
        </div>
        <button type="button" className="filter-btn" onClick={handleLogout}>退出登录</button>
      </div>

      <div className="match-banner" role="note">
        匹配服务尚未接入：本页仅在本地校验项目上下文形状，不外发、不持久化，也不生成匹配候选或装配方案。
      </div>

      <div className="match-form">
        <div className="match-field">
          <label className="match-label" htmlFor="framework-select">目标框架</label>
          <select
            id="framework-select"
            className="match-control"
            value={framework}
            onChange={(e) => onFramework(e.target.value)}
            aria-invalid={frameworkError ? true : undefined}
            aria-describedby={frameworkError ? frameworkError.id : undefined}
          >
            <option value="">请选择框架</option>
            <option value="vue">Vue 3</option>
            <option value="react">React 19</option>
          </select>
          {frameworkError && <span id={frameworkError.id} className="field-error" role="alert">{frameworkError.message}</span>}
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="framework-version-input">框架版本（精确 x.y.z）</label>
          <input
            id="framework-version-input"
            className="match-control"
            type="text"
            value={frameworkVersion}
            onChange={(e) => onFrameworkVersion(e.target.value)}
            placeholder="例如 3.5.45 / 19.3.1"
            aria-invalid={frameworkVersionError ? true : undefined}
            aria-describedby={frameworkVersionError ? frameworkVersionError.id : undefined}
          />
          <span className="match-hint">未输入时不猜测默认版本；须为精确语义化版本，拒绝范围号。</span>
          {frameworkVersionError && <span id={frameworkVersionError.id} className="field-error" role="alert">{frameworkVersionError.message}</span>}
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="echarts-version-input">ECharts 版本（可选）</label>
          <input
            id="echarts-version-input"
            className="match-control"
            type="text"
            value={echartsVersion}
            onChange={(e) => onEchartsVersion(e.target.value)}
            placeholder="留空表示省略"
            aria-invalid={echartsVersionError ? true : undefined}
            aria-describedby={echartsVersionError ? echartsVersionError.id : undefined}
          />
          <span className="match-hint">留空将在校验前省略该可选字段。</span>
          {echartsVersionError && <span id={echartsVersionError.id} className="field-error" role="alert">{echartsVersionError.message}</span>}
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="package-manager-select">包管理器</label>
          <select
            id="package-manager-select"
            className="match-control"
            value={packageManager}
            onChange={(e) => onPackageManager(e.target.value)}
            aria-invalid={packageManagerError ? true : undefined}
            aria-describedby={packageManagerError ? packageManagerError.id : undefined}
          >
            <option value="">请选择包管理器</option>
            <option value="npm">npm</option>
            <option value="pnpm">pnpm</option>
          </select>
          {packageManagerError && <span id={packageManagerError.id} className="field-error" role="alert">{packageManagerError.message}</span>}
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="requirement-input">项目需求（可留空）</label>
          <div className="match-requirement-add">
            <input
              id="requirement-input"
              className="match-control"
              type="text"
              value={requirementInput}
              onChange={(e) => onRequirementInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRequirement(); } }}
              placeholder="输入一条需求后点击添加"
              aria-describedby={requirementsError ? requirementsError.id : undefined}
            />
            <button type="button" className="filter-btn" onClick={addRequirement}>添加需求</button>
          </div>
          <div id="requirements-list">
            {requirements.map((req, index) => (
              <div key={`${index}-${req}`} className="requirement-row">
                <span className="requirement-text">{req}</span>
                <button type="button" className="filter-btn" onClick={() => removeRequirement(index)}>删除</button>
              </div>
            ))}
          </div>
          {requirementsError && <span id={requirementsError.id} className="field-error" role="alert">{requirementsError.message}</span>}
        </div>

        <div className="match-actions">
          <button type="button" id="context-submit" className="filter-btn active" onClick={handleValidate}>校验项目上下文</button>
          {statusMessage && <span style={{ fontSize: 13, color: '#64748b' }}>{statusMessage}</span>}
        </div>
      </div>

      {result?.ok && (
        <div id="context-success" className="match-success" role="status">
          <strong>本地校验通过</strong>
          <pre className="match-json">{JSON.stringify(result.value, null, 2)}</pre>
          <p className="match-note">匹配服务尚未接入：以上仅为项目上下文形状校验结果，尚未生成匹配候选。</p>
        </div>
      )}

      {result && !result.ok && (
        <div id="context-errors" className="match-errors" role="alert">
          <strong>本地校验未通过：</strong>
          <ul>
            {result.issues.map((issue, i) => (
              <li key={`${issue.path}-${i}`}>
                <code>{issue.path || '/'}</code> — {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
