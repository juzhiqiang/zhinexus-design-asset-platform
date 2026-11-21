/**
 * T11 平台验收：合成双框架试点演练
 *
 * 依据 docs/superpowers/plans/2026-11-11-component-platform-implementation.md T11：
 * Files 要求创建 `tests/integration/platform-acceptance.test.ts` 与 `tests/browser/platform-acceptance.spec.ts`。
 *
 * 本文件只覆盖**可在工程内独立证明**的部分：只读识别、可审查变更清单、命令结果记录与
 * 框架/引擎版本留痕，以及「不得把合成演练记成真实业务试点」的护栏。
 *
 * 明确边界（T11 第 1 项原文：「合成消费者不能替代这一步」）：
 * - 本文件的合成工程**不满足**「两个真实业务项目」标准项，`satisfiesRealBusinessPilot` 恒为 false；
 * - 真实业务项目需用户提供访问范围后另行接入，届时由同一 harness 产出 receipt，不改写本文件结论；
 * - 类型/构建与浏览器点击/更新交互的**实跑**依赖固定工具链，沙箱内不可用，未执行时不写 exitCode 0。
 */
import { describe, expect, it, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildPilotReceipt,
  canonicalPilotReceiptJson,
  createSyntheticPilotProject,
  identifyProject,
  inventoryChanges,
  pilotRoot,
  recordCommand,
  releasePilotDirs,
  snapshotFiles,
  type PilotChange,
  type PilotFramework,
  type PilotRelease,
  type ProjectIdentity,
} from './t11-support/pilot-harness.js';

const RELEASE: PilotRelease = {
  name: '@company/charts-vue',
  version: '0.0.12',
  integrity: 'sha512-synthetic-integrity-not-a-real-release-digest',
};

const FRAMEWORKS: PilotFramework[] = ['vue', 'react'];

function releaseFor(framework: PilotFramework): PilotRelease {
  return framework === 'vue' ? RELEASE : { ...RELEASE, name: '@company/charts-react' };
}

afterAll(() => {
  releasePilotDirs();
});

describe('T11 只读识别', () => {
  it('识别合成 Vue 工程的框架、react-dom 缺失与引擎版本，且不做任何写入', () => {
    const project = createSyntheticPilotProject('vue', releaseFor('vue'));
    const before = snapshotFiles(project.root);

    const identity = identifyProject(project.root);

    expect(identity.framework).toBe('vue');
    expect(identity.frameworkVersion).toBeDefined();
    expect(identity.engineVersion).toBeDefined();
    // Vue 工程不得出现 react-dom 版本：缺失必须是 undefined，不能用 react 的值填充。
    expect(identity.reactDomVersion).toBeUndefined();
    expect(identity.packageManager).toBeUndefined();

    // 只读：识别前后文件集合必须完全一致。
    expect(snapshotFiles(project.root)).toEqual(before);
  });

  it('识别合成 React 工程时同时留痕 react-dom 与 echarts 版本', () => {
    const project = createSyntheticPilotProject('react', releaseFor('react'));
    const identity = identifyProject(project.root);

    expect(identity.framework).toBe('react');
    expect(identity.frameworkVersion).toBeDefined();
    expect(identity.reactDomVersion).toBeDefined();
    expect(identity.engineVersion).toBeDefined();
  });

  it('空目录识别为 unknown 且所有版本字段为 undefined，不用猜测值填充', () => {
    const root = pilotRoot('empty');
    const identity = identifyProject(root);

    expect(identity.framework).toBe('unknown');
    expect(identity.frameworkVersion).toBeUndefined();
    expect(identity.reactDomVersion).toBeUndefined();
    expect(identity.engineVersion).toBeUndefined();
    expect(identity.lockfiles).toEqual([]);
  });
});

