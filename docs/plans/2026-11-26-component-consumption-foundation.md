# 组件三种消费场景基础实现计划

> **For agentic workers:** 使用 executing-plans 在本次会话逐任务实施，先 RED 再 GREEN。用户已于 2026-11-26 授权按已讨论的建议实施；不再为可逆的本地实施请求许可。

**Goal:** 同一份组件 API 描述支持常规 React/Vue 使用、本地工作台、未来低代码和按标识进行的 AI 接入，减少重复维护。

**Architecture:** 保持普通 TSX/SFC 组件与现有 ComponentApiV1、PlaygroundV1、ReleaseManifestV1 的旧材料可读。在现有 API 的属性/事件上增加可选的受限 JSON Schema 与编辑提示，工作台派生控件，公共契约执行定义与值的校验，匹配链路保留完整描述。示例文件只管理实例值和预设，不新增必填配置文件。

**Tech Stack:** 现有 TypeScript、pnpm、Vitest、Playwright；不增加运行时依赖或工作区成员。

**Spec:** 本文件的“确认范围”，以及 component-platform-implementation-assessment.md 本日追加范围。

## 确认范围

- 低代码编辑器后续建设；本轮交付可复用的组件描述、值校验、工作台消费及机器接入基础。
- 组件本体按普通 React Props/回调、Vue Props/Emits 开发，不依赖编辑器或平台运行时。
- 参数类型、说明、默认值和编辑提示在 api/*.json 中集中声明。保留旧的 name/type/required，新增 schema/editor 均可选。
- Schema 限于本地、纯 JSON、有限深度/节点预算的类型、对象、数组、枚举及数值/长度约束；不执行表达式，不解析远程引用或用户正则。default 是注解，不偷偷填充用户输入。
- 示例仍保留显式 controls 的兼容覆盖能力；新模板从 API 派生控件，不要求重复描述控件。保存只写用户示例，不把派生控件写回。
- componentId、designId、instanceId 与发布实现引用保持原有语义；标识不代表权限、兼容性或执行授权。匹配响应/计划保留 Schema，不新增 AI 专用配置。
- 新模板演示 valueColor，只改变数字颜色；API/文档可随 npm 包发布，组件运行入口不导入它们。
- 冻结前校验已保存示例及所有状态；元数据继续沿用 API 文件摘要和输入指纹，不改变冻结后不可写原则。

## Global Constraints

- 原始 component-platform-architecture.md 保持字节不变，基线 SHA-256 E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723。
- 不新增工作区成员和依赖，不引入服务端组件执行。
- 不修改用户已有修复分支；从 db65ce3e 创建独立 feat/component-consumption-foundation 分支，main 不变。
- 本地提交允许；合并、推送、npm 发布与部署不在本轮授权中。

## Review Focus

- 恶意/过深 Schema、原型属性名、错误默认值和未知关键字必须失败关闭。
- 示例 dataProp 覆盖后的实际值，以及每一个状态，都必须满足同一属性契约。
- 旧 API/示例的行为保持兼容，显式控件不得绕过更严格的参数约束。
- 派生控件和默认值注解不得污染示例保存，冻结预览只读。
- 描述从发布 API 进入匹配响应/计划时不可丢失；不能用标识或类型说明代替兼容性证据。

## Task 1: 参数描述契约与共享校验

**Files:** packages/contracts/src/component-values.ts、component-api.ts、playground.ts、match-plan.ts、schemas.ts、index.ts；CLI 契约同步脚本；tests/contracts/component-values.test.ts。

**Interfaces:** ComponentValueSchemaV1；validateComponentValues(api, props)；componentValueType(schema)；derivePlaygroundControls(api, overrides)。

- [x] RED：旧 API 兼容、嵌套数据、枚举/边界、错误默认值/编辑器、未知引用、深度限制、恶意键、类型安全输出。
- [x] GREEN：实现受限 Schema，增加 API 可选字段，派生控件和公共值校验，匹配计划保留描述。
- [x] 验证契约测试、生成 Schema 一致性、contracts 类型检查；24 文件 589/589 通过。

## Task 2: 工作台、示例与模板复用

**Files:** packages/component-cli/src/workbench/{examples,server,create,templates}.ts、ui/client.js；project/prepare.ts；tests/unit/workbench-project.test.ts；tests/workbench/workbench.spec.ts。

**Interfaces:** 工作台目录新增派生 controls；原始 example/digest 原样保留；validateExample 使用公共值校验；保存不写入派生数据。

- [ ] RED：只新增 API 参数即可生成工作台控件；valueColor 独立生效；非法嵌套值不能替换最后有效预览；各状态均校验；保存不重复写控件。
- [ ] GREEN：接入共享函数，模板增加 valueColor、语义说明和可选元数据导出，打包前验证示例。
- [ ] 验证单测、真实双框架浏览器与冻结消费者，提交。

## Task 3: 机器接入描述与普通组件边界

**Files:** packages/contracts/src/{component-match,match-plan}.ts；apps/api/src/matching/*；packages/component-cli/src/integration/*；对应契约/查询/生成器测试。

- [ ] RED：扩展描述经过发布查询/匹配计划后不丢失；普通无样式/就绪方法组件可被描述；安全结构化类型可用于生成器。
- [ ] GREEN：复用已有 ID/版本解析与证据，不创建第二条发现链路；按测试修正图表专用假设；不能支持的接入能力明确报 gap。
- [ ] 验证实际类型/生成结果及既有匹配回归并提交。

## Task 4: 交付与验证

- [ ] 更新 README、使用指南、范围说明和独立验证记录，记录每项实际命令与未覆盖项。
- [ ] pnpm verify:workspace；pnpm --filter @company/contracts schemas:generate；CLI typecheck/build；专用 Playwright；pnpm typecheck；pnpm exec turbo run build --force；pnpm test。
- [ ] 真实 CLI tgz 在仓库外安装，验证新建、元数据、工作台和普通包类型/构建；不把 mock HTTP 当真实平台验收。
- [ ] 审查全部改动，修复可重现问题。独立升级 CLI PATCH 与根版本，更新 CHANGELOG 并提交。
- [ ] 交付 tgz、摘要、指南、验证结果和明确未覆盖边界；保留分支，不自动合并/推送/发布。
