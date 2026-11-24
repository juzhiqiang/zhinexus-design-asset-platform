import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';
import { runLocal } from './process.js';
import type { ProjectVariant } from './config.js';

type BuildInput = { root: string; entry: string; moduleName: string; exportName: string; framework: 'vue' | 'react'; outDir: string; binding: string };

// This self-contained function runs in a child Node process. Vite and its config
// resolve from the clean installed consumer, never from the CLI workspace.
async function runVite(input: BuildInput) {
  const load = new Function('id', 'return import(id)') as (id: string) => Promise<unknown>;
  const fs = await load('node:fs/promises') as typeof import('node:fs/promises');
  const path = await load('node:path') as typeof import('node:path');
  const { createRequire } = await load('node:module') as typeof import('node:module');
  const { pathToFileURL } = await load('node:url') as typeof import('node:url');
  const require = createRequire(path.join(input.root, 'package.json'));
  const inside = (root: string, file: string) => { const relative = path.relative(root, file); return !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
  const viteEntry = await fs.realpath(require.resolve('vite'));
  if (!inside(input.root, viteEntry)) throw new Error('CONSUMER_SOURCE_LINK: Vite 安装越界');
  const vitePackage = JSON.parse(await fs.readFile(require.resolve('vite/package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(vitePackage.version)) throw new Error('INSTALLED_VERSION_INVALID: vite');
  const vite = await load(pathToFileURL(viteEntry).href) as typeof import('vite');
  const facadeId = '\0component-frozen-export';
  const sources = new Map<string, string>();
  let selected = false;
  let facadeEntry: string | undefined;
  const cleanId = (id: string) => id.replace(/^\/\@fs\//, '').split('?')[0]!;
  async function checkSource(id: string) {
    if (id.startsWith('\0')) return;
    const file = cleanId(id);
    if (!path.isAbsolute(file)) throw new Error('CONSUMER_SOURCE_LINK: 外部模块 ' + id);
    const real = await fs.realpath(file);
    if (!inside(input.root, real)) throw new Error('CONSUMER_SOURCE_LINK: 实际构建来源越界 ' + real);
    return real;
  }
  // Wrap the selected export without editing the installed module. The browser
  // binding is called only from an actual framework commit/mount lifecycle.
  const originalEntry = JSON.stringify(input.entry.replace(/\\/g, '/'));
  const selectedExport = JSON.stringify(input.exportName);
  const implementationBinding = JSON.stringify(input.binding);
  const facade = input.framework === 'react' ? `import * as original from ${originalEntry};
import { createElement, forwardRef, useLayoutEffect } from 'react';
export * from ${originalEntry};
const notify = () => { const record = globalThis[${implementationBinding}]; if (typeof record === 'function') void record(); };
const value = original[${selectedExport}];
const reactType = value && typeof value === 'object' && [Symbol.for('react.memo'), Symbol.for('react.lazy'), Symbol.for('react.forward_ref')].includes(value.$$typeof);
if (typeof value !== 'function' && !reactType) throw new Error('PREVIEW_IMPLEMENTATION_UNSUPPORTED: selected export must be a React component');
const selected = forwardRef(function FrozenSelectedExport(props, ref) {
  useLayoutEffect(() => { notify(); }, []);
  return createElement(value, { ...props, ref });
});
export { selected as ${input.exportName} };
` : `import * as original from ${originalEntry};
import { defineComponent, h, onMounted, ref } from 'vue';
export * from ${originalEntry};
const notify = () => { const record = globalThis[${implementationBinding}]; if (typeof record === 'function') void record(); };
const value = original[${selectedExport}];
if (typeof value !== 'function' && !(value && typeof value === 'object' && (typeof value.setup === 'function' || typeof value.render === 'function'))) throw new Error('PREVIEW_IMPLEMENTATION_UNSUPPORTED: selected export must be a Vue setup/render component');
const selected = defineComponent({
  name: 'FrozenSelectedExport',
  inheritAttrs: false,
  setup(_props, { attrs, slots, expose }) {
    const inner = ref();
    expose(new Proxy({}, {
      get(_target, key) { return inner.value?.[key]; },
      set(_target, key, replacement) { if (!inner.value) return false; inner.value[key] = replacement; return true; },
      has(_target, key) { return !!inner.value && key in inner.value; },
      ownKeys() { return inner.value ? Reflect.ownKeys(inner.value) : []; },
      getOwnPropertyDescriptor(_target, key) { return inner.value && key in inner.value ? { configurable: true, enumerable: true } : undefined; },
    }));
    onMounted(() => { notify(); });
    return () => h(value, { ...attrs, ref: inner }, slots);
  },
});
export { selected as ${input.exportName} };
`;
  const plugin: Plugin = {
    name: 'component-frozen-provenance', enforce: 'post',
    resolveId(id) { if (id === facadeId) return facadeId; },
    async load(id) { if (id === facadeId) return facade; await checkSource(id); },
    async transform(code, id) {
      if (id === facadeId || !code.includes(input.moduleName)) return;
      const edits: { start: number; end: number }[] = [];
      const ast = this.parse(code);
      function visit(node: unknown) {
        if (!node || typeof node !== 'object') return;
        const item = node as { type?: string; source?: { value?: string; start: number; end: number } };
        if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(item.type ?? '') && item.source?.value === input.moduleName) edits.push(item.source);
        for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
      }
      visit(ast);
      if (!edits.length) return;
      const resolved = await this.resolve(input.moduleName, id, { skipSelf: true });
      if (!resolved || resolved.external || await checkSource(resolved.id) !== input.entry) throw new Error('CONSUMER_SOURCE_LINK: 配置导出的实际 Vite 解析被替换');
      selected = true;
      for (const edit of edits.sort((a, b) => b.start - a.start)) code = code.slice(0, edit.start) + JSON.stringify(facadeId) + code.slice(edit.end);
      return { code, map: null };
    },
    async generateBundle(_options, bundle) {
      if (!selected || !Object.values(bundle).some(item => item.type === 'chunk' && facadeId in item.modules)) throw new Error('PREVIEW_IMPLEMENTATION_UNUSED: 构建未消费所选冻结导出');
      // Bind the facade's own namespace import/re-export edge. Framework runtime
      // imports are expected, but exactly one edge must resolve to the frozen entry.
      const imported = [...new Set(this.getModuleInfo(facadeId)?.importedIds ?? [])];
      const frozenEntries: string[] = [];
      for (const id of imported) if (await checkSource(id) === input.entry) frozenEntries.push(id);
      if (frozenEntries.length !== 1 || this.getModuleInfo(frozenEntries[0]!)?.code == null) {
        throw new Error('CONSUMER_SOURCE_LINK: 冻结导出代理实际加载的入口被替换');
      }
      facadeEntry = frozenEntries[0];
      for (const id of this.getModuleIds()) {
        const real = await checkSource(id);
        if (real) sources.set(id, real);
      }
    },
  };
  await vite.build({ root: input.root, logLevel: 'silent', plugins: [plugin], build: { outDir: input.outDir, emptyOutDir: true } });
  await fs.writeFile(path.join(input.root, '.consumer-provenance.json'), JSON.stringify({ viteVersion: vitePackage.version, installedEntry: input.entry, facadeEntry, moduleName: input.moduleName, exportName: input.exportName, sources: [...sources.values()] }));
}

export async function buildProjectConsumer(root: string, variant: ProjectVariant, installedEntry: string, moduleName: string, log: (message: string) => void, timeoutMs: number) {
  const binding = '__component_frozen_' + randomUUID().replace(/-/g, '');
  const input: BuildInput = { root, entry: installedEntry, moduleName, exportName: variant.exportName, framework: variant.framework, outDir: variant.consumer.previewDir, binding };
  const script = path.join(root, '.consumer-vite-build.mjs');
  await fs.writeFile(script, `(${runVite.toString()})(${JSON.stringify(input)}).catch(error => { console.error(error); process.exitCode = 1; });\n`);
  log('CLI 控制 Vite 消费者构建与冻结导出来源验证');
  await runLocal({ program: process.execPath, args: [script] }, root, log, timeoutMs);
  log('实际 Vite 来源图: ' + await fs.readFile(path.join(root, '.consumer-provenance.json'), 'utf8'));
  return { binding };
}
