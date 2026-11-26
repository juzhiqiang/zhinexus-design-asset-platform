# juz 本地工作台实操指南

适用于 juz-cli 0.1.2。本分支平台根版本 0.2.5。所有组件构建、消费者安装和 Chromium 截图都在开发者电脑运行。

## 安装与第一次启动

在本仓库生成本地分发包（尚未上传 npm）：

```powershell
pnpm --filter @company/component-cli pack:juz
npm install -g .\packages\component-cli\.release\juz-cli-0.1.2.tgz
juz --version

# 从空项目开始
juz create my-card --framework react
cd my-card
pnpm install
juz dev
```

只开发 Vue 时改为 `--framework vue`；需要两个独立发布包时再用 `--framework all`，避免一开始引入不需要的第二套工程。

需要 Node >=24.6.0、pnpm 12.18.0。仓库本轮验证使用 Node 26.13.0，其他版本的依赖兼容范围以项目实际 engines 为准。CLI 正常安装自动准备匹配的 Playwright Chromium，跳过安装脚本后的补装方法见[发布指南](project-publishing.md#开发测试安装)。

默认浏览器地址为 127.0.0.1:1111。CLI 输出包含本次会话片段的完整 URL；请使用这个 URL。端口占用时明确报错，自行用 `juz dev --port 1112` 选择其他端口。`--no-open` 禁止自动打开浏览器。Ctrl+C 关闭工作台及本次启动的预览、watcher 和构建子进程。

`react` / `vue` 生成一个可发布的最小组件包；`all` 生成私有项目根、React/Vue 两个独立可发布子包及 `component.workspace.json`。模板自带真实组件、类型检查、构建、API、文档、消费者、保存示例及就绪协议，不依赖 ECharts，不要求登录或先选分类。

## 像普通组件一样开发

新模板的业务源码使用常规框架写法：React 为 `src/Demo.tsx`，Vue 为 `src/Demo.vue`（`<script setup lang="ts">`）。入口文件只负责导出。使用普通 Props、Callbacks / Emits、Hook 或 Vue 生命周期即可，不需要继承平台基类，也不在组件内维护消息通道。

单框架包的主要材料如下；双框架项目将这套材料分别放在 `packages/react` 和 `packages/vue`：

| 文件 | 何时编辑 |
| --- | --- |
| `src/Demo.tsx` / `src/Demo.vue` | 日常编写组件，保存后工作台热更新 |
| `src/index.tsx` / `src/index.ts` | 增加或调整包导出 |
| `playground.json` | 默认 Props、数据、控件和状态；通常在工作台调好后保存 |
| `api/demo.json`、`docs/demo.md` | 增加公开参数、事件或准备发布说明时 |
| `vite.config.js`、`tsconfig.json`、`package.json` | 常规编译、类型和依赖配置 |
| `component.config.json` | 接入入口、实现或预览配置变化时 |
| `.juz/` | CLI 创建的消费者桥接与 Vue 声明整理工具，通常不用手改，需纳入版本管理 |

`.juz/consumer` 不安装依赖、不登记源码 alias，也不另存一份示例数据；开发和冻结验证时由 CLI 在临时目录注入包内已保存的 `playground.json`。新模板 npm 包包含 dist、api、docs；运行入口不导入元数据。旧项目原有的 `consumer/`、自定义路径及挂载适配器继续生效，不自动迁移。

开发运行 `juz dev`；在对应组件包中运行 `pnpm typecheck`、`pnpm build`。模板的 `pnpm dev` 保留为构建导出监听，供 `juz dev --script` 使用。Vue 使用仓库已验证的 `vue-tsc 3.3.14` + TypeScript `6.0.3` 处理 SFC 与声明；React 使用 TypeScript `7.0.2`。Vue 发布声明会整理已发射的相对本地文件/目录引用，以支持 NodeNext 消费；自定义类型路径别名仍需项目自己的声明打包配置。

组件使用独立 CSS 时，按普通组件库约定导出 CSS 并在消费者中引入；CLI 不会自动猜测样式入口。默认模板使用内联样式。需要 Provider、插槽或自定义样式入口时可编辑 `.juz/consumer/main.js`，已有自定义消费者继续保留。

项目总材料仍比只绑定单一平台协议的最小模板多：这里还承担独立 npm 包、双框架、声明和冻结消费者验证。额外材料属于调试或发布层；普通组件逻辑仍按 React / Vue 惯例编写。只有组件需要特定 Provider、插槽或业务初始化时，才维护自定义消费者。

## 接入已有项目

```powershell
juz init --package packages/button --component button --export Button --framework react --source packages/button/src/index.tsx
juz dev

# 保留之前直接运行项目 dev 脚本的方式
juz dev --script --framework react
```

`init` 只补充缺失的 API、文档和消费者材料，不覆盖现有源码或非空自定义消费者目录；已存在配置时报 `CONFIG_EXISTS`，请直接编辑该配置。目标必须是有 name/version/build 脚本的非私有组件包。私有业务根请用 `--package` 选择公开组件子包。`--source` 是**显式**源码入口；CLI 不推断 Provider、插槽或业务初始化。

配置中每条路径始终相对启动时的项目根，而不是相对配置文件所在目录。多包索引示例：

```json
{
  "schemaVersion": 1,
  "packages": [
    "packages/react/component.config.json",
    "packages/vue/component.config.json"
  ]
}
```

配置按真实路径去重。同一组件 ID + 框架不能重复登记；同一逻辑组件可来自不同 npm 包，但分类必须一致。也可以用 `--config <项目内配置路径>` 显式选择单个配置。

`juz dev --package my-card-vue --framework vue` 指定首次打开的包与框架；`--package packages/vue` 或 `--package packages/vue/component.config.json` 使用相同的选择规则。错误的包或不匹配框架会在监听端口前拒绝。`juz package` 和 `juz publish` 在多包项目中必须使用 `--package <包名、包目录或配置路径>`，或者在终端交互选择。工作台使用当前实现所属的包。

## 调试、保存与三种模式

左侧按分类浏览或搜索，框架按钮只启用真实登记的实现。中间画布可以输入宽高或拖动右下角；宽高改变真实组件容器，缩放和“适应”只改变观看比例。右侧调参数、编辑 JSON 数据、切换状态、查看真实事件、API、文档及发布作业。

- **源码模式**：登记了 `sourceEntry`，使用项目自己的 Vite、框架运行时及编译插件，读取包目录下的 Vite 配置，复用 resolve/alias、插件、CSS、define、JSON、assetsInclude 及转换设置，支持实际源码热更新。先安装所选项目的依赖。源码 alias 只存在于本次开发进程中；修改 Vite 配置后重新选择实现或重启工作台。CLI 仍强制自己的 root/base、env 关闭、回环网络与文件访问限制，不照搬项目 dev server 的 host、cors、代理或任意目录服务配置。
- **构建导出模式**：旧配置没有源码入口，读取实际 package exports，启动已配置的框架开发脚本，等待首次导出生成。依赖构建输出变化可能需要刷新或重新选择；界面明确标注该模式。
- **冻结产物**：只使用已经校验的 Bundle，参数只读，可以查看已冻结状态示例；不构建、不重新安装、不重新打包。旧 Bundle 没有工作台描述时仍可显示原静态预览。

调试草稿按具体实现分别保留，切换 React/Vue 和 HMR 后恢复。关闭网页前请“保存示例”；未保存值不会自动写入项目，工作台重启后读取保存文件。非法输入显示错误并保留上次有效预览。重置恢复最近保存的示例。保存会同时更新所选示例状态；与外部编辑器冲突时拒绝覆盖，重新载入确认后再保存。

每个实现通过 `playground` 指定独立 JSON 文件，示例格式：

```json
{
  "schemaVersion": 1,
  "adapter": "auto",
  "props": { "label": "收入", "value": 42, "enabled": true, "color": "#A3D2FF" },
  "data": [12, 24, 36],
  "dataProp": "data",
  "controls": [
    { "name": "label", "kind": "text" },
    { "name": "value", "kind": "number", "min": 0 },
    { "name": "enabled", "kind": "boolean" },
    { "name": "color", "kind": "color" }
  ],
  "states": [
    { "id": "default", "label": "默认", "props": { "label": "收入", "value": 42, "enabled": true, "color": "#A3D2FF" }, "data": [12, 24, 36] }
  ]
}
```

控件支持 `text/number/boolean/enum/color/json`。枚举使用字符串数组 `options`；颜色为六位十六进制；复杂 Props 用 JSON。预览和保存都会校验控件约束，以及 API 的 string/number/boolean、简单数组（如 number[]、Array<string>）类型。dataProp 绑定后的实际值及每个保存状态也必须通过，不能用数据覆盖绕过校验。其他复杂 TypeScript 类型只作声明，不执行类型字符串或用户代码。状态 ID 必须与 `readiness.states` 所要求的状态匹配。

## 分类、打包和发布

新模板的参数控件从 API 的 schema/editor 自动生成，playground.controls 默认为空。上文显式 controls 示例为旧配置/手工覆盖方式，不能放宽 API 约束。嵌套对象、数组、枚举、默认值注解、数字颜色以及低代码/机器接入的职责说明见[组件多场景接入指南](component-inputs.md)。

本地未分配分类时仍可开发。冻结前在工作台登录，选择后台启用分类并点击“分配分类”，会同步同逻辑组件的所有框架配置。分类不会授予包或组件权限；管理员仍需配置发布 ACL。也可在终端用稳定分类 ID：

```powershell
juz package --package my-card-react --category general
juz preview --bundle-dir .component-releases/<包配置键>/<版本-时间> --no-open
juz login --api-url https://api.example.com
juz publish --package my-card-react
```

`--category` 只作用于本次新候选；希望持续使用时请在工作台或配置中保存分类。工作台“打包验证”调用同一条已有链路：本地构建 → 一次 pnpm pack → 冻结 tarball → 工作区外实际安装该 tarball → 消费者构建 → Chromium 逐实现运行/截图 → 报告与 manifest。保存示例同步到干净消费者和冻结预览，工作台描述也作为预览资源进入摘要。

准备完成后可查看冻结预览。上传前核对目标 API、账号、包名/版本、该包全部实现/分类、manifest 摘要及 tarball SHA-256，点击“确认上传发布”才提交。不同 npm 包独立发布，不提供跨包原子事务。

源码、API、文档、消费者、保存示例、分类或相关依赖锁文件变化后，材料标记为与当前草稿不同，须重新准备。为覆盖包外共享源码与构建配置，输入摘要保守覆盖整个项目根目录中的源码材料（排除依赖、构建产物、本地工具、报告与发布状态）；同项目其他包的源码变化也会使已有候选失效。材料目录为 `.component-releases/<包配置键>/<版本-时间>/`；每包指针/锁位于 `.component-state/`。旧单配置指针只有归属匹配时才读取。

上传或服务重启后重复同一 `juz publish --package <包>` 恢复原 tarball、截图、manifest、上传会话及幂等键，不会重新打包。若当前输入已变而确实要恢复旧作业，显式传 `--bundle-dir <项目内原目录>`；冻结分类不能被 `--category` 改写。已发布版本不可覆盖，修改资产需递增组件包版本。

`juz package` 另输出 ZIP，后台导入需先解压，网页手工提交仍按 manual-upload 规则处理。详见[发布指南](project-publishing.md)。

## 自定义消费者桥接

复杂组件继续维护自己的消费者。缺少桥接时显示“受限”，可直接交互及刷新，CLI 不猜测业务挂载方式。推荐从新建模板的 `.juz/consumer/main.js` 复制桥接部分，保留 `window.__COMPONENT_EXAMPLE__` 就绪协议；桥接契约为 PlaygroundV1；ComponentApiV1 只新增可选参数描述，ReleaseManifestV1 保持兼容。

父窗口只向当前 iframe 的 WindowProxy 转移一个专用 MessagePort。消费者接收连接时必须检查：`event.source === parent`、`event.origin === document.querySelector('meta[name="juz-parent"]').content`、`event.data.type === 'juz-connect'`、恰好一个端口及本次加载未连接过。不要把不透明源的 `null` 当作身份。

端口收到 `{type:'values', values:{props,data}}` 时更新真实组件，收到 `{type:'state',id}` 时运行已保存状态。消费者只能上报：

```javascript
port.postMessage({ type: 'status', status: 'mounted' });
port.postMessage({ type: 'status', status: 'ready', checks: [{ name: 'mounted', status: 'passed' }] });
port.postMessage({ type: 'event', name: 'change', payload: { value: 43 }, time: new Date().toISOString() });
// 错误时发送 status: 'error' 和 message；未实现能力可发送 status: 'limited'。
```

只有 API 声明的事件进入事件日志。端口不接受保存/发布操作；卸载时关闭端口、组件及监听。控制 API 还要求正确 Host、精确 Origin 和当前会话令牌。组件运行于不同回环 origin 的 allow-scripts 沙箱；Vite HMR 同时检查随机能力路径、来源和 Vite WebSocket token。平台凭证保留在 CLI 侧，不进入页面存储、预览材料或项目子进程环境。

本地构建/编译工具仍是以开发者系统账户运行的项目代码，浏览器沙箱不等于操作系统文件权限隔离。请只在信任的本地项目上执行开发与构建命令。

每次 CLI 启动维护一个活动组件预览。同一启动地址的多个浏览器标签共用该活动预览；需要同时调试多个实现时，请使用不同端口分别启动工作台。

## 验证与排障

```powershell
pnpm --filter @company/component-cli typecheck
pnpm --filter @company/component-cli build
pnpm exec playwright test --config tests/workbench/playwright.config.ts
pnpm exec vitest run tests/integration/workbench-installed.test.ts
pnpm exec vitest run --config tests/platform/vitest.config.ts tests/platform/workbench-publishing.test.ts
```

常见错误：`PORT_IN_USE` 选其他端口；`PROJECT_DEPENDENCIES_REQUIRED` 先安装项目依赖；`PROJECT_TOOLCHAIN_REQUIRED` 在项目安装精确版本 Vite/框架插件；`EXAMPLE_CONFLICT` 重新载入后确认文件；`INPUTS_CHANGED` 重新准备或显式恢复原 Bundle；`PACKAGE_BUSY` 等待本包现有操作结束；`CATEGORY_REQUIRED/DISABLED` 冻结前选择有效分类。不要通过删除已发布版本或改写旧 manifest 绕过错误。

本轮验证证据及生产环境未覆盖边界见[独立验证记录](../verification/2026-11-26-juz-workbench.md)。
