import type { ComposeOption, EChartsType } from 'echarts/core.js';
import type {
  BarSeriesOption,
  GraphicComponentOption,
  GridComponentOption,
  LegendComponentOption,
  LineSeriesOption,
  PieSeriesOption,
  ScatterSeriesOption,
  TitleComponentOption,
  TooltipComponentOption,
  XAXisComponentOption,
  YAXisComponentOption,
} from 'echarts';

/**
 * 渲染器：首期默认 Canvas，按场景提供 SVG（架构 §6）。
 * 切换渲染器必须销毁并重建实例，不能在 option 层改写。
 */
export type Renderer = 'canvas' | 'svg';

/** 主题：内置 light / dark。 */
export type ThemeName = 'light' | 'dark';

/**
 * 图表类型联合（T09 起按图表扩展）：决定 option 构建与按需模块注册。
 * 控制器与框架层按该联合分发，不引入 `any` 或任意对象配置。
 */
export type ChartType =
  | 'line'
  | 'bar'
  | 'pie'
  | 'scatter'
  | 'trend-card'
  | 'ranking'
  | 'proportion';

/** 单个数据点。y 为 null 表示缺失值，共享核心禁止将其转换为 0。 */
export type ChartPoint = { x: string | number; y: number | null };

/** 一个数据系列。id 为稳定标识，更新时按 id 合并，避免残留系列。 */
export type ChartSeries = { id: string; name: string; points: ChartPoint[] };

/** 图表数据：一个或多个系列。 */
export type ChartData = { series: ChartSeries[] };

/**
 * 统一事件载荷：Vue `point-click` 与 React `onPointClick` 共用同一结构（架构 §6）。
 */
export type ChartEvent = {
  seriesId: string;
  dataIndex: number;
  value: [string | number, number | null];
  nativeType: string;
};

export type PointClickListener = (event: ChartEvent) => void;
export type Unsubscribe = () => void;

/** 单位与小数位；格式化规则确定，不依赖运行 locale，保证截图可复现。 */
export type UnitSpec = { suffix?: string; decimals?: number };

/** 控制器与图表构建共用的基础配置。 */
export type ChartConfig = {
  theme?: ThemeName;
  renderer?: Renderer;
  unit?: UnitSpec;
  /** 固定像素尺寸；缺省时跟随容器，由 resize 处理变化。 */
  width?: number;
  height?: number;
  /** 截图与测试场景关闭动画；缺省跟随 ECharts 默认。 */
  animation?: boolean;
};

/** 折线图配置：基础配置 + 折线特有语义。 */
export type LineChartConfig = ChartConfig & {
  /** 图表类型标识；缺省视为 'line'，兼容 T02/T03 既有调用方。 */
  chart?: 'line';
  smooth?: boolean;
  /** 是否填充面积。 */
  area?: boolean;
  /** 缺失值是否连线；默认 false，与“null 即缺失”语义一致。 */
  connectNulls?: boolean;
  xAxisName?: string;
  yAxisName?: string;
};

/** 柱状图配置：基础配置 + 柱状特有语义。 */
export type BarChartConfig = ChartConfig & {
  /** 图表类型标识：必填判别字段，柱状图不接受折线图专属配置。 */
  chart: 'bar';
  /** 堆叠分组 id：相同 stack 的系列叠加；缺省为分组柱状。 */
  stack?: string;
  xAxisName?: string;
  yAxisName?: string;
};

/** 控制器入口接受的图表配置联合。 */
export type AnyChartConfig =
  | LineChartConfig
  | BarChartConfig
  | PieChartConfig
  | ScatterChartConfig
  | TrendCardConfig
  | RankingChartConfig
  | ProportionChartConfig;

/**
 * 饼图 / 环形图配置：基础配置 + 饼图特有语义。
 * `points[].x` 为扇形名称，`points[].y` 为数值；一个系列对应一圈（一环）。
 */
export type PieChartConfig = ChartConfig & {
  /** 图表类型标识：必填判别字段，饼图不接受折线 / 柱状专属配置。 */
  chart: 'pie';
  /**
   * 环形图开关：只改变内半径语义（从内侧预留外半径的 50% 作为内孔），
   * 不影响数据、角度顺序、图例规则与占比口径。缺省为实心饼图。
   */
  donut?: boolean;
};

