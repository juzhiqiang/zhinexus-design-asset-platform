/**
 * 画廊介绍首页（`/`）的内容与设计令牌。
 *
 * 唯一事实来源是 `docs/design/gallery.pen` 的画板 `I0RAl`（00 介绍首页 · 科技朋克）。
 * 本模块**不 import 任何 React / Next / 浏览器 API**，因此可以在 `tests/gallery`
 * 的 Node 环境里直接与设计稿比对（见 `home-design.test.ts`）；页面组件只负责排版。
 *
 * 设计稿为 1440 宽概念稿，其中的图表数字均为设计示意（`NATIVE STUDY / DEMO`、
 * `DEMO` 标记已在文案中保留），不代表真实资产数据或验收结论。
 */

/** 五层 shader 氛围背景的分区映射，`mode` 对应设计稿 uniform `u_mode`。 */
export type AtmospherePreset = {
  mode: number;
  /** 所属首页分区，仅用于可读性与测试报错信息。 */
  section: string;
};

/** 设计稿五层 shader 矩形共用的 uniform（除 `u_mode` 外完全一致）。 */
export const ATMOSPHERE_UNIFORMS = {
  u_speed: 1,
  u_frame: 0,
  u_base: '#080D1C',
  u_blue: '#387BFF',
  u_iris: '#9164FF',
} as const;

/**
 * 五层氛围背景的分区映射，`mode` 对应设计稿 uniform `u_mode`。
 *
 * 用元组类型声明：`apps/gallery` 开启 `noUncheckedIndexedAccess`，页面按
 * `ATMOSPHERE_PRESETS[0..4].mode` 取各分区模式，数组类型会报「可能 undefined」。
 */
export const ATMOSPHERE_PRESETS = [
  { mode: 0, section: '首屏' },
  { mode: 1, section: '资产' },
  { mode: 2, section: '原生' },
  { mode: 3, section: '流程' },
  { mode: 4, section: '行动' },
] as const satisfies readonly AtmospherePreset[];

/** 设计令牌：值即 CSS 自定义属性声明值，`home.css` 必须逐条镜像。 */
export const HOME_TOKENS = {
  surface: { value: '#080D1C' },
  textPrimary: { value: '#F0F1F4' },
  textSecondary: { value: '#C4C7D0' },
  textMuted: { value: '#A0A5B0' },
  textFaint: { value: '#656C7C' },
  accent: { value: '#84EEE5' },
  accentIris: { value: '#AA9EED' },
  hairline: { value: '#25283266' },
  navHeight: { value: '88px' },
  heroHeight: { value: '720px' },
  containerWidth: { value: '1280px' },
  gutter: { value: '80px' },
  heroTitleSize: { value: '76px' },
  sectionTitleSize: { value: '42px' },
} as const;

/** 首页自有的深色导航。`/components`、`/library` 仍沿用根 layout 的浅色导航。 */
export const HOME_NAV = {
  brand: 'ZHINEXUS',
  links: [
    { label: '首页', href: '/' },
    { label: '组件画廊', href: '/components' },
    // 设计稿保留「接入文档」入口文案；公开画廊当前没有该路由，不伪造链接。
    { label: '接入文档', href: null },
  ],
  cta: { label: '浏览组件', href: '/components' },
} as const;

export const HERO = {
  eyebrow: 'BUILT FOR WHAT COMES NEXT',
  titleLines: ['将灵感，', '编译成未来。'],
  lede: '企业级图表与组件资产平台。',
  sub: '沉淀团队经验，让 Vue 与 React 共享创造力。',
  primaryCta: { label: '探索组件画廊', href: '/components' },
  secondaryCta: { label: '接入文档', href: null },
  annotation: 'DESIGN  /  CODE  /  REUSE',
  studyIndex: 'NEXUS / ORBITAL STUDY — 01',
  studyMaterial: 'TITANIUM / NATIVE GEOMETRY',
  scroll: 'SCROLL TO EXPLORE',
  principle: 'LOCAL-FIRST  /  FRAMEWORK-NATIVE',
} as const;

