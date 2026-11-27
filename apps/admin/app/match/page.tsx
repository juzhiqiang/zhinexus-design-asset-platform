'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ProjectContext, SearchCandidatesResponse, ValidationResult } from '@company/contracts';
import { getStoredSession, loadCompanySession, notifySessionExpired, type UserSession } from '../lib/auth';
import { buildProjectContext } from '../lib/project-context-form';
import { searchCandidates } from '../lib/search-client';
import { CandidateResults } from './CandidateResults';
import { ComponentQuery } from './ComponentQuery';
import { DesignIdMatch } from './DesignIdMatch';
import { ZnIcon } from '../lib/design/icons';
import { COMMAND_MOTIFS, ZnCommandMotif } from '../lib/design/motifs';

const MOTIF = COMMAND_MOTIFS[5]!;

/**
 * 顶栏 ⌘K 检索入口落地同步：外壳把查询放到 `/match?q=`，这里读取并预填检索框。
 * 单独拆出组件是为了让 `useSearchParams()` 位于 `<Suspense>` 边界内（Next 静态渲染要求）。
 */
function SearchQuerySync({ onQuery }: { onQuery: (query: string) => void }) {
  const params = useSearchParams();
  const query = params.get('q') ?? '';
  useEffect(() => {
    if (query) onQuery(query);
  }, [query, onQuery]);
  return null;
}

/**
 * 二期 B1 + B3 + ID 规则匹配 + P1 组件精确查询：`/match` 项目上下文本地校验 + 文本检索接入 +
 * 设计 ID 配置 + 组件标识 GET 查询。
 *
 * 边界：
 * - 保留 B1 本地校验按钮及全部行为（未输入框架/版本不猜测默认版本）；
 * - B3 新增 query 与可选 React DOM 精确版本输入及**独立搜索按钮**：只有显式点击搜索才 POST，
 *   Bearer 取当前 session；编辑字段不会触发检索；
 * - 表单任何编辑、退出登录、身份切换、组件卸载均取消在途请求并**忽略旧响应**，
 *   重试也不能恢复旧身份数据；
 * - requirements 存在未添加草稿时拒绝检索提交并保留草稿；
 * - 不持久化查询、上下文或响应；不回显服务端原始错误或 token；
 * - 设计 ID 规则匹配交给 `DesignIdMatch` 子组件：显式点击才 POST，规则/元素/绑定/上下文
 *   任意改动取消并清旧结果，响应落地复核身份与 inputDigest；
 * - P1 组件标识精确查询交给 `ComponentQuery` 子组件：显式点击才 GET，输入/身份变化取消并清结果，
 *   响应经公开运行时校验并核对 query 对齐；不回写设计规则；
 * - 沿用控制台既有会话门（`getStoredSession`，仅展示用途），不改 auth。
 */

const DEFAULT_API_ORIGIN = process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000';

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; response: SearchCandidatesResponse }
  | { kind: 'empty'; response: SearchCandidatesResponse }
  | { kind: 'error'; message: string };

