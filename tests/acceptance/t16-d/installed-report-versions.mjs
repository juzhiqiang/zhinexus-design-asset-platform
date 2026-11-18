// tests/acceptance/t16-d/installed-report-versions.mjs
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import assert from 'node:assert/strict';

const manifest = async (root, name, version) => {
  const file = join(root, 'node_modules', ...name.split('/'), 'package.json');
  const st = await lstat(file);
  assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, `manifest 非普通单链接文件: ${file}`);
  const v = JSON.parse(await readFile(file, 'utf8')).version;
  assert.equal(v, version, `实际版本与计划不精确相等: ${name}`);
  return { name, version: v };
};

export const reportVersions = async ({ s, plan, applied }) => {
  assert.ok(Array.isArray(plan.exactDependencies) && Array.isArray(applied.installedVersions), '依赖清单必须是数组而非 Record');
  const sort = (arr) => [...arr].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const actual = [];
  for (const d of plan.exactDependencies) actual.push(await manifest(s.root, d.name, d.version));
  assert.deepEqual(sort(applied.installedVersions), sort(actual), 'installedVersions 与全部实际读取版本不一致');
  for (const [name, version] of [['@company/charts-core', '0.0.11'], ['@company/charts-vue', '0.0.12'], ['vue', '3.5.45'], ['echarts', '6.1.0']])
    await manifest(s.root, name, version);
  const comps = plan.changes.filter((c) => c.kind === 'generated-component' && c.path.endsWith('.vue'));
  assert.ok(comps.length >= 1, '缺少 generated-component 且以 .vue 结尾的计划项');
  for (const c of comps) {
    assert.ok(plan.allowedPaths.includes(c.path), `计划路径未在 allowedPaths 内: ${c.path}`);
    const file = isAbsolute(c.path) ? c.path : join(s.root, c.path);
    const st = await lstat(file);
    assert.ok(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, `组件非普通单链接真实文件: ${file}`);
    assert.ok((await readFile(file, 'utf8')).includes('@company/charts-vue'), `组件内容未包含 @company/charts-vue: ${file}`);
  }
};