/**
 * 散点图配置：基础配置 + 散点特有语义。
 * `points[].x` 为数值轴坐标（必须为数值），`points[].y` 为数值；缺失值（null）该点不渲染。
 */
export type ScatterChartConfig = ChartConfig & {
  /** 图表类型标识：必填判别字段，散点图不接受折线 / 柱状 / 饼图专属配置。 */
  chart: 'scatter';
  /** x 数值轴名称；x 轴标签按无单位格式化（unit 只描述 y 轴口径）。 */
  xAxisName?: string;
  /** y 数值轴名称。 */
  yAxisName?: string;
};

/**
 * 趋势卡片配置（T09 组合场景）：基础配置 + 趋势卡片特有语义。
 * `points[].x` 为类目轴坐标（时间 / 期间），`points[].y` 为数值；
 * 「当前值」取第一个系列最后一个非缺失值，「前期值」来自 `previousValue`。
 */
export type TrendCardConfig = ChartConfig & {
  /** 图表类型标识：必填判别字段，趋势卡片不接受折线 / 柱状 / 饼图 / 散点专属配置。 */
  chart: 'trend-card';
  /** 卡片标题（指标名），如「近 7 日活跃用户」；缺省不显示标题。 */
  title?: string;
  /** 前期值（上一周期对比基线）；undefined / null 时只展示当前值，不计算变化。 */
  previousValue?: number | null;
};

/**
 * 趋势卡片数值摘要：当前值 / 前期值 / 变化量 / 变化率与方向。
 * 由 `computeTrendSummary` 纯函数计算，供 option 构建与调用方断言共用。
 */
export type TrendSummary = {
  /** 当前值：第一个系列最后一个非缺失值；无可用值为 null。 */
  current: number | null;
  /** 前期值：来自 config.previousValue，缺失归一为 null。 */
  previous: number | null;
  /** 变化量：current - previous；任一不可算时为 null。 */
  delta: number | null;
  /** 变化率（百分比数值）：delta / |previous| * 100；previous 为 0 或不可算时为 null。 */
  deltaPercent: number | null;
  /** 方向：delta 为正 up、为负 down、为 0 flat、不可算 none。 */
  direction: 'up' | 'down' | 'flat' | 'none';
};

/**
 * 受支持的 option 覆盖字段：仅这些顶层组件配置可深层合并。
 * 系列、主题与渲染器不可覆盖：系列由数据驱动；主题/渲染器变化必须 setPresentation 重建实例。
 */
export type SupportedOptionOverrides = {
  grid?: GridComponentOption;
  tooltip?: TooltipComponentOption;
  legend?: LegendComponentOption;
  xAxis?: XAXisComponentOption;
  yAxis?: YAXisComponentOption;
  title?: TitleComponentOption;
};

export type ChartComponentOption =
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | XAXisComponentOption
  | YAXisComponentOption
  | TitleComponentOption;

/** 折线图 option 类型：按入口注册的系列与组件联合。 */
export type LineChartOption = ComposeOption<LineSeriesOption | ChartComponentOption>;

/** 柱状图 option 类型：按入口注册的系列与组件联合。 */
export type BarChartOption = ComposeOption<BarSeriesOption | ChartComponentOption>;

/** 饼图 / 环形图 option 类型：按入口注册的系列与组件联合（无坐标轴组件）。 */
export type PieChartOption = ComposeOption<PieSeriesOption | ChartComponentOption>;

/** 散点图 option 类型：按入口注册的系列与组件联合（双数值轴）。 */
export type ScatterChartOption = ComposeOption<ScatterSeriesOption | ChartComponentOption>;

/**
 * 趋势卡片 option 类型：折线 sparkline 系列 + 坐标轴类组件 + graphic 数值摘要。
 * graphic 由数据驱动，不通过 optionOverrides 覆盖。
 */
export type TrendCardOption = ComposeOption<
  LineSeriesOption | ChartComponentOption | GraphicComponentOption
>;

/** 排行榜排序方向：`desc` 数值大者在前（缺省），`asc` 反向。 */
export type RankingDirection = 'desc' | 'asc';

