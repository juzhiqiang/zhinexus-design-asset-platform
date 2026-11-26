'use client';

import { useEffect, useState } from 'react';
import {
  ACCESS_CHECKS,
  validateAccessConfig,
  type AccessAction,
  type AccessSection,
  type AccessSettingsView,
  type OidcAccessConfig,
  type PreviewAccessConfig,
} from '@company/contracts';
import { platformApiOrigin } from '../lib/auth';
import { accessSettings, AccessSettingsError, startCandidateWebLogin } from '../lib/access-settings-client';
import { ZnIcon } from '../lib/design/icons';
import { COMMAND_MOTIFS, ZnCommandMotif } from '../lib/design/motifs';
import { ServiceUnavailableState } from '../lib/design/ServiceUnavailableState';

const emptyOidc: OidcAccessConfig = {
  issuer: '',
  audience: '',
  webClientId: '',
  cliClientId: '',
  webRedirectUri: '',
  cliRedirectUri: '',
  roleClaim: '',
  roleMapping: { reader: '', publisher: '', maintainer: '' },
};

const names: Record<string, string> = {
  discovery: '身份服务元数据',
  secret: '密钥引用',
  webLogin: '网页登录',
  cliLogin: 'CLI 登录',
  roles: '业务角色',
  revocation: '公司撤权',
  adminLogin: '管理员登录',
  dns: 'DNS 解析',
  tls: 'TLS 证书',
  routing: '入口路由',
  gateway: '网关与凭证过滤',
};

const statuses = { passed: '通过', failed: '未通过', pending: '待验证' };

const sectionMeta = {
  oidc: {
    eyebrow: '06 / ACCESS REGISTRY',
    title: '接入与配置',
    description: '管理公司 OIDC 登录与隔离预览入口。保存草稿，完成实际验证后再启用。',
    motif: COMMAND_MOTIFS[2]!,
    tabs: [
      ['oidc', '01  公司登录（OIDC）'],
      ['preview', '02  预览入口'],
    ] as const,
  },
  preview: {
    eyebrow: '06 / PREVIEW GATEWAY',
    title: '预览入口',
    description: '配置隔离预览地址与访问边界，验证凭证过滤和短期路径授权。',
    motif: COMMAND_MOTIFS[3]!,
    tabs: [
      ['oidc', '01  公司登录（OIDC）'],
      ['preview', '02  预览入口'],
    ] as const,
  },
} as const;

