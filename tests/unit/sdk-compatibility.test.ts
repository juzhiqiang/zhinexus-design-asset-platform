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
  type CompatibilityReport,
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

/**
 * 三个框架版本各不相同的精确组合：用于覆盖判定必须「按组合」而不是「按框架」。
 * Vue 出现两个版本（3.5.45 与 3.4.0），只按 framework 分组时后者会被前者掩盖。
 */
const MULTI_VUE: readonly SupportedCombination[] = [
  VUE,
  { framework: 'vue', frameworkVersion: '3.4.0', echartsVersion: '6.1.0' },
  REACT,
];

/** 混合 ECharts 基线：两个组合的基线版本不同。 */
const MIXED_BASELINE: readonly SupportedCombination[] = [
  VUE,
  { framework: 'react', frameworkVersion: '19.3.1', echartsVersion: '6.0.0' },
];

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
    // 报告本身不得给出任何「已扩大支持范围」的结论：字段集合固定，
    // 且不存在 suggestedPeerRange 之类能推出新支持范围的键
    expect(report.supportedRangeUnchanged).toBe(true);
    expect(Object.keys(report).sort()).toEqual([
      'baselineEchartsVersion',
      'candidate',
      'peerSatisfied',
      'requiresVisualBaselineConfirmation',
      'results',
      'supportedRangeUnchanged',
    ]);
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

/**
 * 以下三组锁定「报告必须与实测一致」这一类纪律。
 *
 * 2026-11-13 独立评审在 f35ebc9 上对 git 对象直接复现了三处误判，均为「报告自称
 * 验证了某件事、实际验的却是另一件事」，因此单独立项：探针拿到基线版本、覆盖判定
 * 只按框架、基线取首项。三者都会让 `recommend` 在缺少实测的情况下返回 `'adopt'`。
 */
describe('探针必须收到候选版本，而不是基线版本', () => {
  it('候选低于基线时，probe 收到候选 echartsVersion，实测行另行记录基线对照', async () => {
    const candidate = resolveCandidate('6.0.0', OFFICIAL);
    const seen: SupportedCombination[] = [];
    const probe: CombinationProbe = async (combination) => {
      seen.push(combination);
      return {
        typecheck: 'passed',
        runtime: 'passed',
        interaction: 'passed',
        visual: 'passed',
        differences: [],
      };
    };

    const report = await verifyCandidate(candidate, SUPPORTED, probe);

    // 探针拿到的必须是候选版本：否则「已验证 6.0.0」这句话是假的
    expect(seen.map((combination) => combination.echartsVersion)).toEqual(['6.0.0', '6.0.0']);
    // 实测行记录实际验证的版本（候选），且每行都能回查自己的基线
    expect(report.results.map((result) => result.echartsVersion)).toEqual(['6.0.0', '6.0.0']);
    expect(report.results.map((result) => result.baselineEchartsVersion)).toEqual([
      '6.1.0',
      '6.1.0',
    ]);
    expect(report.baselineEchartsVersion).toBe('6.1.0');
    expect(report.candidate.version).toBe('6.0.0');
  });

  it('框架与框架版本取自基线，不随候选改写', async () => {
    const candidate = resolveCandidate('6.0.0', OFFICIAL);
    const seen: SupportedCombination[] = [];
    const probe: CombinationProbe = async (combination) => {
      seen.push(combination);
      return {
        typecheck: 'passed',
        runtime: 'passed',
        interaction: 'passed',
        visual: 'passed',
        differences: [],
      };
    };

    await verifyCandidate(candidate, SUPPORTED, probe);

    expect(seen).toEqual([
      { framework: 'vue', frameworkVersion: '3.5.45', echartsVersion: '6.0.0' },
      { framework: 'react', frameworkVersion: '19.3.1', echartsVersion: '6.0.0' },
    ]);
  });

  it('候选与基线同版本时，实测行与基线一致', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    expect(report.results.map((result) => result.echartsVersion)).toEqual(['6.1.0', '6.1.0']);
    expect(report.results.map((result) => result.baselineEchartsVersion)).toEqual([
      '6.1.0',
      '6.1.0',
    ]);
  });
});

