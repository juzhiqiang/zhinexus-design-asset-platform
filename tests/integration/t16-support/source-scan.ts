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
export type BindingScope = { framework: 'vue' | 'react'; prop: 'data' | 'onPointClick' };
export type SourceScan = { literals: { value: string }[]; boundValues: Set<string>; lineChartBindings: Record<BindingScope['prop'], Set<string>>; codeText: string };
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
  const lexicalDeclarations = new WeakMap<Ast, Map<string, Ast | null>>();
  const parents = new WeakMap<Ast, Ast>();
  const exported = new Set<Ast>();
  for (const root of roots) walk(root, n => children(n).forEach(child => parents.set(child, n)));
  const patternNames = (pattern: unknown): string[] => {
    if (!node(pattern)) return [];
    if (pattern.type === 'Identifier') return [String(pattern.name)];
    if (pattern.type === 'ObjectProperty') return patternNames(pattern.value);
    if (pattern.type === 'AssignmentPattern') return patternNames(pattern.left);
    if (pattern.type === 'RestElement') return patternNames(pattern.argument);
    return children(pattern).flatMap(patternNames);
  };
  const isFunction = (n: Ast): boolean => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type);
  const scopeAt = (n: Ast): Ast => {
    for (let current: Ast | undefined = n; current; current = parents.get(current)) {
      if (current.type === 'Program' || current.type === 'BlockStatement' || isFunction(current)) return current;
    }
    return n;
  };
  const declareIn = (scope: Ast, name: string, value: Ast | null): void => {
    let entries = lexicalDeclarations.get(scope);
    if (!entries) lexicalDeclarations.set(scope, entries = new Map());
    entries.set(name, entries.has(name) ? null : value);
    if (scope.type === 'Program' && value) declarations.set(name, value);
  };
  const declare = (name: string, value: Ast): void => declareIn(scopeAt(parents.get(value) ?? value), name, value);
  const resolve = (name: string, at: Ast): Ast | undefined => {
    for (let current: Ast | undefined = at; current; current = parents.get(current)) {
      const entries = lexicalDeclarations.get(current);
      if (entries?.has(name)) return entries.get(name) ?? undefined;
    }
    // Vue 编译模板与 script setup 是独立 AST，$setup 绑定可引用顶层声明。
    return declarations.get(name);
  };
  const literals: { value: string }[] = [];
  const bindingRoots: Ast[] = [];
  const trustedCharts = new Set<string>();
  const scopedRoots: Record<BindingScope['prop'], Ast[]> = { data: [], onPointClick: [] };
  const execution: string[] = [];
  for (const root of roots) walk(root, n => {
    if (n.type === 'ImportDeclaration' && node(n.source) && /^@company\/charts-(?:vue|react)(?:\/line)?$/.test(String(n.source.value))) {
      const expected = framework ?? (/charts-vue/.test(String(n.source.value)) ? 'vue' : 'react');
      if (String(n.source.value).startsWith(`@company/charts-${expected}`)) {
        for (const specifier of n.specifiers as Ast[]) if (specifier.type === 'ImportSpecifier' && nameOf(specifier.imported) === 'LineChart' && nameOf(specifier.local)) {
          trustedCharts.add(nameOf(specifier.local)!);
          declareIn(scopeAt(n), nameOf(specifier.local)!, specifier);
        }
      }
    }
    if (n.type === 'VariableDeclarator' && node(n.init) && nameOf(n.id)) declare(nameOf(n.id)!, n.init);
    if (n.type === 'FunctionDeclaration' && nameOf(n.id)) declare(nameOf(n.id)!, n);
    if (isFunction(n)) {
      for (const param of n.params as unknown[]) for (const name of patternNames(param)) declareIn(n, name, null);
    }
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
  let boundValues = new Set<string>();
  const visited = new Set<Ast>();
  // 只追踪实际值、对象值、函数返回值及静态绑定键；不扫描任意函数体字面量。
  const staticString = (n: Ast, seen = new Set<Ast>()): string | undefined => {
    if (seen.has(n)) return; seen.add(n);
    if (n.type === 'StringLiteral') return String(n.value);
    if (n.type === 'Identifier') { const declaration = resolve(String(n.name), n); if (declaration) return staticString(declaration, seen); }
    if (n.type === 'TemplateLiteral' && Array.isArray(n.expressions) && n.expressions.length === 0) return (n.quasis as {value:{cooked:string}}[]).map(q=>q.value.cooked).join('');
    if (n.type === 'BinaryExpression' && n.operator === '+' && node(n.left) && node(n.right)) {
      const left=staticString(n.left,new Set(seen)), right=staticString(n.right,new Set(seen));
      if(left !== undefined && right !== undefined) return left+right;
    }
    return undefined;
  };
  let traceCallback = false;
  const trace = (n: Ast, invoked = false): void => {
    if (visited.has(n)) return; visited.add(n);
    const exact=staticString(n); if(exact !== undefined) { boundValues.add(exact); return; }
    if(n.type === 'Identifier') { const declaration=resolve(String(n.name),n); if(declaration) trace(declaration,invoked); return; }
    if(['JSXExpressionContainer','TSAsExpression','TSSatisfiesExpression','TSNonNullExpression','ParenthesizedExpression'].includes(n.type)) { if(node(n.expression)) trace(n.expression); return; }
    if(n.type === 'ObjectExpression') { for(const p of n.properties as Ast[]) if(p.type === 'ObjectProperty' && node(p.value)) trace(p.value); return; }
    if(n.type === 'ArrayExpression') { for(const value of n.elements as unknown[]) if(node(value)) trace(value); return; }
    if(n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') {
      const property = n.computed && node(n.property) ? staticString(n.property) : nameOf(n.property);
      if (property && ['$setup', '_ctx', '$data', '$options'].includes(nameOf(n.object) ?? '') && declarations.has(property)) trace(declarations.get(property)!);
      else if(n.computed && property !== undefined) boundValues.add(property);
      return;
    }
    if(isFunction(n) && node(n.body)) {
      if(n.body.type !== 'BlockStatement') trace(n.body);
      else for(const statement of n.body.body as Ast[]) {
        if(statement.type === 'ReturnStatement' && node(statement.argument)) trace(statement.argument);
        if(traceCallback && !invoked && statement.type === 'ExpressionStatement' && node(statement.expression) && ['CallExpression', 'OptionalCallExpression'].includes(statement.expression.type)) trace(statement.expression);
        if(statement.type === 'ReturnStatement') break;
      }
      return;
    }
    if(['CallExpression', 'OptionalCallExpression'].includes(n.type) && node(n.callee)) trace(n.callee,true);
    if (n.type === 'ConditionalExpression') { if(node(n.consequent)) trace(n.consequent); if(node(n.alternate)) trace(n.alternate); }
    if (n.type === 'LogicalExpression') { if(node(n.right)) trace(n.right); }
  };
  bindingRoots.forEach(n => trace(n));
  const allBoundValues = boundValues;
  const chartReference = (n: Ast, seen = new Set<Ast>()): boolean => {
    if (seen.has(n)) return false; seen.add(n);
    if (n.type === 'JSXIdentifier') return trustedCharts.has(String(n.name)) && resolve(String(n.name), n)?.type === 'ImportSpecifier';
    if (n.type === 'Identifier') {
      const declaration = resolve(String(n.name), n);
      if (trustedCharts.has(String(n.name)) && declaration?.type === 'ImportSpecifier') return true;
      return !!declaration && chartReference(declaration, seen);
    }
    if (n.type === 'CallExpression' && /resolveComponent$/.test(nameOf(n.callee) ?? '')) {
      const value = (n.arguments as unknown[])[0];
      return node(value) && trustedCharts.has(staticString(value) ?? '') && resolve(staticString(value) ?? '', n)?.type === 'ImportSpecifier';
    }
    if (n.type === 'MemberExpression' && nameOf(n.object) === '$setup') {
      const name = n.computed && node(n.property) ? staticString(n.property) ?? '' : nameOf(n.property) ?? '';
      return trustedCharts.has(name) && resolve(name, n)?.type === 'ImportSpecifier';
    }
    return false;
  };
  const addProps = (n: Ast): void => {
    if (n.type !== 'ObjectExpression') return;
    if ((n.properties as Ast[]).some(prop => prop.type === 'SpreadElement')) return;
    const effective = new Map<string, Ast>();
    for (const prop of n.properties as Ast[]) {
      const key = prop.computed && node(prop.key) ? staticString(prop.key) : nameOf(prop.key) ?? (node(prop.key) ? staticString(prop.key) : undefined);
      if ((key === 'data' || key === 'onPointClick') && node(prop.value)) effective.set(key, prop.value);
    }
    for (const [key, value] of effective) scopedRoots[key as BindingScope['prop']].push(value);
  };
  // 只认可导出组件实际返回的 JSX/VNode；未使用函数与回调中的 JSX 不证明渲染。
  for (const root of roots) walk(root, n => {
    if (!['ExportNamedDeclaration', 'ExportDefaultDeclaration'].includes(n.type)) return;
    if (node(n.declaration)) {
      if (n.declaration.type === 'VariableDeclaration') {
        for (const declaration of n.declaration.declarations as Ast[]) if(node(declaration.init)) exported.add(declaration.init);
      } else if (n.declaration.type === 'Identifier') {
        const value = declarations.get(String(n.declaration.name)); if(value) exported.add(value);
      } else exported.add(n.declaration);
    }
    if (Array.isArray(n.specifiers)) for (const specifier of n.specifiers as Ast[]) {
      const value = declarations.get(nameOf(specifier.local) ?? ''); if(value) exported.add(value);
    }
  });
  const isRendered = (n: Ast): boolean => {
    let returned = false;
    let child: Ast | undefined;
    for (let current: Ast | undefined = n; current; current = parents.get(current)) {
      if (child) {
        if (current.type === 'JSXAttribute') return false;
        if (current.type === 'SequenceExpression' && (current.expressions as Ast[]).at(-1) !== child) return false;
        if (current.type === 'ConditionalExpression') {
          if (child === current.test) return false;
          if (node(current.test) && current.test.type === 'BooleanLiteral') {
            if (child !== (current.test.value ? current.consequent : current.alternate)) return false;
          }
        }
        if (current.type === 'LogicalExpression' && node(current.left) && current.left.type === 'BooleanLiteral') {
          if (child === current.right && ((current.operator === '&&' && !current.left.value) || (current.operator === '||' && current.left.value))) return false;
        }
      }
      if (current.type === 'ReturnStatement') returned = true;
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(current.type)) {
        return exported.has(current) && (returned || (node(current.body) && current.body.type !== 'BlockStatement'));
      }
      if (exported.has(current)) return true;
      child = current;
    }
    return false;
  };
  for (const root of roots) walk(root, n => {
    if (!isRendered(n)) return;
    if (n.type === 'JSXOpeningElement' && chartReference(n.name as Ast)) {
      if ((n.attributes as Ast[]).some(attribute => attribute.type === 'JSXSpreadAttribute')) return;
      const effective = new Map<BindingScope['prop'], Ast>();
      for (const attribute of n.attributes as Ast[]) {
        const key = nameOf(attribute.name);
        if (attribute.type === 'JSXAttribute' && (key === 'data' || key === 'onPointClick') && node(attribute.value)) effective.set(key, attribute.value);
      }
      for (const [key, value] of effective) scopedRoots[key].push(value);
    }
    if (n.type === 'CallExpression' && /(?:createVNode|createBlock)$/.test(nameOf(n.callee) ?? '')) {
      const args = n.arguments as unknown[];
      if (node(args[0]) && chartReference(args[0]) && node(args[1])) addProps(args[1]);
    }
  });
  const lineChartBindings = { data: new Set<string>(), onPointClick: new Set<string>() };
  for (const prop of ['data', 'onPointClick'] as const) {
    boundValues = lineChartBindings[prop]; traceCallback = prop === 'onPointClick'; visited.clear(); scopedRoots[prop].forEach(n => trace(n));
  }
  return { literals, boundValues: allBoundValues, lineChartBindings, codeText: execution.join(' ') };
}
export const EXECUTION_PRIMITIVES = ['eval(', 'Function(', 'child_process', 'process.env', 'import(', 'require(', 'runIn'] as const;
export function expectSafeBinding(source: string, payload: string, scope?: BindingScope): void {
  const scan = scanSource(source, scope?.framework);
  for (const primitive of EXECUTION_PRIMITIVES) expect(scan.codeText, 'AST 不得包含执行原语').not.toContain(primitive);
  expect((scope ? scan.lineChartBindings[scope.prop] : scan.boundValues).has(payload), '危险文本必须可追溯到真实 SDK LineChart prop/callback 绑定，未使用字面量不算证据').toBe(true);
}
export function expectBoundString(source: string, value: string, scope?: BindingScope): void {
  const scan = scanSource(source, scope?.framework);
  expect((scope ? scan.lineChartBindings[scope.prop] : scan.boundValues).has(value), '字符串必须可追溯到指定 SDK LineChart 属性').toBe(true);
}
