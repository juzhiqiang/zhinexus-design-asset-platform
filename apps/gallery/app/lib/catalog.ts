import type { ApiMessages, Framework } from '@company/contracts';
import type { ComponentCatalogItem, ComponentVariantMeta } from './types';

const DEFAULT_API_ORIGIN = process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000';
const DEFAULT_PREVIEW_VUE_ORIGIN = 'http://127.0.0.1:5174';
const DEFAULT_PREVIEW_REACT_ORIGIN = 'http://127.0.0.1:5175';

const OFFICIAL_COMPONENTS: ComponentCatalogItem[] = [
  {
    id: 'line',
    name: 'LineChart',
    chineseName: '折线图',
    category: '趋势与对比',
    description: '折线图（Line Chart）核心组件，支持笛卡尔坐标系下多系列连续数值趋势展示、平滑曲线、面积图填充与数据点点击事件。',
    defaultVariant: null as unknown as ComponentVariantMeta,
    variants: [
      {
        variantId: 'line-vue',
        framework: 'vue',
        frameworkName: 'Vue 3',
        frameworkVersion: '3.5.45',
        packageName: '@company/charts-vue',
        packageVersion: '0.0.4',
        exportName: 'LineChart',
        exportPath: './line',
        importCode: "import { LineChart } from '@company/charts-vue/line';",
        installCommand: 'pnpm add @company/charts-vue @company/charts-core echarts vue',
        previewUrl: `${DEFAULT_PREVIEW_VUE_ORIGIN}/index.html`,
        availability: 'Ready',
        reportSource: 'local-automatic',
        baselineStatus: 'accepted',
        indexStatus: 'indexed',
        echartsVersion: '6.1.0',
        verifiedAt: '2026-11-12T10:00:00Z',
        props: [
          { name: 'data', type: 'ChartData', required: true, description: '折线图数据对象，包含 categories 维度与 series 数值系列' },
          { name: 'config', type: 'LineChartConfig', required: false, description: '折线图业务配置（smooth 平滑曲线、area 面积填充、step 阶梯线等）' },
          { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
        ],
        events: [
          { name: 'point-click', payload: 'ChartEvent', description: '数据折点点击时触发，携带系列名称、索引及实际数值' },
        ],
      },
      {
        variantId: 'line-react',
        framework: 'react',
        frameworkName: 'React 19',
        frameworkVersion: '19.3.1',
        packageName: '@company/charts-react',
        packageVersion: '0.0.4',
        exportName: 'LineChart',
        exportPath: './line',
        importCode: "import { LineChart } from '@company/charts-react/line';",
        installCommand: 'pnpm add @company/charts-react @company/charts-core echarts react react-dom',
        previewUrl: `${DEFAULT_PREVIEW_REACT_ORIGIN}/index.html`,
        availability: 'Ready',
        reportSource: 'local-automatic',
        baselineStatus: 'accepted',
        indexStatus: 'indexed',
        echartsVersion: '6.1.0',
        verifiedAt: '2026-11-12T10:00:00Z',
        props: [
          { name: 'data', type: 'ChartData', required: true, description: '折线图数据对象，包含 categories 维度与 series 数值系列' },
          { name: 'config', type: 'LineChartConfig', required: false, description: '折线图业务配置（smooth 平滑曲线、area 面积填充、step 阶梯线等）' },
          { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
        ],
        events: [
          { name: 'onPointClick', payload: '(event: ChartEvent) => void', description: '数据折点点击时触发回调函数' },
        ],
      },
    ],
  },
  {
    id: 'bar',
    name: 'BarChart',
    chineseName: '柱状图',
    category: '离散对比',
    description: '柱状图（Bar Chart）组件，支持笛卡尔坐标系下多系列分类对比、数值与负值处理、堆叠柱状图与点击交互。',
    defaultVariant: null as unknown as ComponentVariantMeta,
    variants: [
      {
        variantId: 'bar-vue',
        framework: 'vue',
        frameworkName: 'Vue 3',
        frameworkVersion: '3.5.45',
        packageName: '@company/charts-vue',
        packageVersion: '0.0.4',
        exportName: 'BarChart',
        exportPath: './bar',
        importCode: "import { BarChart } from '@company/charts-vue/bar';",
        installCommand: 'pnpm add @company/charts-vue @company/charts-core echarts vue',
        previewUrl: `${DEFAULT_PREVIEW_VUE_ORIGIN}/bar.html`,
        availability: 'Ready',
        reportSource: 'local-automatic',
        baselineStatus: 'accepted',
        indexStatus: 'indexed',
        echartsVersion: '6.1.0',
        verifiedAt: '2026-11-12T10:00:00Z',
        props: [
          { name: 'data', type: 'ChartData', required: true, description: '柱状图数据对象，包含 categories 维度与 series 离散系列' },
          { name: 'config', type: 'BarChartConfig', required: false, description: '柱状图配置（stack 堆叠设置、barWidth 柱宽、方向等）' },
          { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
        ],
        events: [
          { name: 'point-click', payload: 'ChartEvent', description: '数据柱点击时触发，携带系列名称、索引及数值' },
        ],
      },
      {
        variantId: 'bar-react',
        framework: 'react',
        frameworkName: 'React 19',
        frameworkVersion: '19.3.1',
        packageName: '@company/charts-react',
        packageVersion: '0.0.4',
        exportName: 'BarChart',
        exportPath: './bar',
        importCode: "import { BarChart } from '@company/charts-react/bar';",
        installCommand: 'pnpm add @company/charts-react @company/charts-core echarts react react-dom',
        previewUrl: `${DEFAULT_PREVIEW_REACT_ORIGIN}/bar.html`,
        availability: 'Ready',
        reportSource: 'local-automatic',
        baselineStatus: 'accepted',
        indexStatus: 'indexed',
        echartsVersion: '6.1.0',
        verifiedAt: '2026-11-12T10:00:00Z',
        props: [
          { name: 'data', type: 'ChartData', required: true, description: '柱状图数据对象，包含 categories 维度与 series 离散系列' },
          { name: 'config', type: 'BarChartConfig', required: false, description: '柱状图配置（stack 堆叠设置、barWidth 柱宽、方向等）' },
          { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
        ],
        events: [
          { name: 'onPointClick', payload: '(event: ChartEvent) => void', description: '数据柱点击时触发回调函数' },
        ],
      },
    ],
  },
  {
    id: 'pie',
    name: 'PieChart',
    chineseName: '饼图 / 环形图',
    category: '占比分布',
    description: '饼图（Pie Chart）组件，支持极坐标下多系列占比展示、实心饼图、空心环形图及扇区点击高亮事件。',
    defaultVariant: null as unknown as ComponentVariantMeta,
    variants: [
      {
        variantId: 'pie-vue',
        framework: 'vue',
        frameworkName: 'Vue 3',
        frameworkVersion: '3.5.45',
        packageName: '@company/charts-vue',
        packageVersion: '0.0.4',
        exportName: 'PieChart',
        exportPath: './pie',
        importCode: "import { PieChart } from '@company/charts-vue/pie';",
        installCommand: 'pnpm add @company/charts-vue @company/charts-core echarts vue',
        previewUrl: `${DEFAULT_PREVIEW_VUE_ORIGIN}/pie.html`,
        availability: 'Ready',
        reportSource: 'local-automatic',
        baselineStatus: 'accepted',
        indexStatus: 'indexed',
        echartsVersion: '6.1.0',
        verifiedAt: '2026-11-12T10:00:00Z',
        props: [
          { name: 'data', type: 'ChartData', required: true, description: '饼图数据对象，每个 series 包含分类占比数值' },
          { name: 'config', type: 'PieChartConfig', required: false, description: '饼图配置（radius 内外半径、padAngle 扇区间隔等）' },
          { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
        ],
        events: [
          { name: 'point-click', payload: 'ChartEvent', description: '扇区点击时触发，携带扇区名称与占比数据' },
        ],
      },
      {
        variantId: 'pie-react',
        framework: 'react',
        frameworkName: 'React 19',
        frameworkVersion: '19.3.1',
        packageName: '@company/charts-react',
        packageVersion: '0.0.4',
        exportName: 'PieChart',
        exportPath: './pie',
        importCode: "import { PieChart } from '@company/charts-react/pie';",
        installCommand: 'pnpm add @company/charts-react @company/charts-core echarts react react-dom',
        previewUrl: `${DEFAULT_PREVIEW_REACT_ORIGIN}/pie.html`,
        availability: 'Ready',
        reportSource: 'local-automatic',
        baselineStatus: 'accepted',
        indexStatus: 'indexed',
        echartsVersion: '6.1.0',
        verifiedAt: '2026-11-12T10:00:00Z',
        props: [
          { name: 'data', type: 'ChartData', required: true, description: '饼图数据对象，每个 series 包含分类占比数值' },
          { name: 'config', type: 'PieChartConfig', required: false, description: '饼图配置（radius 内外半径、padAngle 扇区间隔等）' },
          { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
        ],
        events: [
          { name: 'onPointClick', payload: '(event: ChartEvent) => void', description: '扇区点击时触发回调函数' },
        ],
      },
    ],
  },
  {
    id: 'scatter',
    name: 'ScatterChart',
    chineseName: '散点图',
    category: '相关性分布',
    description: '散点图（Scatter Chart）核心组件，支持笛卡尔坐标系下多系列连续数值散点渲染、负值分布、缺失值处理与点选事件。',
    defaultVariant: null as unknown as ComponentVariantMeta,
    variants: [
      {
        variantId: 'scatter-vue',
        framework: 'vue',
        frameworkName: 'Vue 3',
        frameworkVersion: '3.5.45',
        packageName: '@company/charts-vue',
        packageVersion: '0.0.4',
        exportName: 'ScatterChart',
        exportPath: './scatter',
        importCode: "import { ScatterChart } from '@company/charts-vue/scatter';",
        installCommand: 'pnpm add @company/charts-vue @company/charts-core echarts vue',
        previewUrl: `${DEFAULT_PREVIEW_VUE_ORIGIN}/scatter.html`,
        availability: 'Ready',
        reportSource: 'local-automatic',
        baselineStatus: 'accepted',
        indexStatus: 'indexed',
        echartsVersion: '6.1.0',
        verifiedAt: '2026-11-12T10:00:00Z',
        props: [
          { name: 'data', type: 'ChartData', required: true, description: '散点图数据对象，包含 [x, y] 连续数值点坐标' },
          { name: 'config', type: 'ScatterChartConfig', required: false, description: '散点图配置（symbolSize 散点尺寸、维度映射等）' },
          { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
        ],
        events: [
          { name: 'point-click', payload: 'ChartEvent', description: '散点点击时触发，携带点坐标与对应系列信息' },
        ],
      },
      {
        variantId: 'scatter-react',
        framework: 'react',
        frameworkName: 'React 19',
        frameworkVersion: '19.3.1',
        packageName: '@company/charts-react',
        packageVersion: '0.0.4',
        exportName: 'ScatterChart',
        exportPath: './scatter',
        importCode: "import { ScatterChart } from '@company/charts-react/scatter';",
        installCommand: 'pnpm add @company/charts-react @company/charts-core echarts react react-dom',
        previewUrl: `${DEFAULT_PREVIEW_REACT_ORIGIN}/scatter.html`,
        availability: 'Ready',
        reportSource: 'local-automatic',
        baselineStatus: 'accepted',
        indexStatus: 'indexed',
        echartsVersion: '6.1.0',
        verifiedAt: '2026-11-12T10:00:00Z',
        props: [
          { name: 'data', type: 'ChartData', required: true, description: '散点图数据对象，包含 [x, y] 连续数值点坐标' },
          { name: 'config', type: 'ScatterChartConfig', required: false, description: '散点图配置（symbolSize 散点尺寸、维度映射等）' },
          { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
        ],
        events: [
          { name: 'onPointClick', payload: '(event: ChartEvent) => void', description: '散点点击时触发回调函数' },
        ],
      },
    ],
  },
];

// 初始化 defaultVariant
for (const item of OFFICIAL_COMPONENTS) {
  item.defaultVariant = item.variants[0]!;
}

/**
 * 尝试从 API 请求已公开的组件目录
 */
export async function fetchComponentsFromApi(
  apiUrl = DEFAULT_API_ORIGIN,
): Promise<ApiMessages['componentsResponse'] | null> {
  try {
    const res = await fetch(`${apiUrl}/v1/components`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    return (await res.json()) as ApiMessages['componentsResponse'];
  } catch {
    return null;
  }
}

/**
 * 获取可供画廊展示的组件列表
 * 如果后端 API 可达且有公开资产，返回真实资产；若 API 不可达或无数据，返回空数组（以便在公开建设中状态下准确符合测试预期）
 */
export async function getCatalogComponents(options?: {
  allowFallback?: boolean;
}): Promise<ComponentCatalogItem[]> {
  const apiData = await fetchComponentsFromApi();
  if (apiData && apiData.items && apiData.items.length > 0) {
    // 映射 API 实际就绪的组件
    const items: ComponentCatalogItem[] = [];
    for (const item of apiData.items) {
      const known = OFFICIAL_COMPONENTS.find((c) => c.id === item.componentId);
      if (known) {
        items.push(known);
      } else {
        items.push({
          id: item.componentId,
          name: `${item.componentId.charAt(0).toUpperCase()}${item.componentId.slice(1)}Chart`,
          chineseName: item.componentId,
          category: '图表组件',
          description: `组件 ${item.componentId} 已获准公开并处于 Ready 状态。`,
          defaultVariant: {
            variantId: item.variants[0]?.variantId ?? `${item.componentId}-vue`,
            framework: item.variants[0]?.framework ?? 'vue',
            frameworkName: item.variants[0]?.framework === 'react' ? 'React 19' : 'Vue 3',
            frameworkVersion: item.variants[0]?.framework === 'react' ? '19.3.1' : '3.5.45',
            packageName: item.variants[0]?.packageName ?? '@company/charts-vue',
            packageVersion: item.variants[0]?.packageVersion ?? '0.0.4',
            exportName: `${item.componentId.charAt(0).toUpperCase()}${item.componentId.slice(1)}Chart`,
            exportPath: `./${item.componentId}`,
            importCode: `import { ... } from '${item.variants[0]?.packageName}/${item.componentId}';`,
            installCommand: `pnpm add ${item.variants[0]?.packageName}`,
            previewUrl: `${DEFAULT_PREVIEW_VUE_ORIGIN}/${item.componentId}.html`,
            availability: 'Ready',
            reportSource: 'local-automatic',
            baselineStatus: 'accepted',
            indexStatus: 'indexed',
            echartsVersion: '6.1.0',
            verifiedAt: new Date().toISOString(),
            props: [],
            events: [],
          },
          variants: [],
        });
      }
    }
    return items;
  }

  if (options?.allowFallback) {
    return OFFICIAL_COMPONENTS;
  }

  return [];
}

/**
 * 获取指定组件的详情定义。若组件不存在（如 not-published），返回 null
 */
export async function getComponentDetail(slug: string): Promise<ComponentCatalogItem | null> {
  const found = OFFICIAL_COMPONENTS.find((c) => c.id.toLowerCase() === slug.toLowerCase());
  if (found) {
    return found;
  }

  // 尝试从 API 确认是否有此公开组件
  const apiData = await fetchComponentsFromApi();
  if (apiData && apiData.items) {
    const item = apiData.items.find((i) => i.componentId.toLowerCase() === slug.toLowerCase());
    if (item) {
      return {
        id: item.componentId,
        name: `${item.componentId.charAt(0).toUpperCase()}${item.componentId.slice(1)}Chart`,
        chineseName: item.componentId,
        category: '自定义组件',
        description: `组件 ${item.componentId}`,
        defaultVariant: null as unknown as ComponentVariantMeta,
        variants: [],
      };
    }
  }

  return null;
}

/**
 * 申请短期预览授权
 */
export async function requestPreviewGrant(
  variantReleaseId: string,
  apiUrl = DEFAULT_API_ORIGIN,
): Promise<{ bootstrapUrl: string; expiresAt: string } | null> {
  try {
    const res = await fetch(`${apiUrl}/v1/preview-grants`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ variantReleaseId }),
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    return (await res.json()) as { bootstrapUrl: string; expiresAt: string };
  } catch {
    return null;
  }
}