export default function AccessSettingsPage() {
  const [view, setView] = useState<AccessSettingsView | null>(null);
  const [section, setSection] = useState<AccessSection>('oidc');
  const [oidc, setOidc] = useState(emptyOidc);
  const [preview, setPreview] = useState<PreviewAccessConfig>({ mode: 'ip-port', previewOrigin: '' });
  const [dirtySections, setDirtySections] = useState({ oidc: false, preview: false });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);

  const dirty = dirtySections[section];
  const setDirty = (value: boolean) => setDirtySections((old) => ({ ...old, [section]: value }));

  const install = (next: AccessSettingsView, preserveOther = false) => {
    setView(next);
    if (!preserveOther || section === 'oidc') setOidc(next.sections.oidc.draft?.config ?? next.sections.oidc.active?.config ?? emptyOidc);
    if (!preserveOther || section === 'preview') setPreview(next.sections.preview.draft?.config ?? next.sections.preview.active?.config ?? { mode: 'ip-port', previewOrigin: '' });
    if (preserveOther) setDirty(false);
    else setDirtySections({ oidc: false, preview: false });
  };

  const reload = async () => {
    setBusy(true);
    setError(null);
    try {
      install(await accessSettings());
    } catch (e) {
      setError({
        status: e instanceof AccessSettingsError ? e.status : undefined,
        message: e instanceof Error ? e.message : '接入服务暂时不可用。',
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const mutate = async (action: AccessAction, revision?: string) => {
    if (!view) return;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      const state = view.sections[section];
      const config = section === 'oidc' ? oidc : preview;
      if (action === 'draft' && !validateAccessConfig(section, config).ok) {
        throw new Error('配置格式不正确，请检查 HTTPS 地址、客户端和回调。');
      }
      const next = await accessSettings(
        section,
        action,
        action === 'draft'
          ? { expectedGeneration: state.generation, expectedRevision: state.draft?.id ?? null, config }
          : { expectedGeneration: state.generation, revision: revision ?? state.draft?.id },
      );
      install(next, true);
      setMessage(
        action === 'draft'
          ? '草稿已保存，请运行检查。'
          : action === 'validate'
            ? '检查已完成，请查看各项结果。'
            : action === 'activate'
              ? '此版本已启用。'
              : '已恢复此前版本，并生成新的活动代数。',
      );
    } catch (e) {
      setError({
        status: e instanceof AccessSettingsError ? e.status : undefined,
        message: e instanceof Error ? e.message : '操作失败。',
      });
    } finally {
      setBusy(false);
    }
  };

  const state = view?.sections[section];
  const draft = state?.draft;
  const required = section === 'oidc' ? ['discovery', 'secret', 'webLogin', 'cliLogin', 'roles', 'adminLogin'] : ['dns', 'tls', 'routing', 'gateway'];
  const canActivate = !!draft && !dirty && required.every((key) => draft.checks[key as keyof typeof draft.checks] === 'passed');

  const changeOidc = (key: keyof OidcAccessConfig, value: string) => {
    setOidc((old) => {
      const next = { ...old, [key]: value };
      if (key === 'secretRef' && !value) delete next.secretRef;
      return next;
    });
    setDirty(true);
  };

  const beginLogin = async (revision: string) => {
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await startCandidateWebLogin(revision));
    } catch (e) {
      setError({
        status: e instanceof AccessSettingsError ? e.status : undefined,
        message: e instanceof Error ? e.message : '验证入口暂时不可用。',
      });
      setBusy(false);
    }
  };

  const meta = sectionMeta[section];
  const passedCount = ACCESS_CHECKS[section].filter((key) => draft?.checks[key as keyof typeof draft.checks] === 'passed').length;
  const oidcFields = [
    ['issuer', 'Issuer'],
    ['audience', 'Audience'],
    ['webClientId', 'Web Client ID'],
    ['cliClientId', 'CLI Client ID'],
    ['webRedirectUri', 'Web 回调地址'],
    ['cliRedirectUri', 'CLI 回调地址'],
    ['roleClaim', '角色 Claim'],
    ['secretRef', '密钥引用（可选）'],
  ] as const;

  return (
    <main>
      <div className="access-heading zn-page-header">
        <div className="zn-header-copy">
          <p className="eyebrow">{meta.eyebrow}</p>
          <h1>{meta.title}</h1>
          <p className="lead">{meta.description}</p>
        </div>
        <ZnCommandMotif motif={meta.motif} className="zn-motif" />
        <div className="zn-header-actions">
          <button type="button" className="filter-btn" disabled={busy} onClick={() => void reload()}>
            <ZnIcon name="refresh-cw" size={15} color="var(--zn-muted)" />
            刷新配置
          </button>
        </div>
      </div>

      {!view && error ? (
        <ServiceUnavailableState status={error.status} message={error.message} onRetry={() => void reload()} />
      ) : !view ? (
        <section className="access-panel">
          <h2>正在读取接入配置…</h2>
          <p className="access-hint">请稍候，正在从平台管理 API 加载当前 OIDC 与预览网关配置。</p>
        </section>
      ) : (
        <>
          {error ? <p role="alert" className="access-error">{error.message}</p> : null}
          {message ? <p role="status" className="access-message">{message}</p> : null}

          <div role="tablist" aria-label="接入配置分区" className="access-tabs zn-tabs">
            {meta.tabs.map(([key, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={section === key}
                key={key}
                className={section === key ? 'filter-btn active zn-tab' : 'filter-btn zn-tab'}
                onClick={() => setSection(key)}
              >
                <ZnIcon name={key === 'oidc' ? 'key-round' : 'external-link'} size={15} className="zn-tab-icon" color={section === key ? 'var(--zn-accent)' : 'var(--zn-muted)'} />
                {label}
              </button>
            ))}
          </div>

          <div className="access-columns zn-grid-2">
            <section className="access-panel" role="tabpanel">
              <div className="access-title">
                <h2>{section === 'oidc' ? '公司登录' : '预览入口'}</h2>
                <span className="access-badge">活动代数 {state?.generation}</span>
              </div>
              <div className="access-active">
                <strong>{state?.active ? '已启用版本' : '尚未启用后台版本'}</strong>
                <p>{state?.active?.id ?? '首次启用前沿用部署配置。'}</p>
                {section === 'preview' && state?.active ? (
                  <p>{state.gatewayGeneration === state.generation ? 'API 与网关已接受此版本。' : 'API 已启用，等待网关确认此版本。'}</p>
                ) : null}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate('draft');
                }}
              >
                <fieldset disabled={busy} className="access-fields">
                  {section === 'preview' ? (
                    <>
                      <label>
                        隔离方式
                        <select
                          value={preview.mode}
                          onChange={(e) => {
                            setPreview({ ...preview, mode: e.target.value as PreviewAccessConfig['mode'] });
                            setDirty(true);
                          }}
                        >
                          <option value="ip-port">同 IP 分 HTTPS 端口</option>
                          <option value="domain">独立预览域</option>
                        </select>
                      </label>
                      <label>
                        预览地址
                        <input
                          value={preview.previewOrigin}
                          placeholder="https://预览入口"
                          onChange={(e) => {
                            setPreview({ ...preview, previewOrigin: e.target.value });
                            setDirty(true);
                          }}
                        />
                      </label>
                      <p className="access-hint">独立域检查至少两个已发布实现的主机。IP 入口需要独立端口、可信 IP SAN 证书和凭证过滤。</p>
                    </>
                  ) : (
                    <>
                      {oidcFields.map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            value={oidc[key] ?? ''}
                            placeholder={key === 'webRedirectUri' ? platformApiOrigin + '/v1/auth/oidc/callback' : undefined}
                            onChange={(e) => changeOidc(key, e.target.value)}
                          />
                        </label>
                      ))}
                      {(['reader', 'publisher', 'maintainer'] as const).map((role) => (
                        <label key={role}>
                          {role} 映射
                          <input
                            value={oidc.roleMapping[role]}
                            onChange={(e) => {
                              setOidc({ ...oidc, roleMapping: { ...oidc.roleMapping, [role]: e.target.value } });
                              setDirty(true);
                            }}
                          />
                        </label>
                      ))}
                      <label>
                        附加 scope（空格分隔）
                        <input
                          value={oidc.scopes?.join(' ') ?? ''}
                          onChange={(e) => {
                            setOidc({ ...oidc, scopes: e.target.value.split(/\s+/).filter(Boolean) });
                            setDirty(true);
                          }}
                        />
                      </label>
                      <p className="access-hint">密钥仅填写部署引用。实际 Web、CLI 登录和角色检查通过后可以启用；公司撤权证据按 G2 验收。</p>
                    </>
                  )}
                </fieldset>
                <div className="access-actions">
                  <button className="filter-btn active" type="submit" disabled={busy}>保存草稿</button>
                  <button className="filter-btn" type="button" disabled={busy || !draft || dirty} onClick={() => void mutate('validate')}>运行检查</button>
                  <button className="filter-btn" type="button" disabled={busy || !canActivate} onClick={() => void mutate('activate')}>启用此版本</button>
                </div>
              </form>
              {section === 'oidc' && draft ? (
                <details open>
                  <summary>实际登录验证</summary>
                  <p>
                    <button type="button" className="filter-btn" disabled={busy || dirty} onClick={() => void beginLogin(draft.id)}>
                      验证候选网页登录
                    </button>
                  </p>
                  <p className="access-hint">在已设置管理员凭证环境的本机 CLI 中执行：</p>
                  <code className="access-command">component login --api-url {platformApiOrigin} --candidate {draft.id}</code>
                </details>
              ) : null}
              {state?.active ? (
                <details>
                  <summary>与当前版本比较</summary>
                  <div className="access-comparison">
                    <div>
                      <strong>当前版本</strong>
                      <pre>{JSON.stringify(state.active.config, null, 2)}</pre>
                    </div>
                    <div>
                      <strong>编辑内容</strong>
                      <pre>{JSON.stringify(section === 'oidc' ? oidc : preview, null, 2)}</pre>
                    </div>
                  </div>
                </details>
              ) : null}
            </section>

            <aside>
              <section className="access-panel">
                <h2>{section === 'oidc' ? '策略验证台' : '网关策略验证台'}</h2>
                <p className="access-hint">{draft?.checkedAt ? '最近检查：' + new Date(draft.checkedAt).toLocaleString('zh-CN') : '保存草稿后运行检查。'}</p>
                <p className="access-badge">
                  {String(passedCount).padStart(2, '0')} / {String(ACCESS_CHECKS[section].length).padStart(2, '0')} VERIFIED
                </p>
                <ul className="access-checks">
                  {ACCESS_CHECKS[section].map((key) => (
                    <li key={key} data-testid={'check-' + key}>
                      <span>{names[key]}</span>
                      <span className={'access-check ' + (draft?.checks[key] ?? 'pending')}>{statuses[draft?.checks[key] ?? 'pending']}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="access-panel">
                <h2>版本恢复策略</h2>
                <p className="access-hint">
                  {section === 'oidc' ? '恢复前重新检查入口；公司登录恢复需先验证管理员登录。' : '恢复前重新检查预览入口与凭证过滤。'}
                </p>
                {state?.history
                  .filter((r) => r.activated && r.id !== state.active?.id)
                  .map((r) => (
                    <div className="access-history" key={r.id}>
                      <code>{r.id}</code>
                      <span className="zn-badge zn-badge-warning">
                        <span className="zn-badge-dot" />
                        需验证
                      </span>
                      <button type="button" className="filter-btn" disabled={busy} onClick={() => void mutate('rollback', r.id)}>
                        {section === 'oidc' ? '恢复此版本' : '恢复'}
                      </button>
                      {section === 'oidc' ? (
                        <>
                          <button type="button" className="filter-btn" disabled={busy} onClick={() => void beginLogin(r.id)}>
                            验证管理员登录
                          </button>
                          <p className="access-hint">
                            Web / CLI / 管理员：{statuses[r.checks.webLogin ?? 'pending']} / {statuses[r.checks.cliLogin ?? 'pending']} / {statuses[r.checks.adminLogin ?? 'pending']}
                          </p>
                          <code className="access-command">component login --api-url {platformApiOrigin} --candidate {r.id}</code>
                        </>
                      ) : null}
                    </div>
                  ))}
                {!state?.history.some((r) => r.activated && r.id !== state.active?.id) ? <p className="access-hint">暂无可恢复版本。</p> : null}
              </section>
            </aside>
          </div>

          <section className="access-panel" role="region" aria-label="变更审计">
            <div className="access-title">
              <h2>变更审计台账</h2>
              <span className="access-badge">查看全部</span>
            </div>
            {view.audit.length ? (
              <div className="access-audit">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>操作者</th>
                      <th>分区 / 操作</th>
                      <th>版本</th>
                      <th>结果</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.audit.map((entry, i) => (
                      <tr key={i}>
                        <td>{new Date(entry.at).toLocaleString('zh-CN')}</td>
                        <td>{entry.actor}</td>
                        <td>{entry.section} / {entry.action}</td>
                        <td><code>{entry.revision}</code></td>
                        <td>{entry.result === 'failed' ? '未通过' : '已记录'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="access-hint">暂无变更记录。</p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
