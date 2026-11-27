import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const rel = (file: string) => path.relative(root, file).split(path.sep).join('/');
const members = new Map([
  ['apps/api', '@company/platform-api'], ['apps/gallery', '@company/gallery'],
  ['apps/admin', '@company/admin'], ['apps/preview-gateway', '@company/preview-gateway'],
  ['packages/contracts', '@company/contracts'], ['packages/charts-core', '@company/charts-core'],
  ['packages/charts-vue', '@company/charts-vue'], ['packages/charts-react', '@company/charts-react'],
  ['packages/component-cli', '@company/component-cli'], ['examples/vue', '@company/example-vue'],
  ['examples/react', '@company/example-react'],
]);

/** 全部现行文档：死链属阻断性缺陷。 */
const currentFiles = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'component-platform-implementation-assessment.md', 'infra/README.md', 'docs/README.md'];
const currentDirs = ['rules', 'docs/foundation', 'docs/guides', 'docs/specs', 'docs/design', 'docs/acceptance', 'docs/plans', 'docs/phases'];
/** 只有操作性文档的路径字面量会被校验：计划稿与设计稿本就可以引用尚未按规划落地的路径。 */
const operationalFiles = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'infra/README.md', 'docs/README.md'];
const operationalDirs = ['rules', 'docs/foundation', 'docs/guides'];
/** 历史留痕：AGENTS.md 禁止重写已完成任务的验证记录，仅报告不阻断。 */
const historicalFiles = ['CHANGELOG.md', 'component-platform-architecture.md'];
const historicalDirs = ['docs/verification'];

/** CLI 在用户组件工程里生成的目录，不是本仓路径。 */
const userProjectPrefixes = ['packages/react', 'packages/vue', 'packages/button', 'docs/api', 'docs/demo.md'];
/** 行文本身就在枚举「已不存在的旧路径」时不报死链；刻意收窄，避免吞掉真实缺陷。 */
const assertsGone = /旧路径|已移除|已删除/;
const rootPrefixes = new Set(['scripts', 'rules', 'docs', 'packages', 'apps', 'infra', 'examples', 'tests']);

function walk(dir: string): string[] {
  if (!existsSync(path.join(root, dir))) return [];
  const out: string[] = [];
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out.sort();
}
const scan = (files: string[], dirs: string[]) => [...files, ...dirs.flatMap(walk)].map(f => rel(path.join(root, f)));

const LINK = /!?\[([^\]]*)\]\(\s*<?([^)<>\s]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
/** 后向排除 `*?{` 与路径字符，避免把 `packages/charts-*` 截成 `packages/charts`。 */
const PATH_TOKEN = /(?<![\w/.-])((?:scripts|rules|docs|packages|apps|infra|examples|tests)\/[\w.@/-]+)(?![\w.@/*?{-])/g;

function headings(file: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of readFileSync(path.join(root, file), 'utf8').split('\n')) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match) slugs.add(match[1]!.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-'));
  }
  return slugs;
}

/** 死链按「文件相对」与「仓库根相对」双路解析；本仓两种写法并存，缺一即判死。路径字面量只校验操作性文档。 */
function audit(files: string[], pathScope: Set<string>) {
  const deadLinks: string[] = [];
  const deadPaths: string[] = [];
  const rootOnly: string[] = [];
  const slugCache = new Map<string, Set<string>>();
  for (const file of files) {
    const checkPaths = pathScope.has(file);
    readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
      const at = `${file}:${index + 1}`;
      for (const match of line.matchAll(LINK)) {
        const target = match[2]!;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target) || !target) continue;
        const [rawPath, anchor] = target.split('#');
        if (!rawPath) continue;
        const decoded = decodeURIComponent(rawPath);
        const relative = path.resolve(path.dirname(path.join(root, file)), decoded);
        const fromRoot = path.resolve(root, decoded);
        const resolved = existsSync(relative) ? relative : existsSync(fromRoot) ? fromRoot : undefined;
        if (!resolved) { deadLinks.push(`${at}: [${target}]`); continue; }
        if (resolved === fromRoot && relative !== fromRoot) rootOnly.push(`${at}: [${target}]`);
        if (anchor && resolved.endsWith('.md')) {
          if (!slugCache.has(resolved)) slugCache.set(resolved, headings(rel(resolved)));
          const wanted = anchor.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
          if (!slugCache.get(resolved)!.has(wanted)) deadLinks.push(`${at}: [${target}] 锚点缺失`);
        }
      }
      if (!checkPaths || assertsGone.test(line)) return;
      // 链接目标已由死链检查覆盖，这里只查正文里的路径字面量，避免同一缺陷重复上报
      for (const match of line.replace(LINK, '$1').matchAll(PATH_TOKEN)) {
        const raw = match[1]!;
        if (/[*?{}]/.test(raw) || userProjectPrefixes.some(prefix => raw.startsWith(prefix))) continue;
        const token = raw.replace(/[./-]+$/, '');
        if (!rootPrefixes.has(token.split('/')[0]!)) continue;
        if (!existsSync(path.join(root, token))) deadPaths.push(`${at}: \`${token}\``);
      }
    });
  }
  return { deadLinks, deadPaths, rootOnly };
}