describe('覆盖判定按精确组合，不按框架', () => {
  it('supported 有三个精确组合而 results 只有两项时，不得判为完整覆盖', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const full = await verifyCandidate(candidate, MULTI_VUE, passedProbe());
    const partial: CompatibilityReport = {
      ...full,
      results: full.results.filter((result) => result.frameworkVersion !== '3.4.0'),
    };

    expect(partial.results).toHaveLength(2);
    expect(hasDualFrameworkCoverage(partial, MULTI_VUE)).toBe(false);
    expect(recommend(partial, MULTI_VUE)).toBe('hold');
  });

  it('results 的框架版本与 supported 不一致时，不得判为完整覆盖', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const full = await verifyCandidate(candidate, MULTI_VUE, passedProbe());
    const wrongVersion: CompatibilityReport = {
      ...full,
      results: full.results.map((result) =>
        result.frameworkVersion === '3.4.0' ? { ...result, frameworkVersion: '3.5.45' } : result,
      ),
    };

    expect(wrongVersion.results).toHaveLength(3);
    expect(hasDualFrameworkCoverage(wrongVersion, MULTI_VUE)).toBe(false);
    expect(recommend(wrongVersion, MULTI_VUE)).toBe('hold');
  });

  it('results 多出 supported 里没有的组合时，不得判为完整覆盖', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const full = await verifyCandidate(candidate, MULTI_VUE, passedProbe());
    const extra: CompatibilityReport = {
      ...full,
      results: [
        ...full.results,
        {
          framework: 'vue',
          frameworkVersion: '3.3.0',
          echartsVersion: '6.1.0',
          baselineEchartsVersion: '6.1.0',
          typecheck: 'passed',
          runtime: 'passed',
          interaction: 'passed',
          visual: 'passed',
          differences: [],
        },
      ],
    };

    expect(hasDualFrameworkCoverage(extra, MULTI_VUE)).toBe(false);
    expect(recommend(extra, MULTI_VUE)).toBe('hold');
  });

  it('supported 自身有重复组合时，不得判为完整覆盖', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const duplicated: readonly SupportedCombination[] = [VUE, VUE, REACT];
    const report = await verifyCandidate(candidate, duplicated, passedProbe());

    expect(report.results).toHaveLength(3);
    expect(hasDualFrameworkCoverage(report, duplicated)).toBe(false);
    expect(recommend(report, duplicated)).toBe('hold');
  });

  it('results 重复记录同一组合时，不得判为完整覆盖', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const full = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    const duplicated: CompatibilityReport = {
      ...full,
      results: [...full.results, full.results[0]!],
    };

    expect(hasDualFrameworkCoverage(duplicated, SUPPORTED)).toBe(false);
    expect(recommend(duplicated, SUPPORTED)).toBe('hold');
  });

  it('每个精确组合都实测且四维全过时，才判为完整覆盖', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, MULTI_VUE, passedProbe());

    expect(hasDualFrameworkCoverage(report, MULTI_VUE)).toBe(true);
    expect(recommend(report, MULTI_VUE)).toBe('adopt');
  });
});

describe('基线 ECharts 版本必须唯一', () => {
  it('混合 echarts 基线直接拒绝，不静默取首项', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    await expect(
      verifyCandidate(candidate, MIXED_BASELINE, passedProbe()),
    ).rejects.toThrow(/基线/);
  });

  it('拒绝与数组顺序无关', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    await expect(
      verifyCandidate(candidate, [MIXED_BASELINE[1]!, MIXED_BASELINE[0]!], passedProbe()),
    ).rejects.toThrow(/基线/);
  });

  it('候选 6.0.0 配混合基线同样拒绝，不因候选与其中一项相同就放行', async () => {
    const candidate = resolveCandidate('6.0.0', OFFICIAL);
    await expect(
      verifyCandidate(candidate, MIXED_BASELINE, passedProbe()),
    ).rejects.toThrow(/基线/);
  });

  it('基线一致时才生成报告，且 peerSatisfied 与顺序无关', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const forward = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    const backward = await verifyCandidate(candidate, [REACT, VUE], passedProbe());

    expect(forward.peerSatisfied).toBe(true);
    expect(backward.peerSatisfied).toBe(true);
    expect(forward.baselineEchartsVersion).toBe(backward.baselineEchartsVersion);
    expect(recommend(forward, SUPPORTED)).toBe('adopt');
    expect(recommend(backward, [REACT, VUE])).toBe('adopt');
  });
});

