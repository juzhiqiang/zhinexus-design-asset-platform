import { describe, expect, it } from 'vitest';
import {
  CandidateError,
  hasDualFrameworkCoverage,
  candidateSatisfiesPeer,
  compareVersions,
  isExactVersion,
  isPrerelease,
  recommend,
  resolveCandidate,
  verifyCandidate,
  type CombinationProbe,
  type RegistrySnapshot,
  type SupportedCombination,
} from '../../packages/charts-core/src/engine/compatibility.js';

/**
 * T10 SDK 侧策略测试（先红后绿）。
 *
 * 这些用例锁定的是「不扩大未验证的支持范围」这一类纪律，而不是某个具体版本的
 * 兼容结论：候选失败不得扩大 peer 范围、latest 命中预发布必须拒绝、共享核心变化
 * 必须同时覆盖 Vue 与 React、registry 代理与官方源不一致必须留痕。
 */

const OFFICIAL: RegistrySnapshot = {
  source: 'https://registry.npmjs.org/echarts',
  latest: '6.1.0',
  versions: {
    '6.0.0': { integrity: 'sha512-Tte/grDQRiETQP4xz3iZWSvoHrkCQtwqd6hs+mifXcjrCuo2iKWbajFObuLJVBlDIJlOzgQPd1hsaKt/3+OMkQ==' },
    '6.1.0': { integrity: 'sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==' },
  },
};

const PRERELEASE_LATEST: RegistrySnapshot = {
  ...OFFICIAL,
  latest: '6.2.0-rc.1',
  versions: {
    ...OFFICIAL.versions,
    '6.2.0-rc.1': { integrity: 'sha512-prerelease' },
  },
};

const VUE: SupportedCombination = {
  framework: 'vue',
  frameworkVersion: '3.5.45',
  echartsVersion: '6.1.0',
};
const REACT: SupportedCombination = {
  framework: 'react',
  frameworkVersion: '19.3.1',
  echartsVersion: '6.1.0',
};
const SUPPORTED: readonly SupportedCombination[] = [VUE, REACT];

function passedProbe(): CombinationProbe {
  return async () => ({
    typecheck: 'passed',
    runtime: 'passed',
    interaction: 'passed',
    visual: 'passed',
    differences: [],
  });
}

describe('版本字面量判定', () => {
  it('只接受 x.y.z 精确版本', () => {
    expect(isExactVersion('6.1.0')).toBe(true);
    expect(isExactVersion('6.0.0')).toBe(true);
    expect(isExactVersion('10.20.30')).toBe(true);
  });

  it('拒绝范围、通配与 latest 字面量', () => {
    for (const input of ['^6.1.0', '~6.1.0', '>=6.1.0', '6.x', '6.1.*', '*', 'latest', '6.1', 'v6.1.0', '']) {
      expect(isExactVersion(input), input).toBe(false);
    }
  });

  it('识别预发布版本', () => {
    expect(isPrerelease('6.2.0-rc.1')).toBe(true);
    expect(isPrerelease('6.2.0-beta.2')).toBe(true);
    expect(isPrerelease('6.1.0')).toBe(false);
    expect(isPrerelease('6.1.0+build.5')).toBe(false);
  });

  it('按数值段比较版本，不按字符串', () => {
    expect(compareVersions('6.1.0', '6.0.0')).toBeGreaterThan(0);
    expect(compareVersions('6.0.0', '6.1.0')).toBeLessThan(0);
    expect(compareVersions('6.1.0', '6.1.0')).toBe(0);
    // 10.0.0 必须大于 9.0.0：字符串比较会得到相反结果
    expect(compareVersions('10.0.0', '9.0.0')).toBeGreaterThan(0);
  });
});

describe('resolveCandidate', () => {
  it('latest 解析为官方源当天的最新稳定版并带上完整性与发布说明来源', () => {
    const candidate = resolveCandidate('latest', OFFICIAL);
    expect(candidate.version).toBe('6.1.0');
    expect(candidate.integrity).toBe(OFFICIAL.versions['6.1.0']!.integrity);
    expect(candidate.releaseNotesSource).toContain('6.1.0');
    expect(candidate.source).toBe(OFFICIAL.source);
  });

  it('显式精确版本直接采用，不回退到 latest', () => {
    const candidate = resolveCandidate('6.0.0', OFFICIAL);
    expect(candidate.version).toBe('6.0.0');
    expect(candidate.integrity).toBe(OFFICIAL.versions['6.0.0']!.integrity);
  });

  it('latest 命中预发布时拒绝，不把预发布当候选', () => {
    expect(() => resolveCandidate('latest', PRERELEASE_LATEST)).toThrowError(CandidateError);
    try {
      resolveCandidate('latest', PRERELEASE_LATEST);
      expect.unreachable('应当抛出 CandidateError');
    } catch (error) {
      expect((error as CandidateError).reason).toBe('prerelease');
    }
  });

  it('显式请求预发布版本同样拒绝', () => {
    try {
      resolveCandidate('6.2.0-rc.1', PRERELEASE_LATEST);
      expect.unreachable('应当抛出 CandidateError');
    } catch (error) {
      expect((error as CandidateError).reason).toBe('prerelease');
    }
  });

  it('拒绝非精确版本字面量', () => {
    for (const input of ['^6.1.0', '6.x', 'latest ', '6.1']) {
      try {
        resolveCandidate(input, OFFICIAL);
        expect.unreachable(`应当拒绝 ${input}`);
      } catch (error) {
        expect(error).toBeInstanceOf(CandidateError);
      }
    }
  });

  it('官方源里不存在的版本拒绝，不静默落到 latest', () => {
    try {
      resolveCandidate('5.6.0', OFFICIAL);
      expect.unreachable('应当抛出 CandidateError');
    } catch (error) {
      expect((error as CandidateError).reason).toBe('unknown-version');
    }
  });
});