describe('T11 可审查变更清单', () => {
  it('逐文件独立实算字节与 SHA-256，并按基线区分 added 与 modified', () => {
    const project = createSyntheticPilotProject('vue', releaseFor('vue'));
    const generated = path.join(project.root, 'src', 'PilotChart.vue');
    fs.mkdirSync(path.dirname(generated), { recursive: true });
    fs.writeFileSync(generated, '<template><div data-testid="pilot">pilot</div></template>\n', 'utf8');
    fs.writeFileSync(path.join(project.root, 'package.json'), `${JSON.stringify({ touched: true }, null, 2)}\n`, 'utf8');

    const changes = inventoryChanges(project.root, project.baseline);

    const added = changes.filter(change => change.path === 'src/PilotChart.vue');
    const modified = changes.filter(change => change.path === 'package.json');
    expect(added).toHaveLength(1);
    expect(modified).toHaveLength(1);
    expect(added[0]!.kind).toBe('added');
    expect(modified[0]!.kind).toBe('modified');

    // 摘要必须由本进程对磁盘字节实算，不等于任何 fixture 常量。
    const bytes = fs.readFileSync(generated);
    expect(added[0]!.bytes).toBe(bytes.length);
    expect(added[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(added[0]!.sha256).not.toBe('');
  });

  it('跳过 node_modules 与符号链接，不把依赖树算进可审查变更', () => {
    const project = createSyntheticPilotProject('react', releaseFor('react'));
    fs.mkdirSync(path.join(project.root, 'node_modules', 'leftover'), { recursive: true });
    fs.writeFileSync(path.join(project.root, 'node_modules', 'leftover', 'index.js'), 'export {};\n', 'utf8');

    const changes = inventoryChanges(project.root, project.baseline);

    expect(changes.some(change => change.path.startsWith('node_modules/'))).toBe(false);
  });
});

describe('T11 命令结果记录', () => {
  it('未执行时 exitCode 保持 undefined，不得用 0 冒充通过', () => {
    const outcome = recordCommand('typecheck', 'vue-tsc --noEmit', () => undefined, '固定工具链在本轮不可用');

    expect(outcome.executed).toBe(false);
    expect(outcome.exitCode).toBeUndefined();
    expect(outcome.note).toContain('不可用');
  });

  it('执行时如实记录退出码与耗时', () => {
    const outcome = recordCommand('build', 'vite build', () => ({ exitCode: 0 }));

    expect(outcome.executed).toBe(true);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('T11 试点 receipt 护栏', () => {
  const baseIdentity: ProjectIdentity = { framework: 'vue', frameworkVersion: '3.5.45', engineVersion: '6.1.0', lockfiles: [] };
  const baseInput = {
    framework: 'vue' as PilotFramework,
    identity: baseIdentity,
    release: RELEASE,
    changes: [] as PilotChange[],
    commands: [],
    startedAt: '2026-11-21T00:00:00.000Z',
    finishedAt: '2026-11-21T00:00:01.000Z',
  };

  it('拒绝把合成演练记成满足真实业务试点标准项', () => {
    expect(() =>
      buildPilotReceipt({ ...baseInput, synthetic: true, productionAcceptance: false, satisfiesRealBusinessPilot: true }),
    ).toThrow(/real-business-pilot/);
  });

  it('拒绝把合成演练记成生产验收', () => {
    expect(() =>
      buildPilotReceipt({ ...baseInput, synthetic: true, productionAcceptance: true, satisfiesRealBusinessPilot: false }),
    ).toThrow(/production acceptance/);
  });

  it('合成演练的 receipt 三个判定字段全部为 false 且可序列化', () => {
    const receipt = buildPilotReceipt({
      ...baseInput,
      synthetic: true,
      productionAcceptance: false,
      satisfiesRealBusinessPilot: false,
    });

    expect(receipt.synthetic).toBe(true);
    expect(receipt.productionAcceptance).toBe(false);
    expect(receipt.satisfiesRealBusinessPilot).toBe(false);
    expect(canonicalPilotReceiptJson(receipt)).toContain('"satisfiesRealBusinessPilot": false');
  });
});

describe('T11 合成双框架试点演练', () => {
  for (const framework of FRAMEWORKS) {
    it(`${framework} 合成工程产出完整 receipt，且框架/引擎版本已留痕`, () => {
      const project = createSyntheticPilotProject(framework, releaseFor(framework));
      const identity = identifyProject(project.root);
      const changes = inventoryChanges(project.root, project.baseline);
      const commands = [
        recordCommand('typecheck', framework === 'vue' ? 'vue-tsc --noEmit' : 'tsc --noEmit', () => undefined, '本轮未执行固定工具链'),
        recordCommand('build', 'vite build', () => undefined, '本轮未执行固定工具链'),
      ];

      const receipt = buildPilotReceipt({
        synthetic: true,
        productionAcceptance: false,
        satisfiesRealBusinessPilot: false,
        framework,
        identity,
        release: releaseFor(framework),
        changes,
        commands,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });

      // 机械部分必须完整：版本留痕、变更清单、命令记录、判定字段。
      expect(receipt.identity.framework).toBe(framework);
      expect(receipt.identity.frameworkVersion).toBeDefined();
      expect(receipt.identity.engineVersion).toBeDefined();
      expect(receipt.changes.length).toBeGreaterThan(0);
      expect(receipt.changes.every(change => /^[a-f0-9]{64}$/.test(change.sha256))).toBe(true);
      expect(receipt.commands).toHaveLength(2);
      // 未执行的命令不得被记成通过。
      expect(receipt.commands.every(command => command.executed === false)).toBe(true);
      expect(receipt.commands.every(command => command.exitCode === undefined)).toBe(true);
      expect(receipt.satisfiesRealBusinessPilot).toBe(false);
    });
  }
});
