import type { ComposeOption, EChartsType } from 'echarts/core.js';
import type {
  BarSeriesOption,
  GridComponentOption,
  LegendComponentOption,
  LineSeriesOption,
  PieSeriesOption,
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
export type ChartType = 'line' | 'bar' | 'pie';

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
export type AnyChartConfig = LineChartConfig | BarChartConfig | PieChartConfig;

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
