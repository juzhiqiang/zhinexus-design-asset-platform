import { validateAccessSettingsView,validateOidcCandidateTicket,type AccessAction,type AccessSection,type AccessSettingsView } from '@company/contracts';
import { getStoredSession,platformApiOrigin } from './auth';
export async function accessSettings(section?:AccessSection,action?:AccessAction,body?:unknown):Promise<AccessSettingsView> {
  const token=getStoredSession()?.token;
  const response=await fetch(platformApiOrigin+'/v1/access-settings'+(section && action ? '/'+section+'/'+action : ''),{method:body ? 'POST':'GET',credentials:'include',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(25_000),headers:{'content-type':'application/json',...(token ? {authorization:'Bearer '+token} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  if(!response.ok)throw new Error(response.status===403 ? '仅平台管理员可以管理接入配置。' : response.status===401 ? '请使用公司账号登录。' : response.status===409 ? '配置版本已变化或验证尚未通过，请刷新后重试。' : response.status===400 ? '配置格式不正确，请检查填写内容。' : '接入服务暂时不可用，请稍后重试。');
  const parsed=validateAccessSettingsView(await response.json());
  if(!parsed.ok)throw new Error('接入服务返回了无效配置。');
  return parsed.value;
}
export async function startCandidateWebLogin(revision:string):Promise<string> {
  const token=getStoredSession()?.token;
  const response=await fetch(platformApiOrigin+'/v1/auth/oidc/candidate-start',{method:'POST',credentials:token==='__session__' ? 'include' : 'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'content-type':'application/json',...(token ? {authorization:'Bearer '+token} : {})},body:JSON.stringify({revision}),signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error('无法开始候选验证，请重新登录管理员账号。');
  const parsed=validateOidcCandidateTicket(await response.json());
  if (!parsed.ok) throw new Error('接入服务返回了无效的验证入口。');
  return platformApiOrigin+'/v1/auth/oidc/candidate?ticket='+parsed.value.ticket;
}
