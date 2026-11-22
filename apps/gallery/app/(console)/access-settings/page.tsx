'use client';
import { useEffect,useState } from 'react';
import { ACCESS_CHECKS,validateAccessConfig,type AccessAction,type AccessSection,type AccessSettingsView,type OidcAccessConfig,type PreviewAccessConfig } from '@company/contracts';
import { companyLoginUrl,loadCompanySession,platformApiOrigin,saveSession } from '../../lib/auth';
import { accessSettings,startCandidateWebLogin } from '../../lib/access-settings-client';
import './settings.css';

const emptyOidc:OidcAccessConfig={issuer:'',audience:'',webClientId:'',cliClientId:'',webRedirectUri:'',cliRedirectUri:'',roleClaim:'',roleMapping:{reader:'',publisher:'',maintainer:''}};
const names:Record<string,string>={discovery:'身份服务元数据',secret:'密钥引用',webLogin:'网页登录',cliLogin:'CLI 登录',roles:'业务角色',revocation:'公司撤权',adminLogin:'管理员登录',dns:'DNS 解析',tls:'TLS 证书',routing:'入口路由',gateway:'网关与凭证过滤'};
const statuses={passed:'通过',failed:'未通过',pending:'待验证'};
export default function AccessSettingsPage(){
  const [view,setView]=useState<AccessSettingsView | null>(null),[section,setSection]=useState<AccessSection>('oidc');
  const [oidc,setOidc]=useState(emptyOidc),[preview,setPreview]=useState<PreviewAccessConfig>({mode:'ip-port',previewOrigin:''});
  const [dirtySections,setDirtySections]=useState({oidc:false,preview:false}),[busy,setBusy]=useState(true),[message,setMessage]=useState(''),[error,setError]=useState(''),[credential,setCredential]=useState('');
  const dirty=dirtySections[section],setDirty=(value:boolean)=>setDirtySections(old=>({...old,[section]:value}));
  const install=(next:AccessSettingsView,preserveOther=false)=>{setView(next);if(!preserveOther || section==='oidc')setOidc(next.sections.oidc.draft?.config ?? next.sections.oidc.active?.config ?? emptyOidc);if(!preserveOther || section==='preview')setPreview(next.sections.preview.draft?.config ?? next.sections.preview.active?.config ?? {mode:'ip-port',previewOrigin:''});if(preserveOther)setDirty(false);else setDirtySections({oidc:false,preview:false});};
  const reload=async()=>{setBusy(true);setError('');try{await loadCompanySession();install(await accessSettings());}catch(e){setError(e instanceof Error ? e.message : '接入服务暂时不可用。');}finally{setBusy(false);}};
  useEffect(()=>{void reload();},[]);
  const mutate=async(action:AccessAction,revision?:string)=>{
    if(!view)return;setBusy(true);setError('');setMessage('');
    try{
      const state=view.sections[section];
      const config=section==='oidc' ? oidc : preview;
      if(action==='draft' && !validateAccessConfig(section,config).ok)throw new Error('配置格式不正确，请检查 HTTPS 地址、客户端和回调。');
      const next=await accessSettings(section,action,action==='draft' ? {expectedGeneration:state.generation,expectedRevision:state.draft?.id ?? null,config} : {expectedGeneration:state.generation,revision:revision ?? state.draft?.id});
      install(next,true);setMessage(action==='draft' ? '草稿已保存，请运行检查。' : action==='validate' ? '检查已完成，请查看各项结果。' : action==='activate' ? '此版本已启用。' : '已恢复此前版本，并生成新的活动代数。');
    }catch(e){setError(e instanceof Error ? e.message : '操作失败。');}finally{setBusy(false);}
  };
  const state=view?.sections[section],draft=state?.draft;
  const required=section==='oidc' ? ['discovery','secret','webLogin','cliLogin','roles','adminLogin'] : ['dns','tls','routing','gateway'];
  const canActivate=!!draft && !dirty && required.every(key=>draft.checks[key as keyof typeof draft.checks]==='passed');
  const changeOidc=(key:keyof OidcAccessConfig,value:string)=>{setOidc(old=>{const next={...old,[key]:value};if(key==='secretRef' && !value)delete next.secretRef;return next;});setDirty(true);};
  const beginLogin=async(revision:string)=>{setBusy(true);setError('');try{window.location.assign(await startCandidateWebLogin(revision));}catch(e){setError(e instanceof Error ? e.message : '验证入口暂时不可用。');setBusy(false);}};
  return <main className="access-settings">
    <div className="access-heading"><div><p className="eyebrow">平台管理</p><h1>接入设置</h1><p className="lead">管理公司登录与预览入口。保存草稿，验证通过后启用。</p></div><div>{view && <a className="filter-btn" href={companyLoginUrl}>使用公司账号登录</a>}<button className="filter-btn" disabled={busy} onClick={()=>void reload()}>刷新配置</button></div></div>
    {error && <p role="alert" className="access-error">{error}</p>}{message && <p role="status" className="access-message">{message}</p>}
    {!view ? <section className="access-panel"><h2>{busy ? '正在读取配置…' : '管理员登录'}</h2><p>接入设置由部署登记的平台管理员维护。</p><a className="filter-btn active" href={companyLoginUrl}>使用公司账号登录</a><details><summary>使用已有接入凭证</summary><form onSubmit={e=>{e.preventDefault();if(saveSession(credential))void reload();else setError('凭证格式不正确。');}}><label>已有 OIDC 凭证<input type="password" value={credential} autoComplete="off" onChange={e=>setCredential(e.target.value)}/></label><button className="filter-btn" type="submit">凭证登录</button></form></details></section> : <>
      <div role="tablist" aria-label="接入配置分区" className="access-tabs">{(['oidc','preview'] as const).map(key=><button role="tab" aria-selected={section===key} key={key} className={section===key?'filter-btn active':'filter-btn'} onClick={()=>setSection(key)}>{key==='oidc'?'公司登录':'预览入口'}</button>)}</div>
      <div className="access-columns"><section className="access-panel" role="tabpanel"><div className="access-title"><h2>{section==='oidc'?'公司登录':'预览入口'}</h2><span className="access-badge">活动代数 {state?.generation}</span></div>
        <div className="access-active"><strong>{state?.active ? '已启用版本' : '尚未启用后台版本'}</strong><p>{state?.active?.id ?? '首次启用前沿用部署配置。'}</p>{section==='preview' && state?.active && <p>{state.gatewayGeneration===state.generation ? 'API 与网关已接受此版本。' : 'API 已启用，等待网关确认此版本。'}</p>}</div>
        <form onSubmit={e=>{e.preventDefault();void mutate('draft');}}><fieldset disabled={busy} className="access-fields">
          {section==='preview' ? <><label>隔离方式<select value={preview.mode} onChange={e=>{setPreview({...preview,mode:e.target.value as PreviewAccessConfig['mode']});setDirty(true);}}><option value="ip-port">同 IP 分 HTTPS 端口</option><option value="domain">独立预览域</option></select></label><label>预览地址<input value={preview.previewOrigin} placeholder="https://预览入口" onChange={e=>{setPreview({...preview,previewOrigin:e.target.value});setDirty(true);}}/></label><p className="access-hint">独立域检查至少两个已发布实现的主机。IP 入口需要独立端口、可信 IP SAN 证书和凭证过滤。</p></> : <>
            {([['issuer','issuer'],['audience','API audience'],['webClientId','网页客户端 ID'],['cliClientId','CLI 客户端 ID'],['webRedirectUri','网页回调'],['cliRedirectUri','CLI 回环回调'],['roleClaim','业务角色声明'],['secretRef','服务端密钥引用']] as const).map(([key,label])=><label key={key}>{label}<input value={oidc[key] ?? ''} placeholder={key==='webRedirectUri'?platformApiOrigin+'/v1/auth/oidc/callback':undefined} onChange={e=>changeOidc(key,e.target.value)}/></label>)}
            {(['reader','publisher','maintainer'] as const).map(role=><label key={role}>{role} 角色值<input value={oidc.roleMapping[role]} onChange={e=>{setOidc({...oidc,roleMapping:{...oidc.roleMapping,[role]:e.target.value}});setDirty(true);}}/></label>)}
            <label>附加 scope（空格分隔）<input value={oidc.scopes?.join(' ') ?? ''} onChange={e=>{setOidc({...oidc,scopes:e.target.value.split(/\s+/).filter(Boolean)});setDirty(true);}}/></label><p className="access-hint">密钥仅填写部署引用。实际 Web、CLI 登录和角色检查通过后可以启用；公司撤权证据按 G2 验收。</p>
          </>}
        </fieldset><div className="access-actions"><button className="filter-btn active" type="submit" disabled={busy}>保存草稿</button><button className="filter-btn" type="button" disabled={busy || !draft || dirty} onClick={()=>void mutate('validate')}>运行检查</button><button className="filter-btn" type="button" disabled={busy || !canActivate} onClick={()=>void mutate('activate')}>启用此版本</button></div></form>
        {section==='oidc' && draft && <details open><summary>实际登录验证</summary><p><button className="filter-btn" disabled={busy || dirty} onClick={()=>void beginLogin(draft.id)}>验证候选网页登录</button></p><p>在已设置管理员凭证环境的本机 CLI 中执行：</p><code className="access-command">component login --api-url {platformApiOrigin} --candidate {draft.id}</code></details>}
        {state?.active && <details><summary>与当前版本比较</summary><div className="access-comparison"><div><strong>当前版本</strong><pre>{JSON.stringify(state.active.config,null,2)}</pre></div><div><strong>编辑内容</strong><pre>{JSON.stringify(section==='oidc'?oidc:preview,null,2)}</pre></div></div></details>}
      </section><aside><section className="access-panel"><h2>验证结果</h2><p className="access-hint">{draft?.checkedAt ? '最近检查：'+new Date(draft.checkedAt).toLocaleString('zh-CN') : '保存草稿后运行检查。'}</p><ul className="access-checks">{ACCESS_CHECKS[section].map(key=><li key={key} data-testid={'check-'+key}><span>{names[key]}</span><span className={'access-check '+(draft?.checks[key] ?? 'pending')}>{statuses[draft?.checks[key] ?? 'pending']}</span></li>)}</ul></section><section className="access-panel"><h2>恢复此前版本</h2><p className="access-hint">恢复前重新检查入口；公司登录恢复需先验证管理员登录。</p>{state?.history.filter(r=>r.activated && r.id!==state.active?.id).map(r=><div className="access-history" key={r.id}><code>{r.id}</code><button className="filter-btn" disabled={busy} onClick={()=>void mutate('rollback',r.id)}>恢复此版本</button>{section==='oidc' && <><button className="filter-btn" disabled={busy} onClick={()=>void beginLogin(r.id)}>验证管理员登录</button><p>Web / CLI / 管理员：{statuses[r.checks.webLogin ?? 'pending']} / {statuses[r.checks.cliLogin ?? 'pending']} / {statuses[r.checks.adminLogin ?? 'pending']}</p><code className="access-command">component login --api-url {platformApiOrigin} --candidate {r.id}</code></>}</div>)}{!state?.history.some(r=>r.activated && r.id!==state.active?.id) && <p>暂无可恢复版本。</p>}</section></aside></div>
      <section className="access-panel" role="region" aria-label="变更审计"><h2>变更审计</h2>{view.audit.length ? <div className="access-audit"><table><thead><tr><th>时间</th><th>操作者</th><th>分区 / 操作</th><th>版本</th><th>结果</th></tr></thead><tbody>{view.audit.map((entry,i)=><tr key={i}><td>{new Date(entry.at).toLocaleString('zh-CN')}</td><td>{entry.actor}</td><td>{entry.section} / {entry.action}</td><td><code>{entry.revision}</code></td><td>{entry.result==='failed'?'未通过':'已记录'}</td></tr>)}</tbody></table></div> : <p>暂无变更记录。</p>}</section>
    </>}
  </main>;
}
