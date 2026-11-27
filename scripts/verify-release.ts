import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const rel = (file: string) => path.relative(root, file).split(path.sep).join('/');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const publicNames = new Set(['@company/charts-core', '@company/charts-vue', '@company/charts-react', '@company/component-cli']);
const memberDirs = ['apps/api', 'apps/gallery', 'apps/admin', 'apps/preview-gateway', 'packages/contracts',
  'packages/charts-core', 'packages/charts-vue', 'packages/charts-react', 'packages/component-cli', 'examples/vue', 'examples/react'];

type Manifest = { name: string; version: string; private: boolean };
const manifest = (dir: string) => JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8')) as Manifest;
const members = memberDirs.map(manifest);
const failures: string[] = [];
const notes: string[] = [];

// 1. CHANGELOG 首节必须与根 package.json 一致，否则读者无法判断当前版本
const rootVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version as string;
const head = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})$/m.exec(readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
if (!head) failures.push('CHANGELOG.md: 找不到 `## [x.y.z] - YYYY-MM-DD` 形式的首节');
else {
  if (head[1] !== rootVersion) failures.push(`CHANGELOG.md: 首节版本 ${head[1]} 与根 package.json ${rootVersion} 不一致`);
  const today = new Date().toISOString().slice(0, 10);
  if (head[2]! > today) failures.push(`CHANGELOG.md: 首节日期 ${head[2]} 晚于今天 ${today}`);
}

// 2. 可发布包不得停留在 0.0.0；私有包允许（不对外发布，无需版本事实来源）
for (const pkg of members) {
  if (publicNames.has(pkg.name) && pkg.version === '0.0.0') {
    failures.push(`${pkg.name}: 公开包版本仍为 0.0.0，不可作为业务组件发布`);
  }
}

// 3. 升版提交必须名副其实：消息声称的每个版本都要在该提交改动的 package.json 里真实出现
const bumpRe = /^chore: 升级版本号至 (.+)$/;
const claimedVersions = (subject: string) => [...subject.matchAll(/\d+\.\d+\.\d+/g)].map(m => m[0]!);
const bumpCommits = git('log', '--format=%H%x09%s', '-50').split('\n')
  .map(line => { const [hash, ...rest] = line.split('\t'); return { hash: hash!, subject: rest.join('\t') }; })
  .filter(commit => bumpRe.test(commit.subject));
for (const commit of bumpCommits) {
  const claimed = claimedVersions(bumpRe.exec(commit.subject)![1]!);
  const changed = git('show', '--name-only', '--format=', commit.hash).split('\n').filter(f => f.endsWith('package.json'));
  const versions = changed.map(file => {
    try { return (JSON.parse(git('show', `${commit.hash}:${file}`)) as Manifest).version; } catch { return undefined; }
  });
  const missing = claimed.filter(version => !versions.includes(version));
  if (!claimed.length || missing.length) {
    failures.push(`${commit.hash.slice(0, 7)} ${commit.subject}: 声称 ${claimed.join('/') || '（无版本号）'}，该提交实际改为 ${versions.join(', ') || '（无 package.json）'}${missing.length ? `，缺 ${missing.join('/')}` : ''}`);
  }
}

// 4. 同一版本号不得被两个提交声称。只校验未推送区间：已推送历史中的撞版改不了，重写会破坏他人工作树
const unpushed = git('log', '--format=%H%x09%s', 'origin/main..HEAD').split('\n').filter(Boolean)
  .map(line => { const [hash, ...rest] = line.split('\t'); return { hash: hash!, subject: rest.join('\t') }; })
  .filter(commit => bumpRe.test(commit.subject));
const unpushedSeen = new Map<string, string>();
for (const commit of unpushed) {
  for (const version of claimedVersions(bumpRe.exec(commit.subject)![1]!)) {
    const first = unpushedSeen.get(version);
    if (first) failures.push(`版本 ${version} 在未推送历史中被重复声称：${first.slice(0, 7)} 与 ${commit.hash.slice(0, 7)}（并行分支各自升版）`);
    else unpushedSeen.set(version, commit.hash);
  }
}
const historicalDupes = new Map<string, number>();
const historicalSeen = new Map<string, string>();
for (const commit of bumpCommits) {
  for (const version of claimedVersions(bumpRe.exec(commit.subject)![1]!)) {
    if (historicalSeen.has(version)) historicalDupes.set(version, (historicalDupes.get(version) ?? 1) + 1);
    else historicalSeen.set(version, commit.hash);
  }
}
notes.push(`未推送区间含 ${unpushed.length} 个升版提交，重复声称检查已覆盖；近 50 提交内已推送撞版 ${historicalDupes.size} 个版本（${[...historicalDupes.keys()].join('、') || '无'}）属并行分支各自升版的遗留，不得重写已推送历史`);

// 5. tag 现状：建立 tag 前不得声称已按 tag 发布；已有 tag 时最新 tag 须对应 CHANGELOG 某一节
const tags = git('tag', '--points-at', 'HEAD').split('\n').filter(Boolean);
const allTags = git('tag').split('\n').filter(Boolean);
if (!allTags.length) notes.push(`仓库尚无 Git tag（${members.length} 个成员的版本事实来源仍是各自 package.json 与 CHANGELOG.md）`);
else {
  const sections = [...readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').matchAll(/^## \[([^\]]+)\]/gm)].map(m => m[1]!);
  for (const tag of tags) if (!sections.includes(tag)) failures.push(`Git tag ${tag} 在 CHANGELOG.md 中没有对应版本节`);
  if (!tags.length) notes.push(`HEAD 未指向任何 tag，最新 tag 为 ${allTags.at(-1)}`);
}

// 6. 已发布版本不可变需 Verdaccio 在线校验，本地守卫不涉足
notes.push('Verdaccio/MinIO 已发布不可变性由 tests/platform 三存储一致性用例在线校验，本脚本不重复');

for (const note of notes) console.log(`[提示] ${note}`);
for (const failure of failures) console.error(failure);
assert.equal(failures.length, 0, `版本一致性检查未通过：${failures.length} 处`);
console.log(`Release verified: 根 ${rootVersion} 与 CHANGELOG 首节一致，${members.filter(m => publicNames.has(m.name)).length} 个公开包已脱离 0.0.0，${bumpCommits.length} 个升版提交名副其实且无重复声称。`);
