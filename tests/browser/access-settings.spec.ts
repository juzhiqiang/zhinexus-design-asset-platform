import { expect,test } from '@playwright/test';
const revision='123e4567-e89b-42d3-a456-426614174000';
const initial={sections:{oidc:{generation:'0',history:[]},preview:{generation:'0',history:[]}},audit:[]};
test('administrator edits, saves and validates a preview draft with visible version and checks',async({page})=>{
  let view=structuredClone(initial) as any;
  await page.route('**/v1/auth/oidc/session',route=>route.fulfill({json:{authenticated:true,administrator:true,subject:'operator',roles:['reader']}}));
  await page.route('**/v1/access-settings**',async route=>{
    const request=route.request();
    if(request.method()==='GET'){await route.fulfill({json:view});return;}
    const body=request.postDataJSON();
    if(request.url().endsWith('/draft')){
      expect(body).toEqual({expectedGeneration:'0',expectedRevision:null,config:{mode:'ip-port',previewOrigin:'https://127.0.0.1:8443'}});
      view.sections.preview.draft={id:revision,config:body.config,checks:{},createdAt:'2026-11-22T00:00:00.000Z'};
      view.audit=[{section:'preview',action:'draft',revision,actor:'operator',at:'2026-11-22T00:00:00.000Z',result:'passed',generation:'0'}];
    }else if(request.url().endsWith('/validate')){
      view.sections.preview.draft.checks={dns:'passed',tls:'passed',routing:'passed',gateway:'passed'};
      view.sections.preview.draft.checkedAt='2026-11-22T00:01:00.000Z';
    }
    await route.fulfill({json:view});
  });
  await page.goto('http://127.0.0.1:5177/access-settings');
  await expect(page.getByRole('heading',{name:'接入与配置',exact:true})).toBeVisible();
  await page.getByRole('tab',{name:/预览入口/}).click();
  await page.getByLabel('隔离方式').selectOption('ip-port');
  await page.getByLabel('预览地址').fill('https://127.0.0.1:8443');
  await page.getByRole('button',{name:'保存草稿'}).click();
  await expect(page.getByRole('status')).toContainText('草稿已保存');
  await expect(page.getByRole('button',{name:'启用此版本'})).toBeDisabled();
  await page.getByRole('button',{name:'运行检查'}).click();
  await expect(page.getByTestId('check-tls')).toContainText('通过');
  await expect(page.getByRole('button',{name:'启用此版本'})).toBeEnabled();
  await page.getByLabel('预览地址').fill('https://127.0.0.1:8445');
  await expect(page.getByRole('button',{name:'启用此版本'})).toBeDisabled();
  await page.getByRole('tab',{name:/公司登录/}).click();
  await page.getByRole('tab',{name:/预览入口/}).click();
  await expect(page.getByRole('button',{name:'启用此版本'})).toBeDisabled();
  await expect(page.getByRole('region',{name:'变更审计'})).toContainText('operator');
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'test-results/access-settings-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/access-settings-mobile.png',fullPage:true});
});
test('ordinary users cannot see configuration and the console redirects unauthenticated visits to login',async({page})=>{
  await page.route('**/v1/auth/oidc/session',route=>route.fulfill({status:401,json:{code:'UNAUTHENTICATED'}}));
  await page.route('**/v1/access-settings',route=>route.fulfill({status:403,json:{code:'FORBIDDEN'}}));
  await page.goto('http://127.0.0.1:5177/access-settings');
  await expect(page).toHaveURL(/\/login\?next=%2Faccess-settings$/);
  await expect(page.getByRole('link',{name:'账号登录'})).toBeVisible();
  await expect(page.getByLabel('issuer')).toHaveCount(0);
  await page.goto('http://127.0.0.1:5177/upload');
  await expect(page).toHaveURL(/\/login\?next=%2Fupload$/);
  await expect(page.getByRole('link',{name:'账号登录'})).toBeVisible();
});
test('explicit administrators can enter candidate Web login and see historical CLI verification',async({page})=>{
  const token='header.'+Buffer.from(JSON.stringify({sub:'operator',roles:['reader']})).toString('base64url')+'.signature';
  const config={issuer:'https://id.example.com',audience:'api',webClientId:'web',cliClientId:'cli',webRedirectUri:'https://api.example.com/v1/auth/oidc/callback',cliRedirectUri:'http://127.0.0.1:43129/callback',roleClaim:'roles',roleMapping:{reader:'read',publisher:'publish',maintainer:'maintain'}};
  const historical='223e4567-e89b-42d3-a456-426614174000',current='323e4567-e89b-42d3-a456-426614174000';
  const row={id:revision,config,checks:{},createdAt:'2026-11-22T00:00:00.000Z'};
  await page.addInitScript(value=>localStorage.setItem('zhinexus_console_auth',JSON.stringify({token:value,subject:'operator',roles:['reader'],channel:'web'})),token);
  await page.route('**/v1/auth/oidc/session',route=>route.fulfill({status:401,json:{code:'UNAUTHENTICATED'}}));
  await page.route('**/v1/access-settings',route=>route.fulfill({json:{sections:{oidc:{generation:'2',active:{...row,id:current},draft:row,history:[{...row,id:historical,activated:true}]},preview:initial.sections.preview},audit:[]}}));
  await page.route('**/v1/auth/oidc/candidate-start',async route=>{
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe('Bearer '+token);
    await route.fulfill({json:{ticket:'a'.repeat(43)}});
  });
  await page.route('**/v1/auth/oidc/candidate?ticket=*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>公司验证入口</h1>'}));
  await page.goto('http://127.0.0.1:5177/access-settings');
  await expect(page.getByText('component login --api-url', {exact:false}).filter({hasText:historical})).toBeVisible();
  await page.getByRole('button',{name:'验证候选网页登录'}).click();
  await expect(page.getByRole('heading',{name:'公司验证入口'})).toBeVisible();
});

