import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type RegistryConfig = {
  uplinks: Record<string, { url: string; timeout?: string; auth?: unknown; headers?: unknown }>;
  packages: Record<string, { access: string | string[]; publish: string | string[]; unpublish: string[]; proxy?: string }>;
};

const config = (relative: string): RegistryConfig => parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as RegistryConfig;

describe('T16 本地注册表冷缓存下载边界', () => {
  it('为真实 Next 与 SWC 大包保留有界五分钟上游请求窗口', () => {
    const local = config('../acceptance/t16-registry.yaml');
    expect(local.uplinks).toEqual({ npmjs: { url: 'https://registry.npmjs.org/', timeout: '5m' } });
  });

  it('延长传输窗口保持私有 SDK 路由、上游无凭证与共享注册表关闭', () => {
    const local = config('../acceptance/t16-registry.yaml');
    expect(local.packages['@company/*']).toEqual({
      access: 'g2reader g2publisher', publish: 'g2publisher', unpublish: [],
    });
    expect(local.packages['**']).toEqual({
      access: 'g2reader g2publisher', publish: [], unpublish: [], proxy: 'npmjs',
    });
    expect(local.uplinks.npmjs?.auth).toBeUndefined();
    expect(local.uplinks.npmjs?.headers).toBeUndefined();
    const shared = config('../../infra/verdaccio/config.yaml');
    expect(shared.uplinks).toEqual({});
    expect(shared.packages['**']).toEqual({ access: [], publish: [], unpublish: [] });
  });
});