export default function ProjectContextMatchPage() {
  const router = useRouter();
  const [session, setSession] = useState<UserSession | null>(() => getStoredSession());

  const [framework, setFramework] = useState('');
  const [frameworkVersion, setFrameworkVersion] = useState('');
  const [echartsVersion, setEchartsVersion] = useState('');
  const [packageManager, setPackageManager] = useState('');
  const [requirements, setRequirements] = useState<string[]>([]);
  const [requirementInput, setRequirementInput] = useState('');

  const [result, setResult] = useState<ValidationResult<ProjectContext> | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  // B3 检索状态
  const [searchQuery, setSearchQuery] = useState('');
  const [reactDomVersion, setReactDomVersion] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({ kind: 'idle' });

  // 在途请求控制器与「请求代次」：编辑/退出/换身份/卸载均取消并忽略旧响应
  const inFlight = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  // 发起检索时锁定的身份快照：提交前与响应落地前复核，防同页写 localStorage 但尚未触发 focus/storage
  const searchIdentity = useRef<{ token: string; subject: string } | null>(null);

  // 上下文的本地校验结果 memo 化：仅当上文字段真正变化时才换引用，
  // 供 `DesignIdMatch` 以「引用变化」判断上下文被编辑，从而取消在途请求并清理旧方案。
  const contextCheck = useMemo(
    () => buildProjectContext({ framework, frameworkVersion, echartsVersion, packageManager, requirements }),
    [framework, frameworkVersion, echartsVersion, packageManager, requirements],
  );

  useEffect(() => {
    const stored = getStoredSession();
    if (stored) setSession(stored);
    void loadCompanySession().then(value=>{if(value)setSession(value);});
  }, []);

  /** 复核当前会话是否仍与锁定快照一致（token 与 subject 都比对）；不一致则取消并不回显。 */
  const isSessionStillCurrent = (): boolean => {
    const locked = searchIdentity.current;
    if (!locked) return false;
    const stored = getStoredSession();
    return Boolean(stored && stored.token === locked.token && stored.subject === locked.subject);
  };

  // 卸载清理：取消在途请求，组件卸载后迟到响应不得写入状态
  useEffect(() => {
    return () => {
      requestGeneration.current += 1;
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, []);

  /** 取消在途请求并使其结果失效（幂等）。 */
  const cancelInFlight = () => {
    requestGeneration.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
    searchIdentity.current = null;
  };

  /** 重置全部表单与检索状态（不触碰 session）。 */
  const resetFormState = () => {
    setFramework('');
    setFrameworkVersion('');
    setEchartsVersion('');
    setPackageManager('');
    setRequirements([]);
    setRequirementInput('');
    setResult(null);
    setStatusMessage('');
    setSearchQuery('');
    setReactDomVersion('');
    setSearchState({ kind: 'idle' });
  };

  /**
   * 失效会话清理：取消在途请求、清空全部表单/检索状态并回登录页。
   */
  const invalidateSession = () => {
    cancelInFlight();
    resetFormState();
    setSession(null);
    notifySessionExpired();
    router.replace('/login?next=%2Fmatch');
  };

  // 身份变化防护：其他标签页改写会话（storage 事件）或本页重新聚焦时复核当前会话；
  // token 与 subject 都比对，任一变更或会话被清即取消在途请求并回退登录门，旧身份数据不可回显。
  useEffect(() => {
    if (!session) return;
    const locked = { token: session.token, subject: session.subject };
    const recheck = () => {
      const stored = getStoredSession();
      if (!stored || stored.token !== locked.token || stored.subject !== locked.subject) {
        invalidateSession();
      }
    };
    window.addEventListener('storage', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      window.removeEventListener('storage', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [session]);

  // 任意字段/草稿/增删编辑都清理上一次校验结果与提示，过期成功/错误不得残留；
  // 同时取消在途检索并清理其结果，旧响应不得回显
  const clearOutcome = () => {
    setResult(null);
    setStatusMessage('');
    cancelInFlight();
    setSearchState({ kind: 'idle' });
  };
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

  // 检索相关编辑：取消在途请求并忽略其旧响应，同时清理上一次检索结果
  const onSearchQuery = (v: string) => { cancelInFlight(); setSearchQuery(v); setSearchState({ kind: 'idle' }); };
  const onReactDomVersion = (v: string) => { cancelInFlight(); setReactDomVersion(v); setSearchState({ kind: 'idle' }); };

  const handleSearch = async () => {
    // requirements 未添加草稿拒绝提交，保留草稿
    if (requirementInput.trim()) {
      cancelInFlight();
      setSearchState({ kind: 'error', message: '请先添加当前需求' });
      return;
    }

    const contextCheck = buildProjectContext({ framework, frameworkVersion, echartsVersion, packageManager, requirements });
    if (!contextCheck.ok) {
      cancelInFlight();
      setResult(contextCheck);
      setSearchState({ kind: 'error', message: '项目上下文未通过本地校验，请修正后重试' });
      return;
    }

    // 提交前复核当前会话：与当前 React 状态的 token/subject 比对，失效则清理且不发请求
    const current = getStoredSession();
    if (!current || current.token !== session?.token || current.subject !== session?.subject) {
      invalidateSession();
      return;
    }

    // 代次与控制器：本次请求之后任何编辑/退出/换身份/卸载都会让其结果失效
    cancelInFlight();
    const generation = requestGeneration.current;
    const controller = new AbortController();
    inFlight.current = controller;
    // 锁定本次身份快照（token + subject）：提交前与响应落地前复核
    searchIdentity.current = { token: current.token, subject: current.subject };
    setSearchState({ kind: 'loading' });

    try {
      const res = await searchCandidates({
        apiUrl: DEFAULT_API_ORIGIN,
        token: current.token,
        query: searchQuery,
        context: contextCheck.value,
        ...(reactDomVersion.trim() ? { reactDomVersion: reactDomVersion.trim() } : {}),
        signal: controller.signal,
      });

      // 迟到响应守卫：代次不符即忽略；会话已变必须清理，不能留下 loading 或旧身份数据
      if (generation !== requestGeneration.current) return;
      if (!isSessionStillCurrent()) { invalidateSession(); return; }

      if (!res.ok) {
        setSearchState({ kind: 'error', message: res.issues[0]?.message || '检索失败，请稍后重试' });
        return;
      }
      setSearchState(
        res.value.candidates.length === 0
          ? { kind: 'empty', response: res.value }
          : { kind: 'done', response: res.value },
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return; // 已取消：静默忽略
      if (generation !== requestGeneration.current) return;
      // 错误落地时同样复核：会话失效必须清理，不能留下 loading
      if (!isSessionStillCurrent()) { invalidateSession(); return; }
      setSearchState({ kind: 'error', message: '检索服务暂时不可用，请稍后重试' });
    } finally {
      if (generation === requestGeneration.current && inFlight.current === controller) {
        inFlight.current = null;
      }
    }
  };

  if (!session) {
    return null;
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
      <Suspense fallback={null}>
        <SearchQuerySync onQuery={onSearchQuery} />
      </Suspense>

      <div className="zn-page-header access-heading">
        <div className="zn-header-copy">
          <p className="eyebrow">06 / PROJECT INTELLIGENCE</p>
          <h1>项目上下文匹配</h1>
          <p className="lead">结合框架、版本与设计规则，在授权范围内定位可用组件资产。</p>
          <p className="lead">
            当前登录身份：<strong>{session.subject}</strong> · 渠道: <code>{session.channel}</code>
          </p>
        </div>
        <ZnCommandMotif motif={MOTIF} className="zn-motif" />
      </div>

      <div className="zn-notice" role="note">
        <ZnIcon name="shield" size={17} color="var(--zn-accent)" className="zn-notice-icon" />
        <span>
          <strong style={{ fontFamily: 'var(--zn-font-mono)', fontSize: 11, letterSpacing: '0.3px' }}>权限边界 / 本地项目保持私有</strong>
          {' — '}
          仅提交你填写的项目上下文与查询条件；平台不会读取或修改本地项目。
        </span>
        <span className="zn-badge zn-badge-accent" style={{ marginLeft: 'auto' }}>
          <ZnIcon name="lock-keyhole" size={13} color="var(--zn-accent)" />
          READ-ONLY QUERY
        </span>
      </div>

      <div className="match-banner" role="note">
        文本检索仅覆盖已发布元数据（组件、实现、导出名、包名、分类），不提供用途/视觉评分；检索结果不构成兼容性证明。
      </div>

      {/* 项目上下文登记 */}
      <section className="zn-card-raised" aria-label="项目上下文登记">
        <div className="zn-card-head">
          <div>
            <h2 className="zn-card-title">项目上下文登记</h2>
            <p className="zn-card-subtitle">版本使用精确 x.y.z，便于判断运行时兼容性。</p>
          </div>
          <span className="zn-badge zn-badge-success">
            <span className="zn-badge-dot" />
            {result?.ok ? '上下文有效' : '上下文待校验'}
          </span>
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
              <button type="button" className="filter-btn" onClick={addRequirement}><ZnIcon name="plus" size={15} color="var(--zn-muted)" />添加需求</button>
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
            {statusMessage && <span className="match-hint">{statusMessage}</span>}
          </div>
        </div>

        {result?.ok && (
          <div id="context-success" className="match-success" role="status" style={{ marginTop: 16 }}>
            <strong>本地校验通过</strong>
            <pre className="match-json">{JSON.stringify(result.value, null, 2)}</pre>
            <p className="match-note">以上仅为项目上下文形状校验结果；点击「搜索候选」才会发起检索请求。</p>
          </div>
        )}

        {result && !result.ok && (
          <div id="context-errors" className="match-errors" role="alert" style={{ marginTop: 16 }}>
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
      </section>

      {/* B3：文本检索（独立按钮，只有显式点击才 POST） */}
      <section className="zn-card-raised" aria-label="文本检索">
        <div className="zn-card-head">
          <div>
            <h2 className="zn-card-title">自然语言候选检索</h2>
            <p className="zn-card-subtitle">先按自然语言召回候选，再进行版本与权限判断。</p>
          </div>
          <button
            type="button"
            id="search-submit"
            className="filter-btn active"
            onClick={handleSearch}
            disabled={searchState.kind === 'loading'}
          >
            {searchState.kind === 'loading' ? '正在检索…' : '检索候选'}
          </button>
        </div>

        <div className="match-form">
          <div className="match-field">
            <label className="match-label" htmlFor="search-query-input">检索内容</label>
            <input
              id="search-query-input"
              className="match-control"
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQuery(e.target.value)}
              placeholder="例如 折线图 / 排行榜 / 占比"
            />
            <span className="match-hint">仅检索已发布元数据，不做文档全文或语义检索。</span>
          </div>

          <div className="match-field">
            <label className="match-label" htmlFor="react-dom-version-input">React DOM 版本（可选）</label>
            <input
              id="react-dom-version-input"
              className="match-control"
              type="text"
              value={reactDomVersion}
              onChange={(e) => onReactDomVersion(e.target.value)}
              placeholder="例如 19.3.1；留空表示不提供"
            />
            <span className="match-hint">须为精确语义化版本；不能由 React 版本推断，未提供则不发送。</span>
          </div>
        </div>

        {searchState.kind === 'loading' && <p id="search-loading" className="match-hint" style={{ marginTop: 12 }}>正在检索…</p>}

        {searchState.kind === 'empty' && (
          <div id="search-empty" className="match-success" role="status" style={{ marginTop: 16 }}>
            <strong>暂无候选</strong>
            <p className="match-note">
              没有匹配的已发布资产。
              {searchState.response.gaps.length > 0 && ` ${searchState.response.gaps.join('；')}`}
            </p>
          </div>
        )}

        {searchState.kind === 'error' && (
          <div id="search-error" className="match-errors" role="alert" style={{ marginTop: 16 }}>
            <strong>检索失败：</strong>
            <span>{searchState.message}</span>
          </div>
        )}

        {searchState.kind === 'done' && (
          <div style={{ marginTop: 16 }}>
            {searchState.response.gaps.length > 0 && (
              <p className="match-hint" style={{ marginBottom: 12 }}>{searchState.response.gaps.join('；')}</p>
            )}
            <CandidateResults response={searchState.response} />
          </div>
        )}
      </section>

      {/* 精确匹配区：A 组件标识精确查询 + B 设计规则解析引擎 */}
      <div className="zn-grid-2">
        <ComponentQuery
          session={session}
          apiUrl={DEFAULT_API_ORIGIN}
          onSessionExpired={invalidateSession}
        />
        <DesignIdMatch
          session={session}
          contextCheck={contextCheck}
          reactDomVersion={reactDomVersion}
          requirementDraft={requirementInput}
          apiUrl={DEFAULT_API_ORIGIN}
          onSessionExpired={invalidateSession}
        />
      </div>
    </main>
  );
}
