# 组件多场景接入指南

同一份组件描述服务于普通 React/Vue 开发、本地工作台、未来低代码和 AI 按标识接入。本轮先提供描述与校验基础；不包含页面 DSL、布局引擎、低代码编辑器、远程数据源或低代码运行时。

## 日常开发改哪里

| 材料 | 职责 |
| --- | --- |
| src/Demo.tsx 或 src/Demo.vue | 普通 Props、回调/Emits、框架默认值与组件实现 |
| api/demo.json | 参数类型、约束、说明、默认值注解、编辑提示、事件载荷 |
| playground.json | 当前实例值、数据、预设状态；新模板 controls 为空 |
| component.config.json | 包导出、显式源码入口和预览材料位置 |
| .juz/consumer | CLI 调试桥接或复杂挂载适配，业务组件通常不用处理 |

新增参数时更新组件 Props 和 API，工作台自动派生控件；已有项目修改 API 后重新选择实现或刷新页面。保存只写实例值和所选状态，不把派生控件写回文件。React/Vue 实现各自保存示例。

## 示例：只设置数字颜色

新模板已提供 valueColor，只用于数字元素；color 继续设置标题与辅助文字。API props 中的定义如下：

~~~json
{
  "name": "valueColor",
  "type": "string",
  "required": false,
  "schema": {
    "type": "string",
    "title": "数字颜色",
    "description": "只影响主数值，不影响标题和辅助文字",
    "default": "#FF6B35"
  },
  "editor": { "kind": "color", "group": "数值样式" }
}
~~~

工作台自动显示分组、颜色控件和说明，无须再写 controls。普通开发直接传入 valueColor。API 不会修改组件代码，组件仍须实际使用这个 Props。

default 是注解，用于展示；不会自动注入保存值或调用参数。组件自身仍用 React 默认参数、Vue withDefaults 等常规方式提供默认值。未来低代码创建实例时如需初始化默认值，应有显式、可测试的创建动作。

## 结构化参数和编辑提示

保留原有 name/type/required 和事件 name/payload；schema/editor 均可选，旧 API/示例仍可读取。

- Schema 支持 string、number、integer、boolean、null、object、array；支持标量 enum、minimum/maximum、minLength/maxLength、minItems/maxItems、items、properties、required、additionalProperties，以及 title/description/default 注解。
- Schema 最多 12 层、256 个节点；拒绝 $ref、用户正则、表达式和未知关键字。它是受限 JSON Schema 子集，不能把任意完整 JSON Schema 直接传入。
- 对象应声明内部结构；严格对象设置 additionalProperties:false。事件可附带 schema 描述载荷。
- editor 支持 text/number/boolean/enum/color/json 和 group。复杂对象、数组使用 JSON 控件；颜色控件要求六位十六进制。
- 旧 playground.controls 仍按 name 覆盖界面，可配置 options、min/max、label、description、group；不能放宽 API 的值约束。新模板不重复维护控件。

预览、保存及冻结前会校验 dataProp 覆盖后的实际值和每一个状态；非法输入显示错误并保留最后有效画布。未知旧 TypeScript 类型只作说明；有结构化 schema 时才能校验内部结构。公共运行时还校验递归定义、默认值及字段一致性，生成的外层 JSON Schema 结构校验不能替代这些运行时规则。

## 常规 npm 消费

新模板将 dist、api、docs 纳入 npm 包，导出组件根入口及 api/* 元数据子路径。普通导入仍直接使用组件，运行入口不加载元数据，不要求平台账号或编辑器运行时。元数据消费者可显式解析“包名/api/demo.json”；旧包不会被自动改写。

React/Vue 两个实现可以属于不同 npm 包，共享逻辑 componentId；独立版本与摘要仍分别验证。复杂 Provider、插槽、CSS 和业务初始化继续由普通宿主或显式消费者适配器负责，CLI 不猜测。

## AI 与标识

| 标识 | 含义 |
| --- | --- |
| componentId | 跨框架的逻辑组件 |
| variantReleaseId | 某个包版本下的框架实现，关联不可变摘要和证据 |
| designId | 设计工具中的标识，通过显式规则映射 |
| instanceId | 本次设计中的实例，同一组件可以出现多次 |

AI 复用已有组件精确查询、ID 映射、inspect/plan/apply/verify 流程，不增加 AI 专用描述文件。权威发布 API、匹配响应和离线计划保留完整 schema/editor；篡改描述会触发 API_MISMATCH。生成器从合法 Schema 生成结构化 TypeScript，不把未知类型文本当代码，不猜测包内类型导出；旧图表类型白名单继续兼容。

普通组件查询和生成可以省略 styleExport、readyMethod、echartsVersion；真实包需要 ECharts 时仍要求精确版本，不能自动补“最新版”。标识不授予权限、兼容性或执行授权，材料摘要、业务绑定与兼容证据独立检查。

当前已接受兼容记录仍面向 ECharts 组合，非图表组件会如实保留 COMPATIBILITY_UNVERIFIED。本轮支持普通组件的静态发现、参数/事件描述、类型生成和无 ECharts 的本地浏览器验证，不宣称已自动通过真实平台的兼容证据接受门槛。复杂挂载与业务语义也可能需要人工确认。

## 冻结与后续低代码

已保存示例、API、文档沿用现有摘要和冻结链路。冻结预览从 Bundle 内读取描述和示例；调参、保存或源码变动不会改写旧 Bundle。低代码未来应复用本契约，不从 playground.json 反推组件能力，也不把 schema 当可执行脚本。
