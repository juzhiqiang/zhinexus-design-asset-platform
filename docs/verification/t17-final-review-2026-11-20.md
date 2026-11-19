# T17 分支最终重点代码审查（2026-11-20）

本轮由 Codex 独立审查子任务执行。代码审查为只读；按控制方后续要求仅新增本记录，由控制方复读并提交。本子任务没有修改产品、测试、契约、版本或锁文件，没有 pack、stage、commit、push 或合并。

## 结论与范围

已完成下述范围的重点审查，确认的 **Critical 为 0、Important 为 0**。该结论不等于逐行复核全部验收支架，也不宣布 T17 全部验收完成。当前 0.0.22 的固定 20 正向 + 13 强制拒绝正式矩阵仍须自然完成、封存并由控制方独立评分；本记录不预填其结果。

- Git 范围：`5a172921..2da991612196d5c2856dea647b45603590ed3b90`，148 个文件、24388 行新增、22 行删除；同时只读检查当时待提交的 README、assessment、总计划、分工计划、T17 专项计划及 0.0.22 矩阵记录。该 HEAD 后的文档最终收口由控制方接续。
- 完整阅读主产品流程：`packages/component-cli/src/integration/{verify,repair,report,browser-environment}.ts` 与 `src/mcp/{server,transport}.ts`。重点核对身份/摘要/授权、原 apply/plan 守卫、全源快照续接、窄范围修复与原字节备份、句柄身份/链接/部分写入恢复、预算、取消/进程树、真实依赖、浏览器 origin 与环境/视觉、外部独占证据、SDK 自动错误脱敏。
- 阅读 `src/commands/integrate.ts` 的 verify/repair、参数与退出码处理，`src/{cli,index}.ts` 接线/公开导出，`integration/install.ts` 与 `apply.ts` 的本轮差异，以及共享 `integration-apply.ts` 无安装语义差异。核对 verification 契约的 context、spec、authorization、report 状态约束；未把 Schema 验证当成真实执行证明。
- 按需复核 `tests/integration/project-mcp.test.ts` 的真实 SDK 调用/取消与子进程断言、验证/修复相关回归及独立 host/blackbox 证据入口；没有声称逐行审查本范围所有新增测试。已读架构、平台、安全、测试发布和代码审查规则，以及本轮 T17 设计/专项计划。
- 复读 `docs/phase3/local-project-verification.md`、当前工程回归/黑盒/宿主记录、C0 当前补证和官方后补记录；将技术现状、历史过程缺口、独立矩阵和生产/业务验收分开判断。

## 关键核对结果

普通 verify 从原 plan/base 与 apply/afterHashes 形成守卫；内部 repair 仅替换本轮确认写入的生成路径，并持有完整私有源快照。修复开始前、每次写入前及每轮重验均检查源变化，报告已有源变动不启动修复。`verifyIntegrationInternal` 未从公共包根导出，CLI/MCP 的 JSON 输入也没有替代哈希入口。

MCP 精确注册四工具，verify 不声明只读；grant 仅来自可信启动配置，严格输入拒绝请求自报批准。原始脚本输出不会直接变成固定 issue 文案。stdio transport 在 SDK 自动错误的线协议出口统一处理已知环境凭据及 JSON 转义表示，保留请求关联标识。

本次执行 `git diff --exit-code f96af5ee59cfbd007ba4ff50aad3de60cebafb60..HEAD -- packages/component-cli/src packages/component-cli/package.json packages/contracts` 无差异；所审产品与公共契约未在 CLI 0.0.22 冻结后变更。实际 `Get-FileHash` 复核原架构 SHA-256 为 `E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723`，与只读基线一致。

## 实际浏览器边界探针

审查时考虑过：未显式设置 `serviceWorkers:block` 是否使新注册的 Service Worker 绕过既有 `context.route`。本次使用固定包装器、真实本机 Chromium，按产品相同的 context 路由及 window.fetch origin 守卫，启动两个本次拥有的 loopback HTTP server。允许 origin 的页面注册真实 `/sw.js`，由 worker 主动向另一个 origin 发出 `fetch(...,{mode:'no-cors'})`。该外发被 context 路由实际捕获并 abort，目标服务收到请求为 0；假设不成立，不列缺陷。

