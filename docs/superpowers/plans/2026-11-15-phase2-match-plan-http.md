# 二期确定性装配 HTTP 协议与执行补充

基于用户已确认的无模型 ID 匹配范围及 phase2-id-matching Task 2–4。真实设计 ID 规范尚未定，本次不设业务前缀或格式。

## 冻结接口

`POST /v1/matching/plans`，Bearer read，no-store/noindex；JSON 输入 `MatchPlanRequest={design:DesignIdInputV1,context:ProjectContext,reactDomVersion?:string,bindings?:ElementBindings[]}`。每条 bindings `{instanceId,props:[{name,source}],events:[{name,handler}],layout?:string}`；source/handler/layout 是用户声明的引用/说明，仅作数据，不执行，不声称通过业务类型或视觉验证。bindings 的实例必须存在且唯一，字段名也必须唯一。ID 精确比较。

`MatchPlanV1={schemaVersion:1,source:'design-id',inputDigest,ruleSetId,revision,context,elements,exactDependencies,gaps}`。inputDigest 为完整规范化请求 JSON 的 SHA-256，绑定所有配置/上下文/映射，不只绑定 revision。

每个元素 `{instanceId,designId,status:'mapped'|'gap',target?,props,events,layout?,gaps}`；target 包含精确发布/组件/框架/包版本/摘要/导出路径、API/docs 证据、compatibility、例子 ID、styleExport 和 readyMethod。props 含 `{name,type,required,source?}`，events 含 `{name,payload,handler?}`。未提供数据/事件/布局保留缺口；mapped 仅表示目标材料可映射，不等于可以自动接入或完整业务验证。空输入不称为成功。

缺口使用 `{code,message}`，code 包含 UNMAPPED_ID、TARGET_UNAVAILABLE、API_UNSUPPORTED、UNKNOWN_PROP、UNKNOWN_EVENT、MISSING_PROP、MISSING_EVENT、LAYOUT_UNKNOWN、COMPATIBILITY_UNVERIFIED、REQUIREMENTS_UNASSESSED、DEPENDENCY_CONFLICT、EMPTY_DESIGN。不可读、不存在、废弃、框架/peer 不符统一 TARGET_UNAVAILABLE，不泄露目标信息。未找到框架配置视为 UNMAPPED_ID。

精确依赖为 `{name,version}`，包含目标包和声明的精确运行依赖，冲突作为阻断缺口；不猜测 peer 主版本或把文本索引当 ID 定位前置。真实目录/权限最终批次复读，材料读取后再次校验，撤权不得保留材料或依赖。

新增 `ComponentApiV1={schemaVersion:1,componentId,framework,exportName,exportPath,props:[{name,type,required}],events:[{name,payload}],styleExport,readyMethod,notes:string[]}`。此为发布材料，不是服务器执行代码。服务端只信同一发布清单指定的摘要核验材料；无 schemaVersion 的旧材料报 API_UNSUPPORTED，不修改历史产物。框架元数据生成使用真实组件类型审计，React onPointClick 与 Vue point-click 分开，SupportedOptionOverrides 等实际类型不得编造。

## 文件所有权与步骤

- C：contracts、apps/api/matching、复用 search 资格逻辑、Nest 注册、fixtures、HTTP/真实服务测试、根配置/锁与版本收口。先写契约失败测试并验证 RED，再实现和生成；冻结后交付 A/B。后端失败测试覆盖未知/无权/废弃/peer/摘要/重复绑定/缺材料/索引故障和并发撤权，GREEN 后真实 PG/MinIO/Verdaccio 验证及 200/1000 规模量测。
- A（Antigravity）：限定 `packages/component-cli/src/local/component-api.ts`、manifest.ts 中 API 材料生成调用、对应独立 CLI API 测试与 `tests/evaluation/id-*.ts` / 新审查文档。此为本轮明确文件分配，CLI 其余文件不改；C 负责内联契约。先验证旧 React 事件/配置类型问题 RED，再修新材料生成，审查实际 Vue/React 类型，评估规则反例。
- B（Claude 桌面）：`apps/gallery/app/(console)/match/`、`apps/gallery/app/lib/match-plan-client.ts` 与专属前端测试。实现 ID 配置/元素清单/可选绑定输入、校验错误和方案展示；保留现有人工文本发现。旧结果按输入摘要及会话代次失效，身份/上下文/输入改变取消在途响应；不编造服务响应。仅使用冻结 contracts 导出，不另定义 HTTP 形状。
- 每个工作区先确认干净；不得互相修改、push 或改原架构。分批提交/审查/升版，最后合并前运行公共包全图验证及 UI/真实服务联调。

## 实施判断

本次不执行三期安装/代码写入。参数/事件引用由用户声明，是否满足实际业务/数据类型仍由三期验证。先交付可验证的组件选择与真实 API 字段映射，不能把文本需求自动标为满足。真实设计导出格式与命名约定、真实业务数据未到位时仍保持最终业务验收开放。
