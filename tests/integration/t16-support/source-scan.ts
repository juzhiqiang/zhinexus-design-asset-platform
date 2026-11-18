/** 使用已安装 Babel/Vue 编译器解析；不运行生成代码，不添加依赖。 */
import { createRequire } from 'node:module';
import { expect } from 'vitest';
const require = createRequire(import.meta.url);
const parserRequire = createRequire(require.resolve('@vitejs/plugin-react'));
type Ast = { type: string; [key: string]: unknown };
const babel = parserRequire('@babel/parser') as { parse(source: string, options: unknown): Ast };
const vue = parserRequire('vue/compiler-sfc') as {
  parse(source: string): { descriptor: { script?: { content: string }; scriptSetup?: { content: string }; template?: { content: string } }; errors: unknown[] };
  compileTemplate(options: unknown): { code: string; errors: unknown[] };
};
const node = (value: unknown): value is Ast => !!value && typeof value === 'object' && typeof (value as Ast).type === 'string';
const children = (value: Ast): Ast[] => Object.values(value).flatMap(v => Array.isArray(v) ? v.filter(node) : node(v) ? [v] : []);
const walk = (root: Ast, visit: (n: Ast) => void): void => { visit(root); children(root).forEach(n => walk(n, visit)); };
const nameOf = (n: unknown): string | undefined => node(n) && typeof n.name === 'string' ? n.name : undefined;
export type SourceScan = { literals: { value: string }[]; boundValues: Set<string>; codeText: string };
function parse(source: string): Ast {
  return babel.parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: false });
}
export function scanSource(source: string, framework?: 'vue' | 'react'): SourceScan {
  const roots: Ast[] = [];
  if (framework === 'vue' || (framework === undefined && /<(?:template|script)(?:\s|>)/.test(source))) {
    const parsed = vue.parse(source);
    expect(parsed.errors, '生成 SFC 必须可解析').toEqual([]);
    for (const script of [parsed.descriptor.script, parsed.descriptor.scriptSetup]) if (script) roots.push(parse(script.content));
    expect(parsed.descriptor.template, '生成 SFC 必须有模板').toBeDefined();
    const compiled = vue.compileTemplate({ source: parsed.descriptor.template!.content, filename: 'generated.vue', id: 't16', compilerOptions: { mode: 'module' } });
    expect(compiled.errors, '模板表达式必须可解析').toEqual([]);
    roots.push(parse(compiled.code)); // :prop 表达式及模板插值保留为执行 AST。
  } else roots.push(parse(source));
  const declarations = new Map<string, Ast>();
  const literals: { value: string }[] = [];
  const bindingRoots: Ast[] = [];
  const execution: string[] = [];
  for (const root of roots) walk(root, n => {
    if (n.type === 'VariableDeclarator' && node(n.init) && nameOf(n.id)) declarations.set(nameOf(n.id)!, n.init);
    if (n.type === 'FunctionDeclaration' && nameOf(n.id)) declarations.set(nameOf(n.id)!, n);
    if (n.type === 'StringLiteral') literals.push({ value: String(n.value) });
    if (n.type === 'JSXAttribute' && node(n.value)) bindingRoots.push(n.value);
    if (n.type === 'CallExpression' && /(?:createVNode|createBlock|createElementVNode|createElementBlock)$/.test(nameOf(n.callee) ?? '')) {
      const args = n.arguments as unknown[];
      if (node(args[1])) bindingRoots.push(args[1]);
      if (node(args[2])) bindingRoots.push(args[2]);
    }
    if (n.type === 'CallExpression' || n.type === 'NewExpression') {
      const callee = n.callee;
      const name = nameOf(callee) ?? (node(callee) ? nameOf(callee.property) : undefined);
      if (['eval', 'Function', 'alert', 'require', 'runInContext', 'runInNewContext'].includes(name ?? '')) execution.push(name === 'Function' ? 'Function(' : (name ?? '')+'(');
      if (node(callee) && callee.type === 'Import') execution.push('import(');
    }
    if (n.type === 'ImportExpression') execution.push('import(');
    if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && nameOf(n.object) === 'process') execution.push('process.env');
    if (n.type === 'ImportDeclaration' && node(n.source) && /(?:child_process|node:vm)/.test(String(n.source.value))) execution.push('child_process');
  });
  const boundValues = new Set<string>();
  const visited = new Set<Ast>();
  // 只追踪实际值、对象值、函数返回值及静态绑定键；不扫描任意函数体字面量。
  const staticString = (n: Ast, seen = new Set<Ast>()): string | undefined => {
    if (seen.has(n)) return; seen.add(n);
    if (n.type === 'StringLiteral') return String(n.value);
    if (n.type === 'Identifier' && declarations.has(String(n.name))) return staticString(declarations.get(String(n.name))!, seen);
    if (n.type === 'TemplateLiteral' && Array.isArray(n.expressions) && n.expressions.length === 0) return (n.quasis as {value:{cooked:string}}[]).map(q=>q.value.cooked).join('');
    if (n.type === 'BinaryExpression' && n.operator === '+' && node(n.left) && node(n.right)) {
      const left=staticString(n.left,new Set(seen)), right=staticString(n.right,new Set(seen));
      if(left !== undefined && right !== undefined) return left+right;
    }
    return undefined;
  };
  const trace = (n: Ast): void => {
    if (visited.has(n)) return; visited.add(n);
    const exact=staticString(n); if(exact !== undefined) { boundValues.add(exact); return; }
    if(n.type === 'Identifier') { const declaration=declarations.get(String(n.name)); if(declaration) trace(declaration); return; }
    if(['JSXExpressionContainer','TSAsExpression','TSSatisfiesExpression','TSNonNullExpression','ParenthesizedExpression'].includes(n.type)) { if(node(n.expression)) trace(n.expression); return; }
    if(n.type === 'ObjectExpression') { for(const p of n.properties as Ast[]) if(p.type === 'ObjectProperty' && node(p.value)) trace(p.value); return; }
    if(n.type === 'ArrayExpression') { for(const value of n.elements as unknown[]) if(node(value)) trace(value); return; }
    if(n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
      if(n.computed && node(n.property)) { const key=staticString(n.property); if(key !== undefined) boundValues.add(key); }
      const property=nameOf(n.property); if(property && declarations.has(property)) trace(declarations.get(property)!); return;
    }
    if(['ArrowFunctionExpression','FunctionExpression','FunctionDeclaration'].includes(n.type) && node(n.body)) {
      if(n.body.type !== 'BlockStatement') trace(n.body);
      else for(const statement of n.body.body as Ast[]) if(statement.type === 'ReturnStatement' && node(statement.argument)) trace(statement.argument);
      return;
    }
    if(n.type === 'CallExpression' && node(n.callee) && ['ArrowFunctionExpression','FunctionExpression'].includes(n.callee.type)) trace(n.callee);
  };
  bindingRoots.forEach(trace);
  return { literals, boundValues, codeText: execution.join(' ') };
}
export const EXECUTION_PRIMITIVES = ['eval(', 'Function(', 'child_process', 'process.env', 'import(', 'require(', 'runIn'] as const;
export function expectSafeBinding(source: string, payload: string): void {
  const scan = scanSource(source);
  for (const primitive of EXECUTION_PRIMITIVES) expect(scan.codeText, 'AST 不得包含执行原语').not.toContain(primitive);
  expect(scan.boundValues.has(payload), '危险文本必须可追溯到真实 prop/callback 绑定，未使用字面量不算证据').toBe(true);
}
export function expectBoundString(source: string, value: string): void {
  expect(scanSource(source).boundValues.has(value), '字符串必须可追溯到组件绑定').toBe(true);
}
