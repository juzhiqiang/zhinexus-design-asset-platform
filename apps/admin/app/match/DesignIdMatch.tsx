'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  DesignElementV1,
  MatchPlanV1,
  ProjectContext,
  ValidationIssue,
  ValidationResult,
} from '@company/contracts';
import { getStoredSession, type UserSession } from '../lib/auth';
import { requestMatchPlan } from '../lib/match-plan-client';
import { buildDesignForm } from './design-id-input';

/**
 * 二期 ID 规则匹配：`/match` 的设计 ID 配置输入与装配方案展示子组件。
 *
 * 边界（与 `2026-11-15-phase2-match-plan-http.md` B 范围一致）：
 * - 输入为**显式规则 JSON** + 逐行元素清单 + 可选绑定 JSON；本地先校验，未知字段与
 *   重复映射/实例在本地拒绝（只渲染安全字段路径），未知 designId 交服务端报缺口；
 * - **只有显式点击「生成装配方案」才 POST**；Bearer 取当前 session；
 * - 规则/元素/绑定/项目上下文任意改动、退出登录、身份切换、组件卸载均取消在途请求并
 *   清理旧结果；提交前复核 token/subject，响应落地复核身份与 inputDigest；
 * - 不使用图片识别或大模型，不把文本需求自动标为满足；不做三期代码安装；
 * - 不持久化配置、元素或响应；不回显服务端原始错误或 token。
 */

const DEFAULT_API_ORIGIN = process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000';

type PlanState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; plan: MatchPlanV1; digest: string }
  | { kind: 'error'; message: string };

type DesignIdMatchProps = {
  /** 当前会话（仅展示与 Bearer 用途；安全由服务端强制）。 */
  session: UserSession;
  /** 父级 memo 后的上下文本地校验结果：任意上下文字段变化都会换引用，从而取消在途请求。 */
  contextCheck: ValidationResult<ProjectContext>;
  reactDomVersion?: string;
  requirementDraft?: string;
  apiUrl?: string;
  /** 提交前或响应落地时发现会话失效：交由父级回退登录门并清理全部状态。 */
  onSessionExpired: () => void;
};

const monoFont = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

