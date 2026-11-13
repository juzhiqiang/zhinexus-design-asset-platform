import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * T10 收口：`@company/charts-vue` 发布声明在严格解析下的自验收。
 *
 * 背景：`packages/charts-vue/src/index.ts` 等入口以 `export { default as LineChart }
 * from './LineChart.vue'` 再导出，vue-tsc 把该说明符原样写进 `dist/*.d.ts`，而旁边
 * 的声明文件叫 `LineChart.vue.d.ts`。仓库自身与绝大多数消费者用
 * `moduleResolution: 'Bundler'`， TS 能把 `./LineChart.vue` 解析到
 * `LineChart.vue.d.ts`，所以这个缺陷在仓库内一直不可见；一旦消费者用
 * `moduleResolution: 'NodeNext'` 并关掉 `skipLibCheck`，就会报 9 处 TS2307
 * （`Cannot find module './LineChart.vue' or its corresponding type declarations.`）。
 *
 * 本文件做两件事，都基于**真实构建产物**，不用 `declare module '*.vue'`、不用源码
 * alias、不靠 `skipLibCheck` 掩盖：
 * 1. 静态断言：`dist` 下所有 `.d.ts` 的相对说明符必须以 `.js` 结尾（NodeNext 下
 *    TS 才会把 `./X.vue.js` 映射到 `./X.vue.d.ts`），且被引用的声明文件真实存在。
 * 2. 动态断言：用仓库锁定的 TypeScript，以 `moduleResolution: 'NodeNext'` +
 *    `skipLibCheck: false` 对 `dist` 的 `.d.ts` 实跑一遍解析，断言**没有任何以
 *    相对路径（`./`、`../`）说明符报出的 TS2307**。第三方裸说明符
 *    （`@vue/runtime-core` 等）在隔离临时工程里本就不可解析，按相对路径过滤。
 */

const repoRoot = path.resolve(__dirname, '../../');
const vuePackageDir = path.join(repoRoot, 'packages', 'charts-vue');
const distDir = path.join(vuePackageDir, 'dist');

/** 入口与子路径声明：这些文件出现再导出，是缺陷的直接载体。 */
const ENTRY_DECLARATIONS = [
  'index.d.ts',
  'line.d.ts',
  'bar.d.ts',
  'pie.d.ts',
  'scatter.d.ts',
  'trend-card.d.ts',
  'ranking.d.ts',
  'proportion.d.ts',
] as const;

/** 已知的七种图表组件声明（由 `.vue` 生成）。 */
const COMPONENT_DECLARATIONS = [
  'LineChart.vue.d.ts',
  'BarChart.vue.d.ts',
  'PieChart.vue.d.ts',
  'ScatterChart.vue.d.ts',
  'TrendCard.vue.d.ts',
  'RankingChart.vue.d.ts',
  'ProportionChart.vue.d.ts',
] as const;

function listDeclarations(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.d.ts'))
    .map((name) => path.join(dir, name));
}

/** 从一个声明文件里抽出全部相对 import / export ... from 说明符。 */
function relativeSpecifiers(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const pattern = /from\s+'(\.[^']*)'/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

beforeAll(() => {
  // dist 不存在时先构建：本文件验收的是「发布出去的东西」，未构建就没有验收对象。
  // charts-vue 的构建（vue-tsc 声明 + vite ESM）在沙箱内约 10–25s。
  if (!fs.existsSync(path.join(distDir, 'index.d.ts'))) {
    execFileSync(process.execPath, [path.join(vuePackageDir, 'scripts', 'build.mjs')], {
      cwd: vuePackageDir,
      stdio: 'ignore',
    });
  }
});

describe('charts-vue 发布声明的相对说明符', () => {
  it('七种图表组件声明都已产出', () => {
    for (const name of COMPONENT_DECLARATIONS) {
      expect(fs.existsSync(path.join(distDir, name)), name).toBe(true);
    }
  });

  it('入口与子路径声明都已产出', () => {
    for (const name of ENTRY_DECLARATIONS) {
      expect(fs.existsSync(path.join(distDir, name)), name).toBe(true);
    }
  });

  it('没有裸 .vue 说明符：NodeNext 下无法解析', () => {
    const offenders: string[] = [];
    for (const file of listDeclarations(distDir)) {
      const source = fs.readFileSync(file, 'utf8');
      const bare = source.match(/from\s+'\.\/[A-Za-z0-9_-]+\.vue'/g);
      if (bare) {
        offenders.push(`${path.basename(file)}: ${bare.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('所有相对说明符都以 .js 结尾（NodeNext 的 .js → .d.ts 映射）', () => {
    const offenders: string[] = [];
    for (const file of listDeclarations(distDir)) {
      for (const specifier of relativeSpecifiers(file)) {
        if (!specifier.endsWith('.js')) {
          offenders.push(`${path.basename(file)} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('每个相对说明符指向的声明文件都真实存在', () => {
    const missing: string[] = [];
    for (const file of listDeclarations(distDir)) {
      for (const specifier of relativeSpecifiers(file)) {
        // NodeNext 下 TS 把 './X.js' 映射到 './X.d.ts'
        const target = path.join(
          distDir,
          specifier.replace(/^\.\//, '').replace(/\.js$/, '.d.ts'),
        );
        if (!fs.existsSync(target)) {
          missing.push(`${path.basename(file)} → ${specifier}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('charts-vue 发布声明在 NodeNext 下可解析', () => {
  it('skipLibCheck=false 实跑 tsc，无相对说明符的 TS2307', () => {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'charts-vue-nodenext-'));
    try {
      const tsconfig = {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
          target: 'ES2022',
        },
        files: listDeclarations(distDir),
      };
      fs.writeFileSync(
        path.join(workdir, 'tsconfig.json'),
        JSON.stringify(tsconfig, null, 2),
        'utf8',
      );

      const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
      let output = '';
      try {
        execFileSync(process.execPath, [tsc, '-p', path.join(workdir, 'tsconfig.json')], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (error) {
        const e = error as { stdout?: string; stderr?: string };
        output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
      }

      // 只关心「SDK 自己的相对说明符解析失败」这一类错误；
      // 第三方裸说明符（@vue/runtime-core 等）在隔离临时工程里不可解析，与本次缺陷无关。
      const relativeFailures = output
        .split('\n')
        .filter((line) => line.includes('TS2307'))
        .filter((line) => /'\.\.?\//.test(line))
        .map((line) => line.trim());

      expect(relativeFailures, `tsc 输出：\n${output}`).toEqual([]);
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  });
});