describe('peer 符合性', () => {
  it('候选与 peerDependencies 精确一致时符合', () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    expect(candidateSatisfiesPeer(candidate, { echarts: '6.1.0' })).toBe(true);
  });

  it('候选低于已锁定基线时不符合，且不因此扩大 peer 范围', () => {
    const candidate = resolveCandidate('6.0.0', OFFICIAL);
    expect(candidateSatisfiesPeer(candidate, { echarts: '6.1.0' })).toBe(false);
  });

  it('候选高于基线时同样不符合——只有实测通过才由人显式扩范围', () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    expect(candidateSatisfiesPeer(candidate, { echarts: '6.0.0' })).toBe(false);
  });
});

describe('verifyCandidate 报告', () => {
  it('全部组合四个维度都通过时才建议采纳', async () => {
    const report = await verifyCandidate(resolveCandidate('6.1.0', OFFICIAL), SUPPORTED, passedProbe());
    expect(report.results).toHaveLength(2);
    expect(report.peerSatisfied).toBe(true);
    expect(recommend(report, SUPPORTED)).toBe('adopt');
  });

  it('候选失败不扩大 peer 范围：报告保持 peerSatisfied=false 并建议保持', async () => {
    const candidate = resolveCandidate('6.0.0', OFFICIAL);
    const failing: CombinationProbe = async (combination) => ({
      typecheck: combination.framework === 'vue' ? 'failed' : 'passed',
      runtime: 'passed',
      interaction: 'passed',
      visual: 'passed',
      differences: ['Vue 侧类型不兼容'],
    });
    const report = await verifyCandidate(candidate, SUPPORTED, failing);

    expect(report.peerSatisfied).toBe(false);
    expect(recommend(report, SUPPORTED)).toBe('hold');
    // 报告本身不得给出任何「已扩大支持范围」的结论
    expect(report.supportedRangeUnchanged).toBe(true);
    expect(report.suggestedPeerRange).toBeUndefined();
  });

  it('共享核心变化必须同时验证双框架：缺任一框架即标记未完整覆盖', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const vueOnly: CombinationProbe = async (combination) =>
      combination.framework === 'vue'
        ? { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed', differences: [] }
        : { typecheck: 'not-run', runtime: 'not-run', interaction: 'not-run', visual: 'not-run', differences: [] };

    const report = await verifyCandidate(candidate, SUPPORTED, vueOnly);
    expect(hasDualFrameworkCoverage(report, SUPPORTED)).toBe(false);
    expect(recommend(report, SUPPORTED)).toBe('hold');
  });

  it('未运行的维度不得记为通过', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const partial: CombinationProbe = async () => ({
      typecheck: 'passed',
      runtime: 'passed',
      interaction: 'not-run',
      visual: 'not-run',
      differences: [],
    });
    const report = await verifyCandidate(candidate, SUPPORTED, partial);
    expect(recommend(report, SUPPORTED)).toBe('hold');
    expect(report.results.every((r) => r.interaction !== 'passed')).toBe(true);
  });

  it('视觉差异被显式记录，供人工基线确认', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const visualDiff: CombinationProbe = async (combination) => ({
      typecheck: 'passed',
      runtime: 'passed',
      interaction: 'passed',
      visual: 'failed',
      differences: [`${combination.framework} 柱状图标签位置偏移 2px`],
    });
    const report = await verifyCandidate(candidate, SUPPORTED, visualDiff);
    expect(recommend(report, SUPPORTED)).toBe('hold');
    expect(report.results.flatMap((r) => r.differences)).toHaveLength(2);
    expect(report.requiresVisualBaselineConfirmation).toBe(true);
  });
});

describe('registry 源差异', () => {
  it('代理缓存的 latest 落后于官方源时记录官方源与代理差异', () => {
    const proxy: RegistrySnapshot = {
      source: 'http://127.0.0.1:4873',
      latest: '6.0.0',
      versions: OFFICIAL.versions,
    };
    const officialCandidate = resolveCandidate('latest', OFFICIAL);
    const proxyCandidate = resolveCandidate('latest', proxy);
    expect(proxyCandidate.version).toBe('6.0.0');
    expect(proxyCandidate.source).not.toBe(officialCandidate.source);
  });

  it('代理缺 Integrity 时拒绝，不留无摘要的候选', () => {
    const noIntegrity: RegistrySnapshot = {
      ...OFFICIAL,
      versions: { '6.1.0': { integrity: '' } },
    };
    try {
      resolveCandidate('6.1.0', noIntegrity);
      expect.unreachable('应当抛出 CandidateError');
    } catch (error) {
      expect((error as CandidateError).reason).toBe('missing-integrity');
    }
  });
});