实际命令为 `./scripts/pnpm.ps1 -PnpmArgs @('exec','node','--input-type=module','-e',$probe)`，`$probe` 的执行主体如下。它只检验浏览器拦截机制，不冒充整条产品 verify、正式矩阵或新的业务验收，也不增加任何正式分母。

```javascript
import http from 'node:http';
import { chromium } from '@playwright/test';
let outHits=0; const routed=[];
const outside=http.createServer((req,res)=>{outHits++;res.setHeader('access-control-allow-origin','*');res.end('synthetic');});
await new Promise(r=>outside.listen(0,'127.0.0.1',r));
const external='http://127.0.0.1:'+outside.address().port+'/probe';
const host=http.createServer((req,res)=>{
  if(req.url==='/sw.js'){res.setHeader('content-type','text/javascript');res.end('self.addEventListener("install",()=>self.skipWaiting());self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));self.addEventListener("message",e=>e.waitUntil(fetch('+JSON.stringify(external)+',{mode:"no-cors"}).then(()=>e.source.postMessage("done"))));');}
  else {res.setHeader('content-type','text/html');res.end('<!doctype html><body><div id="ready">ready</div><script>window.done=false;navigator.serviceWorker.addEventListener("message",()=>window.done=true);navigator.serviceWorker.register("/sw.js").then(()=>navigator.serviceWorker.ready).then(r=>r.active.postMessage("go"));</script>');}
});
await new Promise(r=>host.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+host.address().port;
let browser;try {
  browser=await chromium.launch({headless:true});const context=await browser.newContext();
  await context.route('**/*',async route=>{const u=route.request().url();routed.push(u);if(new URL(u).origin!==origin)await route.abort();else await route.continue();});
  const page=await context.newPage();
  await page.addInitScript(({allowed})=>{const f=window.fetch.bind(window);window.fetch=(input,init)=>{const raw=typeof input==='string'||input instanceof URL?input.toString():input.url;const u=new URL(raw,location.href);if(!['http:','https:'].includes(u.protocol)||u.origin!==allowed)return Promise.reject(new TypeError('Blocked request'));return f(input,init);};},{allowed:origin});
  await page.goto(origin);await page.waitForTimeout(2000);
  console.log(JSON.stringify({outsideHits:outHits,routed:routed.map(u=>new URL(u).origin===origin?'allowed'+new URL(u).pathname:'OUTBOUND'),done:await page.evaluate(()=>window.done)}));
}finally {await browser?.close();await new Promise(r=>host.close(r));await new Promise(r=>outside.close(r));}
```

实际工具会话 stdout 原文为 `{"outsideHits":0,"routed":["allowed/","allowed/sw.js","OUTBOUND"],"done":false}`，自然 exit 0，外层 3.430748 秒。browser 和两个 HTTP server 由 `finally` 关闭。本次未另行落盘该临时探针的独立源文件/原始日志；证据为本次工具会话输出及本记录转录，不虚构原件路径或摘要。

## 已有回归的复读与未重复执行范围

本次重点代码审查没有重复整套 build/test/平台/浏览器或重新打包。实际阅读 [0.0.22 工程回归](t17-cli-0022-regressions-2026-11-20.md)，并复读其 `root-engineering-regression-reopen.json`、原 test/browser exit 结果及日志尾部。结果分别为根 Vitest 123 文件 2198/2198、浏览器 288/288、平台 35 文件 137/137；原日志与索引一致。T10 168/168、强制 build/typecheck 20/20（0 cached）、根 tsc 纠正后 exit 0 的完整执行及 16 份原日志逐项复读由控制方原记录负责，不在此伪称本审查重新执行。