/**
 * 第三轮复审（2026-11-13，C 对 `e2e27c9` 复现）：报告不得改写已支持范围。
 *
 * A. `peerFlagSelfConsistent` 只比较 `candidate.version` 与 `report.baselineEchartsVersion`
 *    ——两者都在报告里，攻击者（或一次错误的序列化/反序列化）可以一起改。于是一份
 *    候选 6.0.0、基线 6.1.0 的真实报告，只要把 `peerSatisfied` 与
 *    `baselineEchartsVersion` 一起伪造成 `true` / `6.0.0`，`recommend` 就返回 `'adopt'`。
 *    修复：报告基线必须**精确等于 `supported` 的唯一真实基线**，peer 由 supported 推导。
 *
 * B. 「双框架齐验」此前只要求「supported 里出现的每个组合都有实测」。当 `supported`
 *    本身只有一个框架（例如只有 Vue）时，条件被轻易满足，`recommend` 返回 `'adopt'`。
 *    但 `supported` 描述的是**当前已支持范围**，共享核心变化必须两个框架都验。
 */
describe('报告基线必须绑定 supported 唯一真实基线', () => {
  it('同时伪造 peerSatisfied 与 baselineEchartsVersion 不得骗取 adopt', async () => {
    const candidate = resolveCandidate('6.0.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    const forged: CompatibilityReport = {
      ...report,
      peerSatisfied: true,
      baselineEchartsVersion: '6.0.0',
    };

    // supported 的唯一真实基线仍是 6.1.0，与候选 6.0.0 不相等
    expect(SUPPORTED.every((c) => c.echartsVersion === '6.1.0')).toBe(true);
    expect(forged.baselineEchartsVersion).toBe('6.0.0');
    expect(hasDualFrameworkCoverage(forged, SUPPORTED)).toBe(false);
    expect(recommend(forged, SUPPORTED)).toBe('hold');
  });

  it('只伪造 baselineEchartsVersion 而保留 peerSatisfied 原值也不得放行', async () => {
    const candidate = resolveCandidate('6.0.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    const forged: CompatibilityReport = {
      ...report,
      peerSatisfied: false,
      baselineEchartsVersion: '6.0.0',
    };

    expect(hasDualFrameworkCoverage(forged, SUPPORTED)).toBe(false);
    expect(recommend(forged, SUPPORTED)).toBe('hold');
  });

  it('报告基线与 supported 唯一基线不符（哪怕方向相反）一律 hold', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    // supported 唯一基线 6.1.0，报告自称 6.0.0
    const forged: CompatibilityReport = { ...report, baselineEchartsVersion: '6.0.0' };

    expect(hasDualFrameworkCoverage(forged, SUPPORTED)).toBe(false);
    expect(recommend(forged, SUPPORTED)).toBe('hold');
  });

  it('报告基线与 supported 一致时才放行，且与报告数组顺序无关', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const forward = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    const backward = await verifyCandidate(candidate, [REACT, VUE], passedProbe());

    expect(recommend(forward, SUPPORTED)).toBe('adopt');
    expect(recommend(backward, [REACT, VUE])).toBe('adopt');
    expect(recommend(backward, SUPPORTED)).toBe('adopt');
  });
});