/**
 * 排行榜配置（T09 第五批组合场景）：基础配置 + 排行榜特有语义。
 * `points[].x` 为条目名称，`points[].y` 为数值；只接受单系列。
 */
export type RankingChartConfig = ChartConfig & {
  /** 图表类型标识：必填判别字段，排行榜不接受其他图表专属配置。 */
  chart: 'ranking';
  /** 排序方向；缺省 `desc`（数值大者在前）。 */
  direction?: RankingDirection;
  /** 取前 N 名；仅正整数生效，其余取值不截断。名次在截断前计算。 */
  limit?: number;
  /** 榜单标题（如「热门组件 Top 5」）；缺省不显示标题。 */
  title?: string;
};

/**
 * 排行榜条目：名次 + 名称 + 数值 + 输入序号。
 * 由 `computeRanking` 纯函数计算，供 option 构建与调用方断言共用。
 */
export type RankingEntry = {
  /** 名次：1 起；并列项共享名次（竞赛排名 1,2,2,4）。 */
  rank: number;
  /** 条目名称（原始 `points[].x`）。 */
  name: string | number;
  /** 条目数值；缺失值（null）不进入排行。 */
  value: number;
  /** 该条目在输入中的原始序号，用于并列时保持稳定顺序。 */
  sourceIndex: number;
};

/**
 * 占比配置（T09 第五批组合场景）：基础配置 + 占比特有语义。
 * `points[].x` 为条目名称，`points[].y` 为数值；只接受单系列。
 */
export type ProportionChartConfig = ChartConfig & {
  /** 图表类型标识：必填判别字段，占比不接受其他图表专属配置。 */
  chart: 'proportion';
  /** 图表标题（如「流量来源占比」）；缺省不显示标题。 */
  title?: string;
};

/**
 * 占比条目：名称 + 数值 + 占总量的比例 + 输入序号。
 * 由 `computeProportionShares` 纯函数计算，供 option 构建与调用方断言共用。
 */
export type ProportionShare = {
  /** 条目名称（原始 `points[].x`）。 */
  name: string | number;
  /** 条目数值；缺失值（null）不参与占比。 */
  value: number | null;
  /** 占总量的比例（0–1）；总量不可算（`total <= 0`）时为 null。 */
  share: number | null;
  /** 该条目在输入中的原始序号，便于调用方回查。 */
  sourceIndex: number;
};

/**
 * 排行榜 option 类型：横向条形系列 + 坐标轴类组件 + graphic 摘要（名次在类目轴标签上）。
 * graphic 由数据驱动，不通过 optionOverrides 覆盖。
 */
export type RankingChartOption = ComposeOption<
  BarSeriesOption | ChartComponentOption | GraphicComponentOption
>;

/**
 * 占比 option 类型：横向条形系列 + 坐标轴类组件 + graphic 摘要（数值与百分比在条末标签上）。
 * graphic 由数据驱动，不通过 optionOverrides 覆盖。
 */
export type ProportionChartOption = ComposeOption<
  BarSeriesOption | ChartComponentOption | GraphicComponentOption
>;

/**
 * 图表控制器：双框架适配层共用的实例生命周期与事件入口。
 * 图表类型由创建时传入的配置联合（`AnyChartConfig`）决定，更新不改变类型。
 */
export type ChartController = {
  /** 数据更新；series 按稳定 id 以 replaceMerge 合并，删除系列不残留。 */
  update(data: ChartData, optionOverrides?: SupportedOptionOverrides): void;
  resize(): void;
  /** 主题或渲染器变化：销毁实例并用当前数据重建。 */
  setPresentation(theme: ThemeName, renderer: Renderer): void;
  onPointClick(listener: PointClickListener): Unsubscribe;
  /** 最近一次渲染完成（ECharts finished）后 resolve；用于截图就绪判定。 */
  whenRendered(): Promise<void>;
  /** 高级能力：直接访问 ECharts 实例；仅在客户端挂载后可用，与上游 ECharts 耦合。 */
  getInstance(): EChartsType | null;
  /** 幂等：重复调用安全；解除监听、断开观察器并销毁实例。 */
  dispose(): void;
};
