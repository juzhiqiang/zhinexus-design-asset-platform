'use client';

import { useEffect, useRef, useState } from 'react';
import type { ComponentMatchQueryV1, ComponentMatchResponseV1, ValidationIssue } from '@company/contracts';
import { getStoredSession, type UserSession } from '../lib/auth';
import { buildComponentMatchQuery, requestComponentMatchWithOutcome } from '../lib/component-match-client';

/**
 * 二期 P1：`/match` 的组件标识精确查询表单（`GET /v1/matching/components`）。
 *
 * 边界（与 `docs/specs/2026-11-16-phase2-query-completion-design.md` 一致）：
 * - 字段：componentId / framework / packageVersion / 可选 packageName / frameworkVersion /
 *   echartsVersion；React 必须精确 reactDomVersion，Vue 隐藏且不发送该字段；
 * - **只有显式点击「查询组件」才 GET**，无 body，Bearer 取当前 session；
 * - 任意输入变化、退出登录、身份切换、组件卸载均取消在途请求并清空结果，
 *   迟到响应不得回显；提交前与响应落地前都复核 token/subject；
 * - 响应用公开运行时校验并核对 query 对齐；错误只用固定文案，不回显服务端原文或 token；
 * - 不持久化查询或响应；不自动回写设计规则；不做三期代码安装；
 * - 与原项目上下文本地校验、文本检索、设计 ID 规则匹配表单并存，互不影响。
 */

const DEFAULT_API_ORIGIN = process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000';

type QueryState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; response: ComponentMatchResponseV1 }
  | { kind: 'gap'; response: ComponentMatchResponseV1 }
  | { kind: 'error'; message: string };

type ComponentQueryProps = {
  /** 当前会话（仅展示与 Bearer 用途；安全由服务端强制）。 */
  session: UserSession;
  apiUrl?: string;
  /** 提交前或响应落地时发现会话失效：交由父级回退登录门并清理全部状态。 */
  onSessionExpired: () => void;
};