describe('共享核心变化必须双框架齐验', () => {
  it('supported 只有 Vue 一个框架时，即便四维全过也不得采纳', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const vueOnly: readonly SupportedCombination[] = [VUE];
    const report = await verifyCandidate(candidate, vueOnly, passedProbe());

    expect(report.results).toHaveLength(1);
    expect(report.results.every((r) => r.typecheck === 'passed')).toBe(true);
    expect(hasDualFrameworkCoverage(report, vueOnly)).toBe(false);
    expect(recommend(report, vueOnly)).toBe('hold');
  });

  it('supported 只有 React 一个框架时同样不得采纳', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const reactOnly: readonly SupportedCombination[] = [REACT];
    const report = await verifyCandidate(candidate, reactOnly, passedProbe());

    expect(hasDualFrameworkCoverage(report, reactOnly)).toBe(false);
    expect(recommend(report, reactOnly)).toBe('hold');
  });

  it('手工构造的「单框架全 passed」报告也不得采纳', () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const vueOnly: readonly SupportedCombination[] = [VUE];
    const report: CompatibilityReport = {
      candidate,
      peerSatisfied: true,
      baselineEchartsVersion: '6.1.0',
      supportedRangeUnchanged: true,
      requiresVisualBaselineConfirmation: false,
      results: [
        {
          ...VUE,
          echartsVersion: '6.1.0',
          baselineEchartsVersion: '6.1.0',
          typecheck: 'passed',
          runtime: 'passed',
          interaction: 'passed',
          visual: 'passed',
          differences: [],
        },
      ],
    };

    expect(hasDualFrameworkCoverage(report, vueOnly)).toBe(false);
    expect(recommend(report, vueOnly)).toBe('hold');
  });

  it('两个框架各至少一个精确组合且都实测时才采纳', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());

    expect(hasDualFrameworkCoverage(report, SUPPORTED)).toBe(true);
    expect(recommend(report, SUPPORTED)).toBe('adopt');
  });

  it('某框架的实测全是 not-run 时不得采纳', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const reactMissing: CombinationProbe = async (combination) =>
      combination.framework === 'react'
        ? { typecheck: 'not-run', runtime: 'not-run', interaction: 'not-run', visual: 'not-run', differences: [] }
        : { typecheck: 'passed', runtime: 'passed', interaction: 'passed', visual: 'passed', differences: [] };
    const report = await verifyCandidate(candidate, SUPPORTED, reactMissing);

    expect(hasDualFrameworkCoverage(report, SUPPORTED)).toBe(false);
    expect(recommend(report, SUPPORTED)).toBe('hold');
  });
});

/**
 * 复审遗漏（2026-11-13，C 对 `83ec74d` 用 tsx 复现）：`hasDualFrameworkCoverage`
 * 只用 `baselineEchartsVersion` 造键，没有校验**每行实际验的 echartsVersion**必须等于
 * `report.candidate.version`。于是一份全 passed 的报告，只把
 * `results[0].echartsVersion` 改成 `6.0.0`，`recommend` 仍是 `'adopt'`。
 *
 * 同类问题还有「盲信传入的 `peerSatisfied`」：报告自称 `peerSatisfied: true`，
 * 但 `candidate.version` 与 `baselineEchartsVersion` 并不相等时也放行。
 */
