# juz 工作台缺陷与常规组件开发修正

用户要求修复 DataV 对照审查的五个已复现问题，并降低组件开发的额外负担。基线 main 407b1628；独立分支 fix/juz-component-development。

## 范围裁定

- 修复并发调参覆盖、项目 Vite 编译配置遗漏、Vue SFC 类型/声明缺失、dataProp 类型绕过、dev 包选择语义不一致。
- 新模板使用 src/Demo.tsx / src/Demo.vue 和普通导出入口；组件只使用框架 Props、Callbacks / Emits，无平台基类。Vue 复用仓库验证的 vue-tsc 3.3.14 + TypeScript 6.0.3 兼容组合。
- 默认消费者桥接材料归入 .juz/consumer，由 CLI 创建；保存示例仍以包内 playground.json 为唯一输入。现有配置及自定义消费者保持兼容，不迁移、不覆盖。all 的两个独立发布包保留。
- 项目 Vite 配置只在清除平台环境凭证的编译子进程加载，复用编译插件、解析、CSS 等选项；控制/预览网络、能力路径、env 和 fs 安全限制由 CLI 强制设置。
- 不变更共享契约，不新增工作区成员，不修改服务端发布链路或原始架构文档，不推送、合并或远程发布。

## 执行与验收

1. 增加并运行失败测试：有效绑定类型及状态、包选择启动前失败、浏览器并发编辑、项目 alias/plugin/CSS、普通 SFC 类型与仓外声明消费。
2. 逐项最小实现并运行对应 GREEN；覆盖旧消费者、保存竞态、框架切换、HMR 与安全反例。
3. 运行 CLI 类型检查/构建、专项 Playwright、仓外 tgz 闭环、verify:workspace、typecheck、强制 build 与 test；如真实基础设施可用则运行发布专项。逐项记录实际结果与未覆盖范围。
4. 更新指南、README 与独立验证记录。兼容修复完成后 CLI 0.1.1 / 平台 0.2.2，版本及 CHANGELOG 单独提交。

## 开工证据

- 原架构 SHA-256：E59BB77EDE1497D349FCC5EAE49BF892E1C92572F4777535FF13B89E1A371723。
- 基线三个 workbench 单测文件共 10 项通过。
- 原生 worktree 被 ignored AGENTS 扫描阻塞；停止本次只读扫描后注册失败，attach 亦因 ownerless 拒绝。继续显式使用已创建的 Git worktree，未改动主工作区。
- 系统 Node 24.6.0 安装遭既有 Angular 依赖 engine 拒绝；使用仓库 bootstrap 的固定 Node 26.13.0 验证，不降低依赖要求。