/** docs/README.md 自称的篇数必须与实际一致，否则索引失去导航价值。 */
function auditDocCounts() {
  const text = readFileSync(path.join(root, 'docs/README.md'), 'utf8');
  const claims = new Map<string, number>();
  const tree = /```[\s\S]*?```/.exec(text)?.[0] ?? '';
  for (const line of tree.split('\n')) {
    const row = /^\s*(?:[├└]──\s*)?([\w.*-]+)\/?\s{2,}(.+)$/.exec(line);
    if (!row) continue;
    const count = /（(\d+)\s*篇/.exec(row[2]!)?.[1] ?? /^(\d+)\s*篇/.exec(row[2]!.trim())?.[1];
    if (count) claims.set(row[1]!, Number(count));
  }
  const total = /共\s*(\d+)\s*篇/.exec(text)?.[1];
  const actual: Record<string, number> = {
    'guides': walk('docs/guides').length, 'foundation': walk('docs/foundation').length,
    'specs': walk('docs/specs').length, 'design': walk('docs/design').length,
    'acceptance': walk('docs/acceptance').length, 'plans': walk('docs/plans').length,
    'phase2': walk('docs/phases/phase2').length, 'phase3': walk('docs/phases/phase3').length,
    '*.md': walk('docs/verification').filter(f => !f.includes('/evidence/')).length, 'README.md': 1,
  };
  const mismatches: string[] = [];
  for (const [label, claimed] of claims) {
    const real = actual[label];
    if (real !== undefined && real !== claimed) mismatches.push(`docs/README.md: \`${label}\` 自称 ${claimed} 篇，实际 ${real} 篇`);
  }
  const realTotal = walk('docs').length;
  if (total && Number(total) !== realTotal) mismatches.push(`docs/README.md: 自称共 ${total} 篇，实际 ${realTotal} 篇`);
  return mismatches;
}

/** rules/AGENTS 里声明的 TypeScript 版本必须与对应成员的 package.json 一致。 */
function auditTypeScriptClaims() {
  const versions = new Map<string, string>();
  for (const dir of members.keys()) {
    const file = path.join(root, dir, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    const version = pkg.devDependencies?.typescript ?? pkg.dependencies?.typescript;
    if (version) versions.set(dir, version);
  }
  const mismatches: string[] = [];
  for (const file of [...operationalFiles.filter(f => f === 'AGENTS.md'), ...walk('rules')]) {
    readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
      const claimed = [...line.matchAll(/TypeScript\s*`([\d.]+)`/g)].map(m => m[1]!);
      if (claimed.length !== 1) return;
      const targets = [...line.matchAll(/(?:packages\/charts-\*|(?:packages|apps|examples)\/[\w-]+)/g)].map(m => m[0]!)
        .flatMap(token => token === 'packages/charts-*' ? ['packages/charts-core', 'packages/charts-vue', 'packages/charts-react'] : [token]);
      for (const dir of targets) {
        const actual = versions.get(dir);
        if (actual && actual !== claimed[0]) mismatches.push(`${file}:${index + 1}: \`${dir}\` 声明 TypeScript ${claimed[0]}，实际 ${actual}`);
      }
    });
  }
  return mismatches;
}

/** 版本规则文件不得把仓库仍停留在 0.0.0 骨架当作现状陈述（提及"已脱离 0.0.0"不算）。 */
function auditStaleSkeletonClaims() {
  const stale: string[] = [];
  for (const file of walk('rules')) {
    readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, index) => {
      if (!/`0\.0\.0`/.test(line)) return;
      if (/(?:脱离|不再是|已经不是)/.test(line)) return;
      if (/(?:均为|版本为|仍是|当前)/.test(line)) stale.push(`${file}:${index + 1}: ${line.trim().slice(0, 50)}`);
    });
  }
  return stale;
}

const current = scan(currentFiles, currentDirs);
const operational = new Set(scan(operationalFiles, operationalDirs));
const historical = scan(historicalFiles, historicalDirs);
const now = audit(current, operational);
const past = audit(historical, new Set<string>());

for (const item of [...past.deadLinks, ...past.deadPaths, ...past.rootOnly]) console.log(`[历史留痕·不阻断] ${item}`);
for (const item of now.rootOnly) console.log(`[提示·不阻断] 根相对链接 ${item}`);
for (const item of now.deadLinks) console.error(`死链 ${item}`);
for (const item of now.deadPaths) console.error(`失效路径 ${item}`);
for (const item of auditDocCounts()) console.error(item);
for (const item of auditTypeScriptClaims()) console.error(item);
for (const item of auditStaleSkeletonClaims()) console.error(`过期现状陈述 ${item}`);

const failures = now.deadLinks.length + now.deadPaths.length + auditDocCounts().length
  + auditTypeScriptClaims().length + auditStaleSkeletonClaims().length;
assert.equal(failures, 0, `文档自洽检查未通过：${failures} 处`);
console.log(`Docs verified: ${current.length} 篇现行文档无死链，${operational.size} 篇操作性文档路径有效，索引篇数与 TypeScript 声明一致；${past.deadLinks.length + past.deadPaths.length} 处历史留痕、${now.rootOnly.length} 处根相对链接仅报告。`);