describe('实测行版本与 peer 标志必须自洽', () => {
  it('把某一行的 echartsVersion 改成非候选版本时，不得判为完整覆盖', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    const tampered: CompatibilityReport = {
      ...report,
      results: report.results.map((result, index) =>
        index === 0 ? { ...result, echartsVersion: '6.0.0' } : result,
      ),
    };

    expect(tampered.results[0]!.echartsVersion).toBe('6.0.0');
    expect(hasDualFrameworkCoverage(tampered, SUPPORTED)).toBe(false);
    expect(recommend(tampered, SUPPORTED)).toBe('hold');
  });

  it('每一行的 echartsVersion 都必须等于候选版本，不只第一行', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    const tampered: CompatibilityReport = {
      ...report,
      results: report.results.map((result, index) =>
        index === 1 ? { ...result, echartsVersion: '6.2.0' } : result,
      ),
    };

    expect(hasDualFrameworkCoverage(tampered, SUPPORTED)).toBe(false);
    expect(recommend(tampered, SUPPORTED)).toBe('hold');
  });

  it('篡改造出的假报告即便四维全过、无差异，也不得建议采纳', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    const tampered: CompatibilityReport = {
      ...report,
      results: report.results.map((result) => ({ ...result, echartsVersion: '6.0.0' })),
    };

    expect(tampered.results.every((r) => r.typecheck === 'passed')).toBe(true);
    expect(tampered.results.every((r) => r.differences.length === 0)).toBe(true);
    expect(recommend(tampered, SUPPORTED)).toBe('hold');
  });

  it('peerSatisfied 不可盲信：与 candidate/baseline 实际关系矛盾时不得采纳', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    // 自称 peer 符合，但候选 6.1.0 与基线 6.0.0 并不相等
    const lied: CompatibilityReport = { ...report, peerSatisfied: true, baselineEchartsVersion: '6.0.0' };

    expect(lied.peerSatisfied).toBe(true);
    expect(recommend(lied, SUPPORTED)).toBe('hold');
  });

  it('peerSatisfied 被伪造成 false 时不参与判定，仍以 supported 基线为准', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    // 0.1.0 起 peer 由 supported 唯一基线推导，报告里的 peerSatisfied 只是转述：
    // 伪造成 false 不应把一次真实通过的验证拖成 hold，也不应被伪造 true时放行。
    const liedFalse: CompatibilityReport = { ...report, peerSatisfied: false };
    const liedTrue: CompatibilityReport = { ...report, peerSatisfied: true };

    expect(recommend(liedFalse, SUPPORTED)).toBe('adopt');
    expect(recommend(liedTrue, SUPPORTED)).toBe('adopt');
  });

  it('peerSatisfied 与 supported 基线矛盾时不得采纳', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    // supported 唯一基线 6.1.0，报告自称基线 6.0.0（peer 转述与事实来源矛盾）
    const lied: CompatibilityReport = {
      ...report,
      peerSatisfied: true,
      baselineEchartsVersion: '6.0.0',
    };

    expect(recommend(lied, SUPPORTED)).toBe('hold');
  });

  it('supported 自身混基线时，recommend 不得采纳', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    // verifyCandidate 会拒绝混基线，这里直接构造一份绕过它的报告
    const mixed: CompatibilityReport = {
      ...report,
      results: [
        report.results[0]!,
        { ...report.results[1]!, baselineEchartsVersion: '6.0.0' },
      ],
    };
    const mixedSupported: readonly SupportedCombination[] = [
      SUPPORTED[0]!,
      { ...SUPPORTED[1]!, echartsVersion: '6.0.0' },
    ];

    expect(hasDualFrameworkCoverage(mixed, mixedSupported)).toBe(false);
    expect(recommend(mixed, mixedSupported)).toBe('hold');
  });

  it('缺少逐行基线对照时不得判为完整覆盖（可选字段缺失即 fail-closed）', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    const withoutBaseline: CompatibilityReport = {
      ...report,
      results: report.results.map(({ baselineEchartsVersion: _ignored, ...rest }) => rest),
    };

    expect('baselineEchartsVersion' in withoutBaseline.results[0]!).toBe(false);
    expect(hasDualFrameworkCoverage(withoutBaseline, SUPPORTED)).toBe(false);
    expect(recommend(withoutBaseline, SUPPORTED)).toBe('hold');
  });

  it('逐行基线与 supported 不一致时不得判为完整覆盖', async () => {
    const candidate = resolveCandidate('6.1.0', OFFICIAL);
    const report = await verifyCandidate(candidate, SUPPORTED, passedProbe());
    const wrongBaseline: CompatibilityReport = {
      ...report,
      results: report.results.map((result, index) =>
        index === 1 ? { ...result, baselineEchartsVersion: '6.0.0' } : result,
      ),
    };

    expect(hasDualFrameworkCoverage(wrongBaseline, SUPPORTED)).toBe(false);
    expect(recommend(wrongBaseline, SUPPORTED)).toBe('hold');
  });
});