工程复读索引原件位于 `D:/project/zhinexus-t17-acceptance-evidence/2026-11-20/full-test-0.0.22-mwo0kxpv-x9v1mxli/root-engineering-regression-reopen.json`。黑盒四完整配置共 49/49、17 receipts 与 336 份结果证据归档，以 [0.0.22 黑盒记录](t17-blackbox-0022-2026-11-20.md) 及其原始/控制方独立复读索引为据；本次阅读执行方 `final-original-archive-reopen.json` 的冻结身份、四链通过与 `failures=[],passed=true`，不将该阅读冒充再复制/再哈希全部 336 文件。

双框架正向和受控修复宿主、三个实例完整清理前字节捕获、独立全量字节审计和四张最终截图，已由本子任务先前完成并记录于 [0.0.22 宿主验收](t17-host-0022-2026-11-20.md)。该独立记录和控制方原字节复读的范围保留，未为本次终审再运行完整宿主。

## 当前交付与历史计划条目的区分

| 事项 | 本次可确认的现状 | 不得倒填的历史或尚未完成边界 |
| --- | --- | --- |
| C0 契约/依赖/SDK | 当前类型、Schema、精确依赖、实际导出/真实 stdio 行为与官方后补有独立记录 | 专项计划 C0 51/54/55/57 行混合了原 P0、预期 RED、原始探针顺序和空 stderr；后来的 GREEN/官方补读不证明过去已执行 |
| A1/A2/A3 产品 | 当前 verify、有限 recipe、CLI/MCP 授权/输出边界已实现；当前回归、宿主和真实进程支持这些现状 | A1 65–68、A2 78–81、A3 89–91 行中的原始 RED 编写/先失败顺序没有完整追溯，不能用当前结果追认 |
| B 正式独立矩阵 | 已有固定 20+13 定义与本轮执行；N10 独立诊断不进入正式分数 | 本记录不确认仍在进行的 33 格结果；控制方须收原 seal、完整日志及独立评分，未运行/失败不缩减分母 |
| D 冻结包进程验收 | 四完整配置自然 49/49，追加双输入脱敏 probe 单列；原件/副本复读有索引 | 不把历史非自然外层会话计入通过；不把结果证据选定副本称为全部临时消费者安装树字节归档 |
| C2 清理与归档 | 本子任务 host 三个 owned parent 已在完整字节归档后清除，owner 容器/卷为 0 | D 本轮八个精确根清理被自动审批 `blocked by policy` 在进程启动前拒绝，八根保留且不得换 API 重试；历史拒绝根也保留。因此不能总称临时目录已全部清理 |
| 业务与生产 | 本轮为用户授权 temporary/synthetic 技术工程，所有相关记录为 `productionAcceptance=false` | 两个历史真实业务试点、T11/T12、公司 OIDC 及生产独立预览域/G2 不因本轮通过而完成 |

表中行号指本次阅读的 `docs/superpowers/plans/2026-11-19-phase3-t17-completion.md` 版本；控制方后续增加状态表可能改变行号，条目文字和阶段名为主要定位依据。

## 非阻断限制与审查取舍

`git diff --check 5a172921..HEAD` 报告 `tests/acceptance/t17-host/consumer.ts:43` 的末尾空行，属于格式 Minor。本次首次检查也报告宿主文档末尾空行；控制方已在待提交文档中修正。冻结后未为格式问题改动产品或重打包。宿主最终截图顶部 h1 轻微裁切与独立基线一致，图表、坐标轴及 Tuesday=75 提示可读，已在宿主记录公开；不把像素一致夸大成全部视觉设计无缺陷。

本次不另评为缺陷的范围：可信调用方提供宿主且独立验收另核对真实 import/构建/资源来源，这是已批准设计边界；原生命令是授权的可信项目代码，源快照不是恶意脚本 OS 沙箱；已知模板 recipe 不是任意业务代码自动修复；临时工程不能代替历史业务和生产条件。以上均按显式设计/授权与范围限制保留，没有静默删除原计划要求。

没有发现需要因本次重点代码审查阻断当前产品交付的 Critical/Important。最终技术收口仍由控制方在正式矩阵、最后文档/索引和清理保留项全部如实登记后决定；本记录不授权合并、推送、发布或重试被拒清理。
