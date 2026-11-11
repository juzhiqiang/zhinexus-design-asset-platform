import type { ComposeOption, EChartsType } from 'echarts/core.js';
import type {
  GridComponentOption,
  LegendComponentOption,
  LineSeriesOption,
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
  smooth?: boolean;
  /** 是否填充面积。 */
  area?: boolean;
  /** 缺失值是否连线；默认 false，与“null 即缺失”语义一致。 */
  connectNulls?: boolean;
  xAxisName?: string;
  yAxisName?: string;
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

/** 图表控制器：双框架适配层共用的实例生命周期与事件入口。 */
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
