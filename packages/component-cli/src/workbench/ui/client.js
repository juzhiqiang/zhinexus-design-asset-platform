const $=id=>document.getElementById(id);
const token=location.hash.slice(1);
const drafts=new Map(),events=new Map();let catalog,current,publishing,frame,port,generation=0,validation=0,selection=0,zoom=1,selectedState='default',frozenView=false,snapshot;
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}
function error(message){$('error').textContent=String(message);$('error').hidden=false;$('notice').hidden=true;}
function clearError(){$('error').hidden=true;}
function notice(message){clearError();$('notice').textContent=message;$('notice').hidden=false;}
async function api(route,value={}){
 if(!token)throw new Error('会话已失效，请从终端显示的完整地址打开工作台。');
 const response=await fetch('/api/'+route,{method:'POST',headers:{'content-type':'application/json','x-juz-session':token},body:JSON.stringify(value)});
 const result=await response.json();if(!response.ok)throw new Error(result.error??'请求失败');return result;
}
const draft=()=>drafts.get(current?.id);
const displayed=()=>snapshot??current;
const example=()=>snapshot?.example??draft()?.value??{props:{},controls:[],states:[]};
const values=()=>({props:draft()?.value.props??{},data:draft()?.value.data});
const isReadonly=()=>catalog?.readOnly||frozenView;
function dirty(item=current){const d=drafts.get(item?.id);return !!d&&JSON.stringify(d.value)!==JSON.stringify(d.saved);}
function updateActions(){
 const p=catalog?.packages.find(p=>p.id===current?.packageId),unsaved=catalog?.variants.some(v=>v.packageId===current?.packageId&&dirty(v));
 $('save').disabled=!current||isReadonly()||!dirty()||draft()?.invalid;
 $('prepare').disabled=!current||catalog.readOnly||!!unsaved||draft()?.invalid;
 $('publish').disabled=!p?.prepared?.digest||p.prepared.changed!==false||!!unsaved||!publishing?.authenticated||catalog.readOnly;
 $('frozen').disabled=!p?.prepared?.digest||catalog.readOnly;
 $('candidate').textContent=catalog?.readOnly?'冻结产物 · 只读':unsaved?'有未保存的调试值':p?.prepared?.changed?'材料与当前草稿不同':p?.prepared?.digest?'冻结材料与已保存输入一致':'尚未准备冻结产物';
 $('artifact').textContent=p?.prepared?JSON.stringify(p.prepared,null,2):'尚未准备';
 $('return-dev').hidden=!frozenView;
 for(const id of ['login','refresh-account','api-origin'])$(id).disabled=!!catalog?.readOnly;
 renderCategory();
}
function renderDirectory(){
 const container=$('components');container.replaceChildren();
 const query=$('search').value.toLowerCase();const groups=new Map();
 for(const item of catalog.variants){if(![item.componentId,item.packageName,item.category??''].some(s=>s.toLowerCase().includes(query)))continue;const category=item.category??'未分配分类';if(!groups.has(category))groups.set(category,new Map());const components=groups.get(category);if(!components.has(item.componentId))components.set(item.componentId,[]);components.get(item.componentId).push(item);}
 $('count').textContent=String(new Set(catalog.variants.map(v=>v.componentId)).size);
 for(const[category,components]of groups){container.append(node('h3',category,'category-title'));for(const[id,items]of components){const button=node('button',undefined,'component-item');button.type='button';button.setAttribute('aria-current',String(current?.componentId===id));button.append(node('strong',id),node('small',items.map(v=>v.framework==='react'?'React':'Vue').join(' / ')+' · '+new Set(items.map(v=>v.packageName)).size+' 个包'));button.addEventListener('click',()=>select(items.find(v=>v.framework===current?.framework)??items[0]).catch(error));container.append(button);}}
 if(!groups.size)container.append(node('p','没有匹配的组件','hint'));
}
function sendValues(){if(port&&!isReadonly())port.postMessage({type:'values',values:values()});}
function renderEvents(){const log=$('event-log');log.replaceChildren();const list=events.get(current?.id)??[];if(!list.length)log.append(node('li','等待组件实际触发声明事件','hint'));for(const event of list){const entry=node('li');entry.append(node('span',event.name+' · '+event.time.slice(11,23)),node('code',JSON.stringify(event.payload)));log.append(entry);}}
function setSize(width,height){width=Math.max(160,Math.min(4096,Math.round(width)));height=Math.max(120,Math.min(4096,Math.round(height)));if(!Number.isFinite(width)||!Number.isFinite(height))return;$('width').value=String(width);$('height').value=String(height);$('viewport').style.width=width+'px';$('viewport').style.height=height+'px';$('size-readout').textContent=width+' × '+height+' px';setZoom(zoom);}
function setZoom(value){zoom=value;$('viewport').style.transform='scale('+zoom+')';$('scaled').style.width=Number($('width').value)*zoom+'px';$('scaled').style.height=Number($('height').value)*zoom+'px';}
function modeLabel(mode){return mode==='source'?'源码模式 · Vite 热更新':mode==='frozen'?'冻结产物 · 只读预览':'构建导出 · 刷新依赖构建产物';}
async function mount(url,mode){
 const activeGeneration=++generation;port?.close();port=undefined;frame?.remove();$('empty').hidden=true;
 const next=node('iframe');frame=next;next.title='组件预览';next.setAttribute('sandbox','allow-scripts');next.referrerPolicy='no-referrer';
 next.addEventListener('load',()=>{
  if(frame!==next||generation!==activeGeneration)return;
  port?.close();const channel=new MessageChannel();port=channel.port1;const activePort=port;
  $('preview-status').textContent='已挂载 · 等待就绪';
  let received=false;
  activePort.onmessage=event=>{
   if(port!==activePort||frame!==next||generation!==activeGeneration)return;
   const message=event.data;if(!message||typeof message!=='object')return;
   if(message.type==='status'&&['mounted','ready','error','limited'].includes(message.status)){
    received=true;if(message.status==='mounted'){sendValues();return;}
    $('preview-status').textContent=message.status==='ready'?'已就绪':message.status==='error'?'运行错误：'+String(message.message??'未知错误').slice(0,400):'受限：'+String(message.message??'消费者未接入调试桥');
    if(Array.isArray(message.checks))$('checks').textContent=message.checks.slice(0,30).filter(c=>c&&typeof c.name==='string'&&['passed','failed'].includes(c.status)).map(c=>c.name+': '+c.status).join(' · ');
   }else if(message.type==='event'&&typeof message.name==='string'&&displayed().api.events.some(e=>e.name===message.name)&&typeof message.time==='string'){
    const list=events.get(current.id)??[];list.unshift({name:message.name,payload:message.payload,time:message.time});events.set(current.id,list.slice(0,50));renderEvents();
   }
  };activePort.start();
  // The iframe has an opaque origin. Transfer only a dedicated port to this
  // exact WindowProxy; neither the control session nor platform tokens cross it.
  next.contentWindow.postMessage({type:'juz-connect'},'*',[channel.port2]);
  setTimeout(()=>{if(!received&&port===activePort){$('preview-status').textContent='受限：消费者未接入调试桥';$('bridge-note').textContent='保留自定义消费者。请参考指南添加 MessageChannel 桥接；当前只能直接交互和刷新预览。';}},4000);
 });
 $('viewport').insertBefore(next,$('resize'));next.src=url;$('mode').textContent=modeLabel(mode);
}
async function select(item){
 if(!item)return;const request=++selection;const id=item.id;current=item;frozenView=false;snapshot=undefined;validation++;clearError();$('notice').hidden=true;
 if(!drafts.has(id)){const example=item.example??{schemaVersion:1,adapter:'custom',props:{},controls:[],states:[]};drafts.set(id,{value:structuredClone(example),saved:structuredClone(example),digest:item.digest,invalid:false});}
 selectedState=draft().value.states.some(s=>s.id==='default')?'default':draft().value.states[0]?.id??'';
 $('package').textContent=item.packageName+' @ '+item.version;$('component-title').textContent=item.componentId;
 $('bridge-note').textContent=item.example?.adapter==='auto'?'参数与数据通过专用通道传入当前实现。':'自定义消费者：调试能力取决于其桥接实现，CLI 不猜测业务初始化。';
 $('api').textContent=JSON.stringify(item.api,null,2);$('docs').textContent=item.docs;
 for(const name of['react','vue']){const target=catalog.variants.find(v=>v.componentId===item.componentId&&v.framework===name);$(name).disabled=!target;$(name).setAttribute('aria-pressed',String(name===item.framework));$(name).onclick=()=>select(target).catch(error);}
 setSize(item.width,item.height);renderDirectory();renderEditors();renderEvents();renderCategory();updateActions();$('preview-status').textContent='正在启动所选实现…';
 const result=await api('select',{id});if(current?.id!==id||request!==selection)return;await mount(result.url,result.mode);
}
function renderEditors(){
 const activeExample=example();const controls=$('controls');controls.replaceChildren();
 const descriptors=[...activeExample.controls];
 for(const prop of displayed().api.props)if(!descriptors.some(c=>c.name===prop.name)&&prop.name!==activeExample.dataProp)descriptors.push({name:prop.name,kind:prop.type==='boolean'?'boolean':prop.type==='number'?'number':prop.type==='string'?'text':'json'});
 for(const control of descriptors){
  const row=node('label',undefined,'control-row');row.append(node('span',control.name));let input;
  if(control.kind==='enum'){input=node('select');for(const option of control.options??[])input.append(new Option(option,option));input.value=activeExample.props[control.name]??'';}
  else if(control.kind==='json'){input=node('textarea');input.rows=3;input.value=JSON.stringify(activeExample.props[control.name]??null,null,2);}
  else{input=node('input');input.type=control.kind==='boolean'?'checkbox':control.kind==='number'?'number':control.kind==='color'?'color':'text';if(input.type==='checkbox')input.checked=!!activeExample.props[control.name];else input.value=activeExample.props[control.name]??'';if(control.min!==undefined)input.min=control.min;if(control.max!==undefined)input.max=control.max;}
  input.setAttribute('aria-label',control.name);input.disabled=isReadonly();
  input.addEventListener(control.kind==='json'?'change':'input',async()=>{try{let value=input.type==='checkbox'?input.checked:control.kind==='number'?Number(input.value):control.kind==='json'?JSON.parse(input.value):input.value;if(control.kind==='number'&&(input.value.trim()===''||!Number.isFinite(value)))throw new Error('请输入有效数字');const next=structuredClone(draft().value);next.props[control.name]=value;await apply(next,false);}catch(e){draft().invalid=true;updateActions();error(e);}});
  row.append(input);controls.append(row);
 }
 $('props-json').value=JSON.stringify(activeExample.props,null,2);$('data').value=JSON.stringify(activeExample.data??null,null,2);
 $('states').replaceChildren(...activeExample.states.map(state=>new Option(state.label,state.id)));$('states').value=selectedState;$('states').disabled=!activeExample.states.length;
 for(const id of['props-json','data','apply-props','apply-data','reset'])$(id).disabled=isReadonly();
}
async function apply(value,rerender=true){
 const id=current.id,order=++validation;const validated=await api('validate',{id,value,digest:draft().digest});
 if(current.id!==id||order!==validation)return;
 draft().value=validated.value;draft().invalid=false;clearError();sendValues();if(rerender)renderEditors();else $('props-json').value=JSON.stringify(draft().value.props,null,2);updateActions();
}
function renderCategory(){
 const selected=displayed()?.category??'';$('category').replaceChildren(new Option('未分配分类',''));
 for(const category of publishing?.options?.categories??[])if(category.enabled)$('category').append(new Option(category.name,category.id));
 if(selected&&!Array.from($('category').options).some(o=>o.value===selected))$('category').append(new Option(selected+'（当前分类）',selected));$('category').value=selected;
 $('save-category').disabled=!current||isReadonly()||!publishing?.authenticated;$('category').disabled=!!isReadonly();
}
async function refreshCatalog(){catalog=await api('catalog');if(current){current=catalog.variants.find(v=>v.id===current.id)??catalog.variants[0];}renderDirectory();updateActions();}
async function refreshAccount(){if(catalog?.readOnly){$('account').textContent='冻结材料只读预览';return;}publishing=await api('publishing');$('api-origin').value=publishing.apiOrigin;$('account').textContent=publishing.authenticated?'已登录 · '+publishing.identity.subject+' · '+publishing.identity.roles.join(' / '):publishing.message;renderCategory();updateActions();}
async function pollJob(jobId){
 while(true){const job=await api('jobs',{id:jobId});$('progress').textContent=job.kind+' · '+job.status+'\n'+(job.logs??[]).join('\n');if(job.status==='succeeded'){notice(job.kind==='prepare'?'打包验证完成；冻结材料已准备':'发布作业完成');await refreshCatalog();return;}if(job.status==='failed'){await refreshCatalog();throw new Error(job.error??'作业失败');}await new Promise(resolve=>setTimeout(resolve,500));}
}
$('search').addEventListener('input',renderDirectory);
for(const name of['width','height'])$(name).addEventListener('input',()=>setSize(Number($('width').value),Number($('height').value)));
$('zoom').addEventListener('change',()=>setZoom(Number($('zoom').value)));
$('fit').onclick=()=>{setZoom(Math.min(1,Math.max(.1,Math.min(($('stage').clientWidth-64)/Number($('width').value),($('stage').clientHeight-64)/Number($('height').value)))));};
$('background').onchange=()=>{$('stage').className='stage '+$('background').value;};
let dragging;
$('resize').addEventListener('pointerdown',event=>{dragging={x:event.clientX,y:event.clientY,width:Number($('width').value),height:Number($('height').value)};$('resize').setPointerCapture(event.pointerId);event.preventDefault();});
$('resize').addEventListener('pointermove',event=>{if(dragging)setSize(dragging.width+(event.clientX-dragging.x)/zoom,dragging.height+(event.clientY-dragging.y)/zoom);});
$('resize').addEventListener('pointerup',()=>{dragging=undefined;});$('resize').addEventListener('pointercancel',()=>{dragging=undefined;});
$('resize').addEventListener('keydown',event=>{const shifts={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};if(shifts[event.key]){event.preventDefault();setSize(Number($('width').value)+shifts[event.key][0],Number($('height').value)+shifts[event.key][1]);}});
$('apply-data').onclick=async()=>{try{const next=structuredClone(draft().value);next.data=JSON.parse($('data').value);await apply(next);}catch(e){draft().invalid=true;updateActions();error('数据 JSON 无效：'+e);}};
$('apply-props').onclick=async()=>{try{const next=structuredClone(draft().value);next.props=JSON.parse($('props-json').value);await apply(next);}catch(e){draft().invalid=true;updateActions();error('Props JSON 无效：'+e);}};
$('states').onchange=async()=>{selectedState=$('states').value;const selected=example().states.find(s=>s.id===selectedState);if(!selected)return;if(isReadonly()){port?.postMessage({type:'state',id:selected.id});return;}const next=structuredClone(draft().value);next.props=structuredClone(selected.props);next.data=structuredClone(selected.data);await apply(next).catch(error);};
$('reset').onclick=()=>apply(structuredClone(draft().saved)).catch(error);
$('save').onclick=async()=>{try{
 const id=current.id,currentDraft=draft(),original=structuredClone(currentDraft.value),next=structuredClone(original);
 const state=next.states.find(s=>s.id===selectedState);if(state){state.props=structuredClone(next.props);state.data=structuredClone(next.data);}
 const result=await api('save',{id,value:next,digest:currentDraft.digest}),latest=drafts.get(id);
 if(latest){const unchanged=JSON.stringify(latest.value)===JSON.stringify(original)&&!latest.invalid;latest.saved=structuredClone(result.value);latest.digest=result.digest;if(unchanged)latest.value=structuredClone(result.value);if(current?.id===id&&unchanged)renderEditors();}
 await refreshCatalog();notice('示例已保存');
}catch(e){error(e);}};
$('clear-events').onclick=()=>{events.set(current.id,[]);renderEvents();};
$('refresh-account').onclick=()=>refreshAccount().catch(error);
$('login').onclick=async()=>{try{$('login').disabled=true;$('account').textContent='请在系统浏览器完成公司登录…';await api('login',{apiOrigin:$('api-origin').value});await refreshAccount();notice('平台登录完成');}catch(e){error(e);}finally{$('login').disabled=false;}};
$('save-category').onclick=async()=>{try{await api('category',{componentId:current.componentId,category:$('category').value});await refreshCatalog();renderCategory();notice('分类已保存；请重新准备冻结材料');}catch(e){error(e);}};
$('prepare').onclick=async()=>{try{$('prepare').disabled=true;const result=await api('prepare',{id:current.packageId});await pollJob(result.jobId);}catch(e){error(e);}finally{updateActions();}};
$('publish').onclick=()=>{const p=catalog.packages.find(p=>p.id===current.packageId);$('confirmation').textContent='目标 API：'+publishing.apiOrigin+'\n账号：'+publishing.identity.subject+'\n包：'+p.name+'@'+p.version+'\n实现与分类：\n'+JSON.stringify(p.prepared.variants,null,2)+'\n冻结摘要：'+p.prepared.digest+'\nTarball SHA-256：'+p.prepared.tarballSha256;$('confirm').dataset.digest=p.prepared.digest;$('confirm').dataset.packageId=p.id;$('confirm').showModal();};
$('confirm-publish').onclick=async()=>{const digest=$('confirm').dataset.digest,id=$('confirm').dataset.packageId;$('confirm').close();try{const result=await api('publish',{id,confirmDigest:digest});await pollJob(result.jobId);}catch(e){error(e);}};
$('frozen').onclick=async()=>{try{const result=await api('frozen',{id:current.packageId,variantId:current.componentId+'-'+current.framework});frozenView=true;snapshot={...result.snapshot,example:result.snapshot.example??{props:{},controls:[],states:[]}};selectedState=snapshot.example.states[0]?.id??'';$('api').textContent=JSON.stringify(snapshot.api,null,2);$('docs').textContent=snapshot.docs;await mount(result.url,'frozen');renderEditors();updateActions();}catch(e){error(e);}};
$('return-dev').onclick=()=>select(current).catch(error);
const refreshTimer=setInterval(()=>{if(catalog)void refreshCatalog().catch(()=>{});},2000);
addEventListener('pagehide',()=>{clearInterval(refreshTimer);port?.close();frame?.remove();},{once:true});
try{catalog=await api('catalog');renderDirectory();if(catalog.variants.length){const query=new URLSearchParams(location.search);const initial=catalog.variants.find(v=>(!query.get('package')||v.packageName===query.get('package'))&&(!query.get('framework')||v.framework===query.get('framework')));if(!initial&&(query.has('package')||query.has('framework')))throw new Error('请求的包或框架未登记');await select(initial??catalog.variants[0]);}else error('没有已登记的组件实现。');void refreshAccount().catch(error);}catch(e){error(e);}