export function ComponentQuery({ session, apiUrl, onSessionExpired }: ComponentQueryProps) {
  const [componentId, setComponentId] = useState('');
  const [framework, setFramework] = useState<'vue' | 'react' | ''>('');
  const [packageVersion, setPackageVersion] = useState('');
  const [packageName, setPackageName] = useState('');
  const [frameworkVersion, setFrameworkVersion] = useState('');
  const [echartsVersion, setEchartsVersion] = useState('');
  const [reactDomVersion, setReactDomVersion] = useState('');

  const [inputIssues, setInputIssues] = useState<ValidationIssue[]>([]);
  const [queryState, setQueryState] = useState<QueryState>({ kind: 'idle' });

  // 在途请求控制器与「请求代次」：任何编辑/失效/卸载都取消并忽略旧响应
  const inFlight = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  // 发起请求时锁定的身份快照（token + subject）：提交前与响应落地前复核
  const queryIdentity = useRef<{ token: string; subject: string } | null>(null);

  /** 复核当前会话是否仍与锁定快照一致；不一致则取消并不回显。 */
  const isSessionStillCurrent = (): boolean => {
    const locked = queryIdentity.current;
    if (!locked) return false;
    const stored = getStoredSession();
    return Boolean(stored && stored.token === locked.token && stored.subject === locked.subject);
  };

  /** 取消在途请求并使其结果失效（幂等）。 */
  const cancelInFlight = () => {
    requestGeneration.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
    queryIdentity.current = null;
  };

  /** 清理本地诊断与上一次结果（不触碰会话）。 */
  const clearOutcome = () => {
    cancelInFlight();
    setInputIssues([]);
    setQueryState({ kind: 'idle' });
  };

  // 卸载清理：取消在途请求，组件卸载后迟到响应不得写入状态
  useEffect(() => {
    return () => {
      requestGeneration.current += 1;
      inFlight.current?.abort();
      inFlight.current = null;
      queryIdentity.current = null;
    };
  }, []);

  // 身份变化防护：其他标签页改写会话或本页重新聚焦时复核当前会话
  useEffect(() => {
    const locked = { token: session.token, subject: session.subject };
    const recheck = () => {
      const stored = getStoredSession();
      if (!stored || stored.token !== locked.token || stored.subject !== locked.subject) {
        cancelInFlight();
        setInputIssues([]);
        setQueryState({ kind: 'idle' });
        onSessionExpired();
      }
    };
    window.addEventListener('storage', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      window.removeEventListener('storage', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [session, onSessionExpired]);

  /**
   * 依据当前表单构造查询对象。
   *
   * **不 trim**：空白原样进入查询，由 `validateComponentMatchQuery` 拒绝并在本地呈现字段路径，
   * 而不是先 trim 成合法值发出去——那会让用户以为带空格的输入被接受了。
   * 可选字段只有在「键存在」时才写入；React 的 reactDomVersion 由框架切换控制显隐。
   */
  const buildQuery = (): ComponentMatchQueryV1 => buildComponentMatchQuery({
    componentId,
    framework,
    packageVersion,
    ...(packageName === '' ? {} : { packageName }),
    frameworkVersion,
    echartsVersion,
    ...(framework === 'react' ? { reactDomVersion } : {}),
  });

  const handleSubmit = async () => {
    cancelInFlight();
    setInputIssues([]);

    // 提交前复核当前会话：与 React 状态的 token/subject 比对，失效则清理且不发请求
    const current = getStoredSession();
    if (!current || current.token !== session.token || current.subject !== session.subject) {
      onSessionExpired();
      return;
    }

    // 代次与控制器：本次请求之后任何编辑/失效/卸载都会让其结果失效
    const generation = requestGeneration.current;
    const controller = new AbortController();
    inFlight.current = controller;
    queryIdentity.current = { token: current.token, subject: current.subject };
    setQueryState({ kind: 'loading' });

    try {
      const outcome = await requestComponentMatchWithOutcome(buildQuery(), {
        apiUrl: apiUrl ?? DEFAULT_API_ORIGIN,
        token: current.token,
        signal: controller.signal,
      });

      // 迟到响应守卫：代次不符即忽略；会话已变必须清理，不能留下 loading 或旧身份数据
      if (generation !== requestGeneration.current) return;
      if (!isSessionStillCurrent()) { onSessionExpired(); return; }

      if (!outcome.ok) {
        // 只有本地输入校验失败才渲染字段路径；其余一律固定文案
        if (outcome.reason === 'invalid-input') {
          setInputIssues(outcome.issues);
          setQueryState({ kind: 'idle' });
        } else {
          setQueryState({ kind: 'error', message: outcome.message });
        }
        return;
      }

      setQueryState(
        outcome.value.status === 'matched'
          ? { kind: 'done', response: outcome.value }
          : { kind: 'gap', response: outcome.value },
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return; // 已取消：静默忽略
      if (generation !== requestGeneration.current) return;
      // 错误落地时同样复核：会话失效必须清理，不能留下 loading
      if (!isSessionStillCurrent()) { onSessionExpired(); return; }
      setQueryState({ kind: 'error', message: '组件查询服务暂时不可用，请稍后重试' });
    } finally {
      if (generation === requestGeneration.current && inFlight.current === controller) {
        inFlight.current = null;
      }
    }
  };

  const onComponentId = (value: string) => { setComponentId(value); clearOutcome(); };
  const onFramework = (value: string) => {
    setFramework(value === 'vue' || value === 'react' ? value : '');
    // 框架切换会改变必填/禁止的 reactDomVersion 语义：一律清空并取消在途请求
    setReactDomVersion('');
    clearOutcome();
  };
  const onPackageVersion = (value: string) => { setPackageVersion(value); clearOutcome(); };
  const onPackageName = (value: string) => { setPackageName(value); clearOutcome(); };
  const onFrameworkVersion = (value: string) => { setFrameworkVersion(value); clearOutcome(); };
  const onEchartsVersion = (value: string) => { setEchartsVersion(value); clearOutcome(); };
  const onReactDomVersion = (value: string) => { setReactDomVersion(value); clearOutcome(); };

  const loading = queryState.kind === 'loading';

  return (
    <section id="component-query" aria-label="组件标识精确查询" style={{ marginTop: 32 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 20, color: '#0f172a' }}>组件标识精确查询</h2>
      <div className="match-banner" role="note">
        按平台组件标识与精确版本直接查询已发布实现：只读检索，不创建发布、映射或索引；
        matched 仅表示目标材料可读，不代表业务绑定、兼容性或自动接入已通过。
      </div>

      <div className="match-form">
        <div className="match-field">
          <label className="match-label" htmlFor="cq-component-id">组件 ID（componentId）</label>
          <input
            id="cq-component-id"
            className="match-control"
            type="text"
            value={componentId}
            onChange={(e) => onComponentId(e.target.value)}
            placeholder="例如 line"
          />
          <span className="match-hint">平台逻辑组件 ID，原值精确比较：不去空格、不转大小写。</span>
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="cq-framework">目标框架（framework）</label>
          <select
            id="cq-framework"
            className="match-control"
            value={framework}
            onChange={(e) => onFramework(e.target.value)}
          >
            <option value="">请选择框架</option>
            <option value="vue">Vue 3</option>
            <option value="react">React 19</option>
          </select>
          <span className="match-hint">两个实现分别定位与校验，一个实现通过不代表另一个通过。</span>
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="cq-package-version">包版本（packageVersion，精确 x.y.z）</label>
          <input
            id="cq-package-version"
            className="match-control"
            type="text"
            value={packageVersion}
            onChange={(e) => onPackageVersion(e.target.value)}
            placeholder="例如 0.0.12"
          />
          <span className="match-hint">必须是目标框架包的精确版本，拒绝 latest 与范围号。</span>
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="cq-package-name">包名（packageName，可选）</label>
          <input
            id="cq-package-name"
            className="match-control"
            type="text"
            value={packageName}
            onChange={(e) => onPackageName(e.target.value)}
            placeholder="例如 @company/charts-vue；留空表示不指定"
          />
          <span className="match-hint">同一版本跨多个包时留空会返回歧义冲突，指定后可唯一命中。</span>
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="cq-framework-version">框架版本（frameworkVersion，精确 x.y.z）</label>
          <input
            id="cq-framework-version"
            className="match-control"
            type="text"
            value={frameworkVersion}
            onChange={(e) => onFrameworkVersion(e.target.value)}
            placeholder="例如 3.5.45 / 19.3.1"
          />
          <span className="match-hint">使用侧宿主的框架精确版本，不猜测默认值。</span>
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="cq-echarts-version">ECharts 版本（echartsVersion，精确 x.y.z）</label>
          <input
            id="cq-echarts-version"
            className="match-control"
            type="text"
            value={echartsVersion}
            onChange={(e) => onEchartsVersion(e.target.value)}
            placeholder="例如 6.1.0"
          />
          <span className="match-hint">使用侧宿主的 ECharts 精确版本。</span>
        </div>

        {framework === 'react' && (
          <div className="match-field">
            <label className="match-label" htmlFor="cq-react-dom-version">React DOM 版本（reactDomVersion，精确 x.y.z）</label>
            <input
              id="cq-react-dom-version"
              className="match-control"
              type="text"
              value={reactDomVersion}
              onChange={(e) => onReactDomVersion(e.target.value)}
              placeholder="例如 19.3.1"
            />
            <span className="match-hint">React 必填，不能由 React 版本推断；Vue 不提供该字段。</span>
          </div>
        )}

        <div className="match-actions">
          <button
            type="button"
            id="cq-submit"
            className="filter-btn active"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? '正在查询…' : '查询组件'}
          </button>
          {loading && <span id="cq-loading" className="match-hint">正在查询…</span>}
        </div>
      </div>

      {inputIssues.length > 0 && (
        <div id="cq-input-errors" className="match-errors" role="alert">
          <strong>输入未通过本地校验：</strong>
          <ul>
            {inputIssues.map((issue, i) => (
              <li key={`${issue.path}-${i}`}>
                <code>{issue.path || '/'}</code> — {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {queryState.kind === 'error' && (
        <div id="cq-error" className="match-errors" role="alert">
          <strong>查询失败：</strong>
          <span>{queryState.message}</span>
        </div>
      )}

      {queryState.kind === 'gap' && (
        <div id="cq-gap" className="match-success" role="status" style={{ marginTop: 16 }}>
          <strong>未定位到可用目标</strong>
          <ul>
            {queryState.response.gaps.map((gap, i) => (
              <li key={`${gap.code}-${i}`}>
                <code>{gap.code}</code> — {gap.message}
              </li>
            ))}
          </ul>
          <p className="match-note">不可用与不存在的响应形状一致，不会泄露其他目标详情。</p>
        </div>
      )}

      {queryState.kind === 'done' && <QueryResult response={queryState.response} />}
    </section>
  );
}

/** 结果展示：只呈现服务端返回的真实目标、API、依赖与缺口，不编造链接或结论。 */
function QueryResult({ response }: { response: ComponentMatchResponseV1 }) {
  const target = response.target!;
  return (
    <div id="cq-result" className="match-success" role="status" style={{ marginTop: 16 }}>
      <strong>查询结果：<span id="cq-result-status">{response.status}</span></strong>
      <p className="match-note">
        查询条件：<code>{response.query.componentId}</code> · <code>{response.query.framework}</code> ·{' '}
        <code>{response.query.packageVersion}</code>
        {response.query.packageName ? ` · ${response.query.packageName}` : ''}
      </p>

      <div id="cq-result-target" className="plan-target" style={{ fontSize: 13, wordBreak: 'break-all' }}>
        <div>
          {target.packageName}@{target.packageVersion} · {target.exportName} · {target.exportPath}
        </div>
        <div>变体：<code>{target.variantId}</code> · 发布 ID：<code>{target.variantReleaseId}</code></div>
        <div>包摘要：<code>{target.packageSha256}</code></div>
        <div>样式入口：<code>{target.styleExport}</code> · 就绪方法：<code>{target.readyMethod}</code></div>
        <div>
          证据：{target.evidence.map((evidence) => `${evidence.kind}:${evidence.path}`).join('，')}
        </div>
        <div>示例：{target.examples.map((example) => `${example.id} (${example.previewEntry})`).join('，')}</div>
        <div>
          兼容：{target.compatibility.status}
          {target.compatibility.recordIds.length > 0 && `（${target.compatibility.recordIds.join('、')}）`}
        </div>
        {target.notes.map((note, i) => <div key={i}>限制说明：{note}</div>)}
      </div>

      <div id="cq-result-api" style={{ fontSize: 13, marginTop: 8 }}>
        <div>API：<code>{response.api!.exportName}</code> · {response.api!.exportPath}</div>
        <div>
          参数：{response.api!.props.map((prop) => `${prop.name}${prop.required ? '（必填）' : ''}`).join('，') || '无'}
        </div>
        <div>
          事件：{response.api!.events.map((event) => event.name).join('，') || '无'}
        </div>
      </div>

      <p className="match-note">精确依赖：</p>
      <div id="cq-result-dependencies">
        {response.exactDependencies.map((dependency) => (
          <span key={dependency.name} style={{ display: 'inline-block', marginRight: 12, wordBreak: 'break-all' }}>
            {dependency.name}@{dependency.version}
          </span>
        ))}
      </div>

      {response.gaps.length > 0 && (
        <>
          <p className="match-note">缺口：</p>
          <div id="cq-result-gaps">
            {response.gaps.map((gap, i) => (
              <span className="plan-gap" key={`${gap.code}-${i}`} style={{ display: 'block', fontSize: 12, color: '#991b1b' }}>
                <code>{gap.code}</code> — {gap.message}
              </span>
            ))}
          </div>
        </>
      )}

      <p className="match-note">
        matched 仅表示目标发布材料可读；Ready 不代表兼容性已确认，业务 props、事件 handler 与布局需使用侧自行提供。
      </p>
    </div>
  );
}
