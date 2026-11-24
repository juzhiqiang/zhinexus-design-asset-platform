import { validateApiMessage, type ApiMessages, type Framework } from '@company/contracts';
import type { ComponentCatalogItem, ComponentEventSpec, ComponentPropSpec, ComponentVariantMeta } from './types.js';

const DEFAULT_API_ORIGIN = (process.env.NEXT_PUBLIC_PLATFORM_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');

type DisplayEnhancement = {
  name: string;
  chineseName: string;
  category: string;
  description: string;
  props: ComponentPropSpec[];
  events: Record<Framework, ComponentEventSpec[]>;
};

/**
 * 静态显示增强元数据：仅用于补充中文名、分类、描述与 API 文档说明。
 * 严禁包含或伪造 availability / reportSource / baselineStatus / indexStatus / packageVersion 等实时发布状态。
 */
const COMPONENT_DISPLAY_METADATA: Record<string, DisplayEnhancement> = {
  line: {
    name: 'LineChart',
    chineseName: '折线图',
    category: '趋势与对比',
    description: '折线图（Line Chart）核心组件，支持笛卡尔坐标系下多系列连续数值趋势展示、平滑曲线、面积图填充与数据点点击事件。',
    props: [
      { name: 'data', type: 'ChartData', required: true, description: '折线图数据对象，包含 categories 维度与 series 数值系列' },
      { name: 'config', type: 'LineChartConfig', required: false, description: '折线图业务配置（smooth 平滑曲线、area 面积填充、step 阶梯线等）' },
      { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
    ],
    events: {
      vue: [{ name: 'point-click', payload: 'ChartEvent', description: '数据折点点击时触发，携带系列名称、索引及实际数值' }],
      react: [{ name: 'onPointClick', payload: '(event: ChartEvent) => void', description: '数据折点点击时触发回调函数' }],
    },
  },
  bar: {
    name: 'BarChart',
    chineseName: '柱状图',
    category: '离散对比',
    description: '柱状图（Bar Chart）组件，支持笛卡尔坐标系下多系列分类对比、数值与负值处理、堆叠柱状图与点击交互。',
    props: [
      { name: 'data', type: 'ChartData', required: true, description: '柱状图数据对象，包含 categories 维度与 series 离散系列' },
      { name: 'config', type: 'BarChartConfig', required: false, description: '柱状图配置（stack 堆叠设置、barWidth 柱宽、方向等）' },
      { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
    ],
    events: {
      vue: [{ name: 'point-click', payload: 'ChartEvent', description: '数据柱点击时触发，携带系列名称、索引及数值' }],
      react: [{ name: 'onPointClick', payload: '(event: ChartEvent) => void', description: '数据柱点击时触发回调函数' }],
    },
  },
  pie: {
    name: 'PieChart',
    chineseName: '饼图 / 环形图',
    category: '占比分布',
    description: '饼图（Pie Chart）组件，支持极坐标下多系列占比展示、实心饼图、空心环形图及扇区点击高亮事件。',
    props: [
      { name: 'data', type: 'ChartData', required: true, description: '饼图数据对象，每个 series 包含分类占比数值' },
      { name: 'config', type: 'PieChartConfig', required: false, description: '饼图配置（radius 内外半径、padAngle 扇区间隔等）' },
      { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
    ],
    events: {
      vue: [{ name: 'point-click', payload: 'ChartEvent', description: '扇区点击时触发，携带扇区名称与占比数据' }],
      react: [{ name: 'onPointClick', payload: '(event: ChartEvent) => void', description: '扇区点击时触发回调函数' }],
    },
  },
  scatter: {
    name: 'ScatterChart',
    chineseName: '散点图',
    category: '相关性分布',
    description: '散点图（Scatter Chart）核心组件，支持笛卡尔坐标系下多系列连续数值散点渲染、负值分布、缺失值处理与点选事件。',
    props: [
      { name: 'data', type: 'ChartData', required: true, description: '散点图数据对象，包含 [x, y] 连续数值点坐标' },
      { name: 'config', type: 'ScatterChartConfig', required: false, description: '散点图配置（symbolSize 散点尺寸、维度映射等）' },
      { name: 'optionOverrides', type: 'EChartsOption', required: false, description: 'ECharts 原生底层 Option 覆盖选项' },
    ],
    events: {
      vue: [{ name: 'point-click', payload: 'ChartEvent', description: '散点点击时触发，携带点坐标与对应系列信息' }],
      react: [{ name: 'onPointClick', payload: '(event: ChartEvent) => void', description: '散点点击时触发回调函数' }],
    },
  },
};

export function getDisplayEnhancement(componentId: string): DisplayEnhancement | undefined {
  return COMPONENT_DISPLAY_METADATA[componentId.toLowerCase()];
}

export type CatalogRequestOptions = {
  apiUrl?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
};

function defaultExportName(componentId: string): string {
  return `${componentId.charAt(0).toUpperCase()}${componentId.slice(1)}Chart`;
}

function buildInstallCommand(framework: Framework, packageName: string, packageVersion: string): string {
  return framework === 'vue'
    ? `pnpm add ${packageName}@${packageVersion}`
    : `pnpm add ${packageName}@${packageVersion}`;
}

/**
 * 从公开目录 API 获取已获准公开的组件列表。失败、超时或契约不合法返回 null，绝不造假。
 */
export async function fetchComponentsFromApi(
  options: CatalogRequestOptions = {},
): Promise<ApiMessages['componentsResponse'] | null> {
  const apiUrl = (options.apiUrl ?? DEFAULT_API_ORIGIN).replace(/\/$/, '');
  const fetcher = options.fetcher ?? fetch;
  try {
    const timeout = AbortSignal.timeout(1500);
    const res = await fetcher(`${apiUrl}/v1/components`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    if (!res.ok) return null;
    const parsed = validateApiMessage('componentsResponse', await res.json());
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

async function fetchPublicVariantRelease(
  variantReleaseId: string,
  options: CatalogRequestOptions = {},
): Promise<ApiMessages['variantReleaseResponse'] | null> {
  const apiUrl = (options.apiUrl ?? DEFAULT_API_ORIGIN).replace(/\/$/, '');
  const fetcher = options.fetcher ?? fetch;
  try {
    const timeout = AbortSignal.timeout(1500);
    const res = await fetcher(`${apiUrl}/v1/variant-releases/${encodeURIComponent(variantReleaseId)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    if (!res.ok) return null;
    const parsed = validateApiMessage('variantReleaseResponse', await res.json());
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

/**
 * 获取公开组件目录：完全由真实公开 API 决定资产与版本；空结果或 API 故障返回空数组，不造假数据。
 */
export async function getCatalogComponents(
  options: CatalogRequestOptions = {},
): Promise<ComponentCatalogItem[]> {
  const apiData = await fetchComponentsFromApi(options);
  if (!apiData || apiData.items.length === 0) {
    return [];
  }

  const items: ComponentCatalogItem[] = [];
  for (const item of apiData.items) {
    if (item.variants.length === 0) continue;
    const display = getDisplayEnhancement(item.componentId);
    const variants: ComponentVariantMeta[] = item.variants.map((summary) => {
      const exportName = display?.name ?? defaultExportName(item.componentId);
      const exportPath = `./${item.componentId}`;
      return {
        variantReleaseId: summary.variantReleaseId,
        variantId: summary.variantId,
        framework: summary.framework,
        frameworkName: summary.framework === 'react' ? 'React 19' : 'Vue 3',
        packageName: summary.packageName,
        packageVersion: summary.packageVersion,
        exportName,
        exportPath,
        importCode: `import { ${exportName} } from '${summary.packageName}/${item.componentId}';`,
        installCommand: buildInstallCommand(summary.framework, summary.packageName, summary.packageVersion),
        props: display?.props ?? [],
        events: display?.events[summary.framework] ?? [],
      };
    });

    items.push({
      id: item.componentId,
      name: display?.name ?? defaultExportName(item.componentId),
      chineseName: display?.chineseName ?? item.componentId,
      category: display?.category ?? '组件资产',
      description: display?.description ?? `公开组件资产 ${item.componentId}。`,
      defaultVariant: variants[0]!,
      variants,
    });
  }

  return items;
}

/**
 * 获取公开组件详情：必须经真实公开 API 确认存在并拉取每个变体的真实发布状态；
 * 未公开、不存在或 API 不可达时返回 null（页面返回 404），严禁静态详情绕过 API。
 */
export async function getComponentDetail(
  slug: string,
  options: CatalogRequestOptions = {},
): Promise<ComponentCatalogItem | null> {
  const apiData = await fetchComponentsFromApi(options);
  if (!apiData || apiData.items.length === 0) {
    return null;
  }

  const item = apiData.items.find((entry) => entry.componentId.toLowerCase() === slug.toLowerCase());
  if (!item || item.variants.length === 0) {
    return null;
  }

  const display = getDisplayEnhancement(item.componentId);
  const details = await Promise.all(
    item.variants.map((summary) => fetchPublicVariantRelease(summary.variantReleaseId, options)),
  );

  const variants: ComponentVariantMeta[] = [];
  for (let i = 0; i < item.variants.length; i += 1) {
    const summary = item.variants[i]!;
    const detail = details[i];
    if (!detail) continue;
    if (
      detail.variantReleaseId !== summary.variantReleaseId ||
      detail.variant.componentId !== item.componentId ||
      detail.variant.variantId !== summary.variantId ||
      detail.variant.framework !== summary.framework ||
      detail.variant.packageName !== summary.packageName ||
      detail.variant.packageVersion !== summary.packageVersion ||
      detail.package.name !== summary.packageName ||
      detail.package.version !== summary.packageVersion
    ) {
      continue;
    }

    const peerFrameworkVersion = summary.framework === 'vue'
      ? detail.package.peerDependencies.vue
      : detail.package.peerDependencies.react;
    const peerEchartsVersion = detail.package.peerDependencies.echarts;
    const cleanSubpath = detail.variant.exportPath.replace(/^\.\//, '');
    const importSpecifier = cleanSubpath && cleanSubpath !== '.'
      ? `${detail.package.name}/${cleanSubpath}`
      : detail.package.name;

    variants.push({
      variantReleaseId: detail.variantReleaseId,
      variantId: detail.variant.variantId,
      framework: detail.variant.framework,
      frameworkName: detail.variant.framework === 'react' ? 'React 19' : 'Vue 3',
      ...(peerFrameworkVersion ? { frameworkVersion: peerFrameworkVersion } : {}),
      packageName: detail.package.name,
      packageVersion: detail.package.version,
      exportName: detail.variant.exportName,
      exportPath: detail.variant.exportPath,
      importCode: `import { ${detail.variant.exportName} } from '${importSpecifier}';`,
      installCommand: buildInstallCommand(detail.variant.framework, detail.package.name, detail.package.version),
      availability: detail.availability,
      reportSource: detail.reportSource,
      baselineStatus: detail.baselineStatus,
      indexStatus: detail.indexStatus,
      ...(peerEchartsVersion ? { echartsVersion: peerEchartsVersion } : {}),
      props: display?.props ?? [],
      events: display?.events[detail.variant.framework] ?? [],
    });
  }

  if (variants.length === 0) {
    return null;
  }

  return {
    id: item.componentId,
    name: display?.name ?? variants[0]!.exportName,
    chineseName: display?.chineseName ?? item.componentId,
    category: display?.category ?? '组件资产',
    description: display?.description ?? `公开组件资产 ${item.componentId}。`,
    defaultVariant: variants[0]!,
    variants,
  };
}