export function DesignIdMatch({ session, contextCheck, reactDomVersion, requirementDraft, apiUrl, onSessionExpired }: DesignIdMatchProps) {
  const [mappingText, setMappingText] = useState('');
  const [elements, setElements] = useState<DesignElementV1[]>([]);
  const [instanceInput, setInstanceInput] = useState('');
  const [designIdInput, setDesignIdInput] = useState('');
  const [bindingsText, setBindingsText] = useState('');

  const [inputIssues, setInputIssues] = useState<ValidationIssue[]>([]);
  const [planState, setPlanState] = useState<PlanState>({ kind: 'idle' });

  // 在途请求控制器与「请求代次」：任何编辑/失效/卸载都取消并忽略旧响应
  const inFlight = useRef<AbortController | null>(null);
  const requestGeneration = useRef(0);
  // 发起请求时锁定的身份快照（token + subject）：提交前与响应落地前复核
  const planIdentity = useRef<{ token: string; subject: string } | null>(null);

  /** 复核当前会话是否仍与锁定快照一致；不一致则取消并不回显。 */
  const isSessionStillCurrent = (): boolean => {
    const locked = planIdentity.current;
    if (!locked) return false;
    const stored = getStoredSession();
    return Boolean(stored && stored.token === locked.token && stored.subject === locked.subject);
  };

  /** 取消在途请求并使其结果失效（幂等）。 */
  const cancelInFlight = () => {
    requestGeneration.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
    planIdentity.current = null;
  };

  /** 清理本地诊断与上一次方案（不触碰会话）。 */
  const clearOutcome = () => {
    cancelInFlight();
    setInputIssues([]);
    setPlanState({ kind: 'idle' });
  };

  // 卸载清理：取消在途请求，组件卸载后迟到响应不得写入状态
  useEffect(() => {
    return () => {
      requestGeneration.current += 1;
      inFlight.current?.abort();
      inFlight.current = null;
      planIdentity.current = null;
    };
  }, []);

  // 项目上下文任意变化（框架/版本/ECharts/包管理器/需求增删）都取消在途请求并清理旧方案
  useEffect(() => {
    cancelInFlight();
    setInputIssues([]);
    setPlanState({ kind: 'idle' });
  }, [contextCheck, reactDomVersion, requirementDraft]);

  const onMappingText = (value: string) => {
    setMappingText(value);
    clearOutcome();
  };

  const onBindingsText = (value: string) => {
    setBindingsText(value);
    clearOutcome();
  };

  const addElement = () => {
    if (!instanceInput.trim() || !designIdInput.trim()) {
      cancelInFlight();
      setPlanState({ kind: 'idle' });
      setInputIssues([
        { code: 'INVALID_SCHEMA', path: '/elements', message: '实例 ID 与设计 ID 均不能为空白' },
      ]);
      return;
    }
    // ID 原样入列：不 trim、不转大小写、不切分（不透明字符串）
    setElements((prev) => [...prev, { instanceId: instanceInput, designId: designIdInput }]);
    setInstanceInput('');
    setDesignIdInput('');
    clearOutcome();
  };

  const removeElement = (index: number) => {
    setElements((prev) => prev.filter((_, i) => i !== index));
    clearOutcome();
  };

  const handleSubmit = async () => {
    if (instanceInput.trim() || designIdInput.trim() || requirementDraft?.trim()) {
      cancelInFlight();setInputIssues([]);setPlanState({kind:'error',message:'请先添加或清空未提交的元素和需求草稿'});return;
    }
    // 本地输入构造与校验：未知字段、重复映射/实例、JSON 语法都在此拦截，不发请求
    const built = buildDesignForm({ mappingText, elements, bindingsText });
    if (!built.ok) {
      cancelInFlight();
      setInputIssues(built.issues);
      setPlanState({ kind: 'idle' });
      return;
    }
    if (!contextCheck.ok) {
      cancelInFlight();
      setInputIssues([]);
      setPlanState({ kind: 'error', message: '项目上下文未通过本地校验，请修正后重试' });
      return;
    }

    // 提交前复核当前会话：与 React 状态的 token/subject 比对，失效则清理且不发请求
    const current = getStoredSession();
    if (!current || current.token !== session.token || current.subject !== session.subject) {
      onSessionExpired();
      return;
    }

    // 代次与控制器：本次请求之后任何编辑/失效/卸载都会让其结果失效
    cancelInFlight();
    const generation = requestGeneration.current;
    const controller = new AbortController();
    inFlight.current = controller;
    planIdentity.current = { token: current.token, subject: current.subject };
    setInputIssues([]);
    setPlanState({ kind: 'loading' });

    try {
      const outcome = await requestMatchPlan({
        apiUrl: apiUrl ?? DEFAULT_API_ORIGIN,
        token: current.token,
        design: built.design,
        context: contextCheck.value,
        ...(reactDomVersion?.trim() ? {reactDomVersion:reactDomVersion.trim()} : {}),
        bindings: built.bindings,
        signal: controller.signal,
      });

      // 迟到响应守卫：代次不符即忽略；会话已变必须清理，不能留下 loading 或旧身份数据
      if (generation !== requestGeneration.current) return;
      if (!isSessionStillCurrent()) {
        onSessionExpired();
        return;
      }

      if (!outcome.ok) {
        // 只有本地输入校验失败才渲染字段路径；其余一律固定文案
        if (outcome.reason === 'invalid-input') {
          setInputIssues(outcome.issues);
          setPlanState({ kind: 'idle' });
        } else {
          setPlanState({ kind: 'error', message: outcome.message });
        }
        return;
      }

      setPlanState({ kind: 'done', plan: outcome.value, digest: outcome.inputDigest });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return; // 已取消：静默忽略
      if (generation !== requestGeneration.current) return;
      // 错误落地时同样复核：会话失效必须清理，不能留下 loading
      if (!isSessionStillCurrent()) {
        onSessionExpired();
        return;
      }
      setPlanState({ kind: 'error', message: '装配方案服务暂时不可用，请稍后重试' });
    } finally {
      if (generation === requestGeneration.current && inFlight.current === controller) {
        inFlight.current = null;
      }
    }
  };

  const mappingBlank = mappingText.trim() === '';
  const plan = planState.kind === 'done' ? planState.plan : null;

  return (
    <section id="design-match" aria-label="设计 ID 规则匹配" style={{ marginTop: 32 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 20, color: 'var(--zn-text)' }}>设计 ID 规则匹配</h2>
      <div className="match-banner" role="note">
        依据显式配置的设计 ID 定位精确发布，不依赖文本相似度，也不依据截图或图片内容匹配；
        用户提交的配置不充当权限、就绪状态或兼容性证据。
      </div>

      <div className="match-form">
        <div className="match-field">
          <label className="match-label" htmlFor="design-mapping-input">设计规则 JSON（DesignIdMappingV1）</label>
          <textarea
            id="design-mapping-input"
            className="match-control"
            rows={8}
            value={mappingText}
            onChange={(e) => onMappingText(e.target.value)}
            placeholder={'{\n  "schemaVersion": 1,\n  "ruleSetId": "design-library",\n  "revision": "draft-1",\n  "entries": [\n    { "designId": "图表/Line", "framework": "react", "variantReleaseId": "<发布 ID>" }\n  ]\n}'}
            style={{ fontFamily: monoFont, fontSize: 12 }}
          />
          <span className="match-hint">
            ID 为不透明字符串，按原值精确比较：不切分、不去空格、不转大小写，也不按正则或路径解释。
          </span>
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="design-instance-input">元素清单（instanceId + designId）</label>
          <div className="match-requirement-add">
            <input
              id="design-instance-input"
              className="match-control"
              type="text"
              value={instanceInput}
              onChange={(e) => { setInstanceInput(e.target.value); clearOutcome(); }}
              placeholder="实例 ID，例如 node-1"
            />
            <input
              id="design-design-id-input"
              className="match-control"
              type="text"
              value={designIdInput}
              onChange={(e) => { setDesignIdInput(e.target.value); clearOutcome(); }}
              placeholder="设计 ID，例如 图表/Line"
            />
            <button type="button" className="filter-btn" onClick={addElement}>添加元素</button>
          </div>
          <div id="design-elements-list">
            {elements.map((element, index) => (
              <div key={`${index}-${element.instanceId}`} className="requirement-row design-element-row">
                <span className="requirement-text design-element-instance" style={{ wordBreak: 'break-all' }}>{element.instanceId}</span>
                <span className="requirement-text design-element-id" style={{ wordBreak: 'break-all' }}>{element.designId}</span>
                <button type="button" className="filter-btn" onClick={() => removeElement(index)}>删除</button>
              </div>
            ))}
          </div>
          <span className="match-hint">
            同一 designId 可被多个实例引用；instanceId 在一次输入内必须唯一。未知 designId 不会被本地拒绝，由服务端返回缺口。
          </span>
        </div>

        <div className="match-field">
          <label className="match-label" htmlFor="design-bindings-input">绑定 JSON（可选，ElementBindings[]）</label>
          <textarea
            id="design-bindings-input"
            className="match-control"
            rows={5}
            value={bindingsText}
            onChange={(e) => onBindingsText(e.target.value)}
            placeholder={'[\n  {\n    "instanceId": "node-1",\n    "props": [{ "name": "data", "source": "sales" }],\n    "events": [{ "name": "onPointClick", "handler": "showDetail" }],\n    "layout": "grid cell 1"\n  }\n]'}
            style={{ fontFamily: monoFont, fontSize: 12 }}
          />
          <span className="match-hint">
            可留空。绑定的实例必须存在于元素清单，字段名在单条绑定内唯一；引用与说明仅作为数据，不执行。
          </span>
        </div>

        <div className="match-actions">
          <button
            type="button"
            id="design-submit"
            className="filter-btn active"
            onClick={handleSubmit}
            disabled={planState.kind === 'loading'}
          >
            {planState.kind === 'loading' ? '正在生成方案…' : '生成装配方案'}
          </button>
          {planState.kind === 'loading' && <span id="design-loading" className="match-hint">正在生成方案…</span>}
        </div>
      </div>

      {mappingBlank && elements.length === 0 && (
        <div id="design-unconfigured" className="match-banner" role="note" style={{ marginTop: 16 }}>
          尚未配置设计规则或元素清单。完成配置后可生成装配方案；空配置不视为已完成匹配。
        </div>
      )}

      {inputIssues.length > 0 && (
        <div id="design-input-errors" className="match-errors" role="alert">
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

      {planState.kind === 'error' && (
        <div id="design-error" className="match-errors" role="alert">
          <strong>装配失败：</strong>
          <span>{planState.message}</span>
        </div>
      )}

      {plan && plan.elements.length === 0 && (
        <div id="design-empty" className="match-success" role="status">
          <strong>暂无装配方案</strong>
          <ul>
            {plan.gaps.map((gap, i) => (
              <li key={`${gap.code}-${i}`}>
                <code>{gap.code}</code> — {gap.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan && plan.elements.length > 0 && (
        <PlanView plan={plan} digest={planState.kind === 'done' ? planState.digest : ''} />
      )}
    </section>
  );
}

/** 方案展示：只呈现服务端返回的真实目标、证据、依赖与缺口，不编造链接或结论。 */
function PlanView({ plan, digest }: { plan: MatchPlanV1; digest: string }) {
  return (
    <div id="design-plan" className="match-success" role="status">
      <strong>装配方案（依据显式 ID 配置）</strong>
      <p className="match-note">
        规则集 <code>{plan.ruleSetId}</code> · 修订 <code>{plan.revision}</code> · 输入摘要{' '}
        <code id="design-plan-digest">{digest.slice(0, 12)}</code>
      </p>
      <p className="match-note">
        mapped 仅表示目标发布材料可映射，不等于可自动接入或完成业务验证；未提供的数据/事件/布局保留为缺口。
      </p>
      {plan.gaps.length > 0 && (
        <ul>
          {plan.gaps.map((gap, i) => (
            <li key={`${gap.code}-${i}`}>
              <code>{gap.code}</code> — {gap.message}
            </li>
          ))}
        </ul>
      )}
      <p className="match-note">精确依赖：</p>
      <div id="design-dependencies">
        {plan.exactDependencies.map((dependency) => (
          <span key={dependency.name} style={{ display: 'inline-block', marginRight: 12, wordBreak: 'break-all' }}>
            {dependency.name}@{dependency.version}
          </span>
        ))}
      </div>
      {plan.elements.map((element) => (
        <div key={element.instanceId} className="requirement-row plan-element" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="plan-element-instance" style={{ fontWeight: 600, wordBreak: 'break-all', minWidth: 0 }}>{element.instanceId}</span>
            <span className="plan-element-design-id" style={{ wordBreak: 'break-all', minWidth: 0 }}>{element.designId}</span>
            <span className="plan-element-status">{element.status}</span>
          </div>
          {element.target && (
            <div className="plan-target" style={{ fontSize: 13, wordBreak: 'break-all' }}>
              <div>
                {element.target.packageName}@{element.target.packageVersion} · {element.target.exportName} · {element.target.exportPath}
              </div>
              <div>
                兼容：{element.target.compatibility.status}
                {element.target.compatibility.recordIds.length > 0 && `（${element.target.compatibility.recordIds.join('、')}）`}
              </div>
              <div>证据：{element.target.evidence.map((evidence) => `${evidence.kind}:${evidence.path}`).join('，')}</div>
              <div>示例：{element.target.examples.map((example) => `${example.id} (${example.previewEntry})`).join('，')}</div>
              <div>包摘要：<code>{element.target.packageSha256}</code></div>
              <div>样式入口：<code>{element.target.styleExport}</code> · 就绪方法：<code>{element.target.readyMethod}</code></div>
              {element.target.notes.map((note,i)=><div key={i}>限制说明：{note}</div>)}
            </div>
          )}
          {element.status==='mapped' && <div style={{fontSize:13,overflowWrap:'anywhere'}}>
            <div>布局：{element.layout??'尚未声明'}</div>
            <div>参数：</div>
            {element.props.map(prop=><div key={prop.name}><code>{prop.name}</code> · {prop.type} · {prop.required?'必填':'可选'} · 数据引用：{prop.source??'未绑定'}</div>)}
            <div>事件：</div>
            {element.events.map(event=><div key={event.name}><code>{event.name}</code> · {event.payload} · 处理引用：{event.handler??'未绑定'}</div>)}
          </div>}
          {element.gaps.map((gap, i) => (
            <span className="plan-gap" key={`${gap.code}-${i}`} style={{ display: 'block', fontSize: 12, color: 'var(--zn-danger)' }}>
              <code>{gap.code}</code> — {gap.message}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