export const ECOSYSTEM = {
  index: 'ONE ASSET LANGUAGE',
  subtitle: '为你的技术栈而生',
  items: [
    { label: 'Vue 3', dot: '#84EEE580' },
    { label: 'React 19', dot: '#AA9EED80' },
    { label: 'ECharts 6', dot: '#84EEE580' },
    { label: 'TypeScript', dot: '#AA9EED80' },
  ],
} as const;

export const ASSET_SECTION = {
  index: '01  /  CURATED TO CREATE',
  title: '把团队经验，\n变成创作的起点。',
  description: '从业务图表到数据界面，\n让每一次构建都站在团队经验之上。',
  browseAll: '浏览所有资产',
  trend: {
    name: '趋势与洞察',
    summary: '在变化中看见方向。',
    frameworks: 'VUE  /  REACT',
    window: {
      code: '01 / SIGNAL TO INSIGHT',
      concept: 'NATIVE STUDY / DEMO',
      value: '74.8',
      valueNote: '趋势指数 · 示意',
      focusNote: '09 / 74.8',
      currentLegend: '本期',
      compareLegend: '对照',
      axisLabels: ['01', '03', '05', '07', '09', '12'],
    },
  },
  structure: {
    name: '排列与结构',
    summary: '让复杂数据，自成秩序。',
    frameworks: 'VUE / REACT',
    window: {
      code: '02 / ORDER IN SPACE',
      concept: 'DEMO',
      subtitle: '空间序列',
      material: 'TITANIUM / 08',
      sequenceLabels: ['01', '02', '03', '04', '05', '06', '07', '08'],
    },
  },
} as const;

export const FRAMEWORK_SECTION = {
  index: '02  /  FRAMEWORK-NATIVE',
  title: '一种资产语言。\n两种原生表达。',
  description: '不为框架妥协，也不重复创造。\nVue 与 React 独立实现，共享核心能力。',
  boundary: 'INDEPENDENT IMPLEMENTATIONS. SHARED FOUNDATION.',
  badges: [
    { name: 'Vue 3', note: '独立实现 · 独立检查' },
    { name: 'React 19', note: '独立实现 · 独立检查' },
  ],
  sharedCore: { label: 'SHARED CORE', tech: 'ECharts 6  +  TypeScript' },
} as const;

export type ProcessIcon = 'search' | 'scan-eye' | 'package' | 'terminal';

export const PROCESS_SECTION = {
  index: '03  /  FROM DISCOVERY TO DELIVERY',
  title: '从发现，到你的项目。',
  lede: '让成熟资产，成为你的创作起点。',
  steps: [
    { order: '01', title: '发现资产', description: '按业务需求检索组件，\n选择 Vue 或 React 实现。', icon: 'search' },
    { order: '02', title: '沙箱预览', description: '查看效果、API 与检查来源，\n先确认，再接入。', icon: 'scan-eye' },
    { order: '03', title: '精确接入', description: '复制指定版本安装命令，\n将资产接入本地项目。', icon: 'package' },
    { order: '04', title: '本地验证', description: '在开发者电脑构建与检查，\n把复用落到实际业务中。', icon: 'terminal' },
  ] as ReadonlyArray<{ order: string; title: string; description: string; icon: ProcessIcon }>,
} as const;

export const ACTION_SECTION = {
  eyebrow: 'YOUR NEXT STARTS HERE',
  title: '为下一次创造，\n留出更多可能。',
  cta: { label: '探索组件画廊', href: '/components' },
  note: 'BUILD ON WHAT YOUR TEAM KNOWS.',
} as const;

export const HOME_FOOTER = {
  brand: 'ZHINEXUS',
  tagline: '企业级图表与组件资产平台',
  links: [
    { label: '组件画廊', href: '/components' },
    // 设计稿保留两条入口文案；公开画廊没有对应路由，不伪造链接。
    { label: '接入文档', href: null },
    { label: '管理控制台', href: null },
  ],
  copyright: '© 2026 ZHINEXUS',
  concept: 'GALLERY CONCEPT  /  TITANIUM EDITION',
} as const;