test('a company Cookie session takes precedence over a stale saved token for console uploads',async({page})=>{
  const stale='header.'+Buffer.from(JSON.stringify({sub:'old-user',roles:['publisher']})).toString('base64url')+'.signature';
  await page.addInitScript(value=>localStorage.setItem('zhinexus_console_auth',JSON.stringify({token:value,subject:'old-user',roles:['publisher'],channel:'web'})),stale);
  await page.route('**/v1/auth/oidc/session',route=>{
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({json:{authenticated:true,administrator:true,subject:'company-user',roles:['publisher']}});
  });
  await page.goto('http://127.0.0.1:5177/upload');
  await expect(page.getByRole('banner').getByText('company-user',{exact:true})).toBeVisible();
  await expect(page.getByRole('main').getByText('company-user',{exact:true})).toBeVisible();
  await expect(page.getByText('old-user',{exact:true})).toHaveCount(0);
});

test('manual job retries carry the explicit token without unrelated platform cookies',async({page,context})=>{
  await page.addInitScript(()=>localStorage.setItem('zhinexus_console_auth',JSON.stringify({token:'manual-job-token',subject:'operator',roles:['publisher'],channel:'web'})));
  await context.addCookies([{name:'platform-canary',value:'private-cookie',url:'http://127.0.0.1:3000'}]);
  await page.route('**/v1/auth/oidc/session',route=>route.fulfill({status:401,json:{code:'UNAUTHENTICATED'}}));
  const job={state:'RETRY_WAIT',stage:'ENSURE_PACKAGES',attempt:2,lastError:{code:'INFRA_UNAVAILABLE',message:'Synthetic unavailable',details:[],requestId:'synthetic'},missingArtifacts:[],pollAfterMs:1000};
  await page.route('**/v1/releases/job-cookie-test',route=>route.fulfill({json:job}));
  await page.route('**/v1/releases/job-cookie-test/retry',route=>route.fulfill({json:{jobId:'job-cookie-test',state:'PENDING'}}));
  await page.goto('http://127.0.0.1:5177/jobs/job-cookie-test');
  const requested=page.waitForRequest('**/v1/releases/job-cookie-test/retry');
  await page.getByRole('button',{name:'重试作业 (Retry Job)'}).click();
  const request=await requested;
  expect(request.headers().authorization).toBe('Bearer manual-job-token');
  expect(request.headers().cookie).toBeUndefined();
});
