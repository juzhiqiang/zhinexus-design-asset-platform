import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { sdkApiAuditMatrix, type SdkApiAuditEntry } from './sdk-api-matrix.js';

type BabelAstNode = {
  type: string;
  [key: string]: unknown;
};

type BabelParserModule = {
  parse(
    input: string,
    options: { sourceType: 'module'; plugins: string[] },
  ): { program: { body: BabelAstNode[] } };
  parseExpression(
    input: string,
    options: { plugins: string[] },
  ): BabelAstNode;
};

type VueTemplateNode = {
  type: number;
  tag?: string;
  props?: Array<{
    type: number;
    name: string;
    arg?: { type: number; content?: string; isStatic?: boolean };
    exp?: { type: number; content?: string };
    value?: { content?: string };
  }>;
  children?: VueTemplateNode[];
};

type VueCompilerSfcModule = {
  parse(source: string): {
    descriptor: {
      scriptSetup: { content: string } | null;
      script: { content: string } | null;
      template: { ast?: VueTemplateNode } | null;
    };
    errors: unknown[];
  };
};

function loadParsers(): {
  babelParse: BabelParserModule['parse'];
  babelParseExpr: BabelParserModule['parseExpression'];
  vueParse: VueCompilerSfcModule['parse'];
} {
  const chartsVuePkg = path.resolve(process.cwd(), 'packages/charts-vue/package.json');
  const reqFromChartsVue = createRequire(chartsVuePkg);
  const vueEntry = reqFromChartsVue.resolve('vue');
  const sfcEntry = createRequire(vueEntry).resolve('@vue/compiler-sfc');
  const babelEntry = createRequire(sfcEntry).resolve('@babel/parser');
  const vueSfc = createRequire(vueEntry)(sfcEntry) as VueCompilerSfcModule;
  const babelParser = createRequire(sfcEntry)(babelEntry) as BabelParserModule;
  return {
    babelParse: babelParser.parse,
    babelParseExpr: babelParser.parseExpression,
    vueParse: vueSfc.parse,
  };
}

export type RejectionRuleCode =
  | 'INVALID_SDK_IMPORT'
  | 'UNKNOWN_OR_FOREIGN_PROP'
  | 'WRONG_EVENT_NAME'
  | 'COMPONENT_NOT_RENDERED'
  | 'LOCAL_SYMBOL_SHADOWING'
  | 'UNRELATED_STRING_LITERAL_ONLY'
  | 'TRAILING_SPREAD_OVERRIDE'
  | 'MISSING_REQUIRED_BINDING'
  | 'UNSAFE_EXECUTABLE_INJECTION';

export type ExpectedGeneratedSpec = {
  componentId: SdkApiAuditEntry['componentId'];
  framework: 'vue' | 'react';
  importSpecifier: string;
  exportName: string;
  styleImport: string;
  readyMethod: string;
  outputExtension: '.vue' | '.tsx';
  propBindings: Array<{ prop: string; sourceKey: string }>;
  callbackBindings: Array<{ event: string; templateBinding: string; handlerKey: string }>;
  mustRetainAsStringKeys: string[];
  forbiddenExecutableSyntax?: string[];
};

export type AssertionResult =
  | { ok: true }
  | { ok: false; violations: Array<{ rule: RejectionRuleCode; message: string }> };

function findAuditEntry(
  componentId: SdkApiAuditEntry['componentId'],
  framework: 'vue' | 'react',
): SdkApiAuditEntry {
  const entry = sdkApiAuditMatrix.find(
    (item) => item.componentId === componentId && item.framework === framework,
  );
  if (!entry) {
    throw new Error(`未找到 SDK API 对照项：${componentId}:${framework}`);
  }
  return entry;
}

function unwrapExpr(node: BabelAstNode | undefined): BabelAstNode | undefined {
  let cur = node;
  while (
    cur &&
    (cur.type === 'ParenthesizedExpression' ||
      cur.type === 'TSAsExpression' ||
      cur.type === 'TSTypeAssertion' ||
      cur.type === 'TSSatisfiesExpression' ||
      cur.type === 'TSNonNullExpression')
  ) {
    cur = cur.expression as BabelAstNode | undefined;
  }
  return cur;
}

function decodeStaticStringNode(node: BabelAstNode | undefined): string | undefined {
  const unwrapped = unwrapExpr(node);
  if (!unwrapped) return undefined;
  if (unwrapped.type === 'StringLiteral' && typeof unwrapped.value === 'string') {
    return unwrapped.value;
  }
  if (unwrapped.type === 'TemplateLiteral') {
    const exprs = (unwrapped.expressions as unknown[] | undefined) ?? [];
    const quasis = (unwrapped.quasis as Array<{ value?: { cooked?: string } }> | undefined) ?? [];
    if (exprs.length === 0 && quasis.length === 1 && typeof quasis[0]?.value?.cooked === 'string') {
      return quasis[0].value.cooked;
    }
  }
  return undefined;
}

function collectPatternIdentifiers(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectPatternIdentifiers(item, out);
    return;
  }
  const obj = node as BabelAstNode;
  if (obj.type === 'Identifier' && typeof obj.name === 'string') {
    out.add(obj.name);
    return;
  }
  if (obj.type === 'AssignmentPattern') {
    collectPatternIdentifiers(obj.left, out);
    return;
  }
  if (obj.type === 'RestElement') {
    collectPatternIdentifiers(obj.argument, out);
    return;
  }
  if (obj.type === 'ObjectPattern') {
    for (const prop of (obj.properties as BabelAstNode[] | undefined) ?? []) {
      if (prop.type === 'ObjectProperty') collectPatternIdentifiers(prop.value, out);
      else collectPatternIdentifiers(prop, out);
    }
    return;
  }
  if (obj.type === 'ArrayPattern') {
    for (const el of (obj.elements as unknown[] | undefined) ?? []) {
      collectPatternIdentifiers(el, out);
    }
  }
}

type BindingScope = {
  strings: Map<string, string>;
  exprs: Map<string, BabelAstNode>;
  fns: Map<string, BabelAstNode>;
  shadowed: Set<string>;
};

function cloneScope(parent: BindingScope): BindingScope {
  return {
    strings: new Map(parent.strings),
    exprs: new Map(parent.exprs),
    fns: new Map(parent.fns),
    shadowed: new Set(parent.shadowed),
  };
}

function applyDeclarationToScope(stmt: BabelAstNode, scope: BindingScope): void {
  const declStmt =
    stmt.type === 'ExportNamedDeclaration' && stmt.declaration
      ? (stmt.declaration as BabelAstNode)
      : stmt;

  if (declStmt.type === 'FunctionDeclaration') {
    const id = declStmt.id as { name?: string } | undefined;
    if (id?.name) {
      scope.shadowed.delete(id.name);
      scope.strings.delete(id.name);
      scope.exprs.delete(id.name);
      scope.fns.set(id.name, declStmt);
    }
    return;
  }

  if (declStmt.type === 'ClassDeclaration') {
    const id = declStmt.id as { name?: string } | undefined;
    if (id?.name) {
      scope.shadowed.add(id.name);
      scope.strings.delete(id.name);
      scope.exprs.delete(id.name);
      scope.fns.delete(id.name);
    }
    return;
  }

  if (declStmt.type === 'VariableDeclaration') {
    for (const decl of (declStmt.declarations as BabelAstNode[] | undefined) ?? []) {
      const id = decl.id as { type?: string; name?: string } | undefined;
      const init = unwrapExpr(decl.init as BabelAstNode | undefined);
      if (id?.type === 'Identifier' && id.name) {
        const decoded = init ? decodeStaticStringNode(init) : undefined;
        if (decoded !== undefined) {
          scope.shadowed.delete(id.name);
          scope.strings.set(id.name, decoded);
          scope.exprs.delete(id.name);
          scope.fns.delete(id.name);
        } else if (
          init &&
          (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
        ) {
          scope.shadowed.delete(id.name);
          scope.strings.delete(id.name);
          scope.exprs.set(id.name, init);
          scope.fns.set(id.name, init);
        } else if (init) {
          scope.shadowed.delete(id.name);
          scope.strings.delete(id.name);
          scope.exprs.set(id.name, init);
          scope.fns.delete(id.name);
        } else {
          scope.shadowed.add(id.name);
          scope.strings.delete(id.name);
          scope.exprs.delete(id.name);
          scope.fns.delete(id.name);
        }
      }
    }
  }
}

function createModuleScope(body: BabelAstNode[]): BindingScope {
  const scope: BindingScope = {
    strings: new Map(),
    exprs: new Map(),
    fns: new Map(),
    shadowed: new Set(),
  };
  for (const stmt of body) {
    applyDeclarationToScope(stmt, scope);
  }
  return scope;
}

function createFunctionScope(parent: BindingScope, fnNode: BabelAstNode): BindingScope {
  const scope = cloneScope(parent);
  const params = (fnNode.params as unknown[] | undefined) ?? [];
  const paramNames = new Set<string>();
  for (const p of params) collectPatternIdentifiers(p, paramNames);
  for (const name of paramNames) {
    scope.shadowed.add(name);
    scope.strings.delete(name);
    scope.exprs.delete(name);
    scope.fns.delete(name);
  }
  return scope;
}

function statementAlwaysTerminates(stmt: BabelAstNode): boolean {
  if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement') {
    return true;
  }
  if (stmt.type === 'BlockStatement') {
    const stmts = (stmt.body as BabelAstNode[] | undefined) ?? [];
    return stmts.some((s) => statementAlwaysTerminates(s));
  }
  if (stmt.type === 'IfStatement') {
    const test = unwrapExpr(stmt.test as BabelAstNode | undefined);
    if (test?.type === 'BooleanLiteral') {
      const branch = test.value ? stmt.consequent : stmt.alternate;
      return branch ? statementAlwaysTerminates(branch as BabelAstNode) : false;
    }
    return (
      Boolean(stmt.consequent) &&
      Boolean(stmt.alternate) &&
      statementAlwaysTerminates(stmt.consequent as BabelAstNode) &&
      statementAlwaysTerminates(stmt.alternate as BabelAstNode)
    );
  }
  return false;
}

type ScopedNode<T> = { node: T; scope: BindingScope };

function collectReachableReturnsFromStatements(
  stmts: BabelAstNode[],
  scope: BindingScope,
  out: Array<ScopedNode<BabelAstNode>>,
): void {
  for (const stmt of stmts) {
    applyDeclarationToScope(stmt, scope);

    if (stmt.type === 'ReturnStatement') {
      if (stmt.argument) {
        out.push({ node: stmt.argument as BabelAstNode, scope: cloneScope(scope) });
      }
      return;
    }
    if (stmt.type === 'ThrowStatement') {
      return;
    }
    if (stmt.type === 'BlockStatement') {
      const innerScope = cloneScope(scope);
      collectReachableReturnsFromStatements(
        (stmt.body as BabelAstNode[] | undefined) ?? [],
        innerScope,
        out,
      );
      if (statementAlwaysTerminates(stmt)) return;
      continue;
    }
    if (stmt.type === 'IfStatement') {
      const test = unwrapExpr(stmt.test as BabelAstNode | undefined);
      if (test?.type === 'BooleanLiteral') {
        const branch = test.value ? stmt.consequent : stmt.alternate;
        if (branch) {
          const branchScope = cloneScope(scope);
          collectReachableReturnsFromStatements([branch as BabelAstNode], branchScope, out);
        }
        if (statementAlwaysTerminates(stmt)) return;
      } else {
        if (stmt.consequent) {
          collectReachableReturnsFromStatements(
            [stmt.consequent as BabelAstNode],
            cloneScope(scope),
            out,
          );
        }
        if (stmt.alternate) {
          collectReachableReturnsFromStatements(
            [stmt.alternate as BabelAstNode],
            cloneScope(scope),
            out,
          );
        }
        if (statementAlwaysTerminates(stmt)) return;
      }
      continue;
    }
    if (stmt.type === 'TryStatement') {
      if (stmt.block) {
        collectReachableReturnsFromStatements(
          [stmt.block as BabelAstNode],
          cloneScope(scope),
          out,
        );
      }
      const handler = stmt.handler as { body?: BabelAstNode } | undefined;
      if (handler?.body) {
        collectReachableReturnsFromStatements([handler.body], cloneScope(scope), out);
      }
      if (stmt.finalizer) {
        collectReachableReturnsFromStatements(
          [stmt.finalizer as BabelAstNode],
          cloneScope(scope),
          out,
        );
      }
    }
  }
}

function collectReturnedExpressions(
  fnNode: BabelAstNode,
  fnScope: BindingScope,
): Array<ScopedNode<BabelAstNode>> {
  const body = unwrapExpr(fnNode.body as BabelAstNode | undefined);
  if (!body) return [];
  if (body.type !== 'BlockStatement') {
    return [{ node: body, scope: fnScope }];
  }
  const out: Array<ScopedNode<BabelAstNode>> = [];
  collectReachableReturnsFromStatements(
    (body.body as BabelAstNode[] | undefined) ?? [],
    cloneScope(fnScope),
    out,
  );
  return out;
}

function isHasOwnPropertyCall(callee: BabelAstNode | undefined): boolean {
  if (!callee || (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression')) {
    return false;
  }
  const prop = callee.property as { type?: string; name?: string } | undefined;
  const obj = callee.object as BabelAstNode | undefined;
  if (prop?.type !== 'Identifier' || prop.name !== 'call') return false;
  if (obj?.type === 'MemberExpression') {
    const innerProp = obj.property as { type?: string; name?: string } | undefined;
    return innerProp?.type === 'Identifier' && innerProp.name === 'hasOwnProperty';
  }
  return false;
}

function extractBoundStringsFromExpr(
  rawNode: unknown,
  scope: BindingScope,
  visitedNodes: Set<unknown> = new Set(),
): Set<string> {
  const found = new Set<string>();
  if (!rawNode || typeof rawNode !== 'object' || visitedNodes.has(rawNode)) {
    return found;
  }
  visitedNodes.add(rawNode);

  const node = unwrapExpr(rawNode as BabelAstNode);
  if (!node) return found;

  if (node.type === 'JSXExpressionContainer') {
    return extractBoundStringsFromExpr(node.expression, scope, visitedNodes);
  }

  const decoded = decodeStaticStringNode(node);
  if (decoded !== undefined) {
    found.add(decoded);
    return found;
  }

  if (node.type === 'Identifier' && typeof node.name === 'string') {
    if (scope.shadowed.has(node.name)) {
      return found;
    }
    const strVal = scope.strings.get(node.name);
    if (strVal !== undefined) {
      found.add(strVal);
      return found;
    }
    const exprVal = scope.exprs.get(node.name);
    if (exprVal) {
      return extractBoundStringsFromExpr(exprVal, scope, visitedNodes);
    }
    return found;
  }

  if (node.type === 'SequenceExpression') {
    const exprs = (node.expressions as BabelAstNode[] | undefined) ?? [];
    if (exprs.length > 0) {
      return extractBoundStringsFromExpr(exprs[exprs.length - 1], scope, visitedNodes);
    }
    return found;
  }

  if (node.type === 'ConditionalExpression') {
    const test = unwrapExpr(node.test as BabelAstNode | undefined);
    if (test?.type === 'BooleanLiteral') {
      return extractBoundStringsFromExpr(
        test.value ? node.consequent : node.alternate,
        scope,
        visitedNodes,
      );
    }
    // 仅评估条件分支结果，绝不把 test 条件字符串当作有效绑定返回值
    for (const branch of [node.consequent, node.alternate]) {
      for (const s of extractBoundStringsFromExpr(branch, scope, visitedNodes)) {
        found.add(s);
      }
    }
    return found;
  }

  if (node.type === 'LogicalExpression') {
    const left = unwrapExpr(node.left as BabelAstNode | undefined);
    if (node.operator === '&&' && left?.type === 'BooleanLiteral' && left.value === false) {
      return found;
    }
    if (node.operator === '||' && left?.type === 'BooleanLiteral' && left.value === true) {
      return extractBoundStringsFromExpr(left, scope, visitedNodes);
    }
    for (const part of [node.left, node.right]) {
      for (const s of extractBoundStringsFromExpr(part, scope, visitedNodes)) {
        found.add(s);
      }
    }
    return found;
  }

  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    for (const s of extractBoundStringsFromExpr(node.object, scope, visitedNodes)) {
      found.add(s);
    }
    if (node.computed) {
      for (const s of extractBoundStringsFromExpr(node.property, scope, visitedNodes)) {
        found.add(s);
      }
    } else {
      const prop = node.property as { type?: string; name?: string } | undefined;
      if (prop?.type === 'Identifier' && prop.name) {
        found.add(prop.name);
      }
    }
    return found;
  }

  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    const callee = unwrapExpr(node.callee as BabelAstNode | undefined);

    // 1. 已知本地函数调用（未遮蔽）：仅追踪其可达 return 表达式，不盲扫参数或丢弃语句
    if (callee?.type === 'Identifier' && typeof callee.name === 'string') {
      if (scope.shadowed.has(callee.name)) {
        return found;
      }
      const localFn = scope.fns.get(callee.name);
      if (localFn) {
        const childScope = createFunctionScope(scope, localFn);
        for (const ret of collectReturnedExpressions(localFn, childScope)) {
          for (const s of extractBoundStringsFromExpr(ret.node, ret.scope, visitedNodes)) {
            found.add(s);
          }
        }
      }
      return found;
    }

    // 2. IIFE 立即调用：仅追踪其可达 return 表达式，忽略丢弃实参或内嵌无效语句
    if (
      callee &&
      (callee.type === 'ArrowFunctionExpression' || callee.type === 'FunctionExpression')
    ) {
      const childScope = createFunctionScope(scope, callee);
      for (const ret of collectReturnedExpressions(callee, childScope)) {
        for (const s of extractBoundStringsFromExpr(ret.node, ret.scope, visitedNodes)) {
          found.add(s);
        }
      }
      return found;
    }

    // 3. 成员方法调用（如 handlers?.[key]?.(ev) 或 Object.prototype.hasOwnProperty.call(obj, key)）
    if (callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression') {
      if (isHasOwnPropertyCall(callee)) {
        const args = (node.arguments as unknown[] | undefined) ?? [];
        for (const arg of args) {
          for (const s of extractBoundStringsFromExpr(arg, scope, visitedNodes)) {
            found.add(s);
          }
        }
        return found;
      }
      return extractBoundStringsFromExpr(callee, scope, visitedNodes);
    }

    // 4. 其他未知调用：失败关闭，不将实参当作有效绑定
    return found;
  }

  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
    const childScope = createFunctionScope(scope, node);
    const body = unwrapExpr(node.body as BabelAstNode | undefined);
    if (!body) return found;
    if (body.type !== 'BlockStatement') {
      return extractBoundStringsFromExpr(body, childScope, visitedNodes);
    }
    for (const ret of collectReturnedExpressions(node, childScope)) {
      for (const s of extractBoundStringsFromExpr(ret.node, ret.scope, visitedNodes)) {
        found.add(s);
      }
    }
    // 块体回调常见写法：(ev) => { props.handlers?.[key]?.(ev); }
    const stmts = (body.body as BabelAstNode[] | undefined) ?? [];
    for (const stmt of stmts) {
      if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement') break;
      if (stmt.type === 'ExpressionStatement' && stmt.expression) {
        const expr = unwrapExpr(stmt.expression as BabelAstNode);
        if (expr?.type === 'CallExpression' || expr?.type === 'OptionalCallExpression') {
          const callee = unwrapExpr(expr.callee as BabelAstNode | undefined);
          if (callee?.type === 'MemberExpression' || callee?.type === 'OptionalMemberExpression') {
            for (const s of extractBoundStringsFromExpr(callee, childScope, visitedNodes)) {
              found.add(s);
            }
          }
        }
      }
    }
    return found;
  }

  return found;
}

function analyzeImportsAndTopShadowing(
  body: BabelAstNode[],
  expected: ExpectedGeneratedSpec,
  violations: Array<{ rule: RejectionRuleCode; message: string }>,
): { hasComponentImport: boolean; localRenderName: string; topShadowed: boolean } {
  let hasComponentImport = false;
  let hasStyleImport = false;
  let localRenderName = expected.exportName;
  let topShadowed = false;

  for (const stmt of body) {
    if (stmt.type === 'ImportDeclaration') {
      const source = stmt.source as { value?: string } | undefined;
      const specifiers = (stmt.specifiers as BabelAstNode[] | undefined) ?? [];
      if (source?.value === expected.styleImport && specifiers.length === 0) {
        hasStyleImport = true;
      }
      if (source?.value === expected.importSpecifier) {
        for (const spec of specifiers) {
          if (spec.type === 'ImportSpecifier') {
            const imported = spec.imported as { name?: string; value?: string } | undefined;
            const local = spec.local as { name?: string } | undefined;
            const importedName = imported?.name ?? imported?.value;
            if (importedName === expected.exportName && local?.name) {
              hasComponentImport = true;
              localRenderName = local.name;
            }
          }
        }
      }
    }
  }

  for (const stmt of body) {
    const declStmt =
      stmt.type === 'ExportNamedDeclaration' && stmt.declaration
        ? (stmt.declaration as BabelAstNode)
        : stmt;
    if (declStmt.type === 'VariableDeclaration') {
      for (const decl of (declStmt.declarations as BabelAstNode[] | undefined) ?? []) {
        const id = decl.id as { type?: string; name?: string } | undefined;
        if (id?.type === 'Identifier' && id.name === localRenderName) {
          topShadowed = true;
        }
      }
    } else if (declStmt.type === 'FunctionDeclaration' || declStmt.type === 'ClassDeclaration') {
      const id = declStmt.id as { name?: string } | undefined;
      if (id?.name === localRenderName) {
        topShadowed = true;
      }
    }
  }

  if (!hasComponentImport || !hasStyleImport) {
    violations.push({
      rule: 'INVALID_SDK_IMPORT',
      message: `缺少真实 SDK 导入（${expected.exportName} from ${expected.importSpecifier} 与 ${expected.styleImport}）`,
    });
  }

  return { hasComponentImport, localRenderName, topShadowed };
}

function collectExportedFunctions(
  body: BabelAstNode[],
  moduleScope: BindingScope,
): BabelAstNode[] {
  const roots: BabelAstNode[] = [];

  for (const stmt of body) {
    if (stmt.type === 'ExportNamedDeclaration') {
      const decl = stmt.declaration as BabelAstNode | undefined;
      if (decl?.type === 'FunctionDeclaration') {
        roots.push(decl);
      } else if (decl?.type === 'VariableDeclaration') {
        for (const d of (decl.declarations as BabelAstNode[] | undefined) ?? []) {
          const init = unwrapExpr(d.init as BabelAstNode | undefined);
          if (
            init &&
            (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
          ) {
            roots.push(init);
          }
        }
      }
      for (const spec of (stmt.specifiers as Array<{ local?: { name?: string } }> | undefined) ?? []) {
        if (spec.local?.name && moduleScope.fns.has(spec.local.name)) {
          roots.push(moduleScope.fns.get(spec.local.name)!);
        }
      }
    } else if (stmt.type === 'ExportDefaultDeclaration') {
      const decl = unwrapExpr(stmt.declaration as BabelAstNode | undefined);
      if (
        decl &&
        (decl.type === 'FunctionDeclaration' ||
          decl.type === 'ArrowFunctionExpression' ||
          decl.type === 'FunctionExpression')
      ) {
        roots.push(decl);
      } else if (decl?.type === 'Identifier' && typeof decl.name === 'string') {
        const target = moduleScope.fns.get(decl.name);
        if (target) roots.push(target);
      }
    }
  }

  return roots;
}

type RenderedJsxHit = {
  element: BabelAstNode;
  scope: BindingScope;
};

function isSymbolShadowedInScope(symbol: string, scope: BindingScope): boolean {
  return (
    scope.shadowed.has(symbol) ||
    scope.strings.has(symbol) ||
    scope.exprs.has(symbol) ||
    scope.fns.has(symbol)
  );
}

function collectRenderedJsxFromExpr(
  rawExpr: unknown,
  localRenderName: string,
  scope: BindingScope,
  visitedFns: Set<BabelAstNode>,
  hits: RenderedJsxHit[],
  shadowingDetected: { value: boolean },
): void {
  const expr = unwrapExpr(rawExpr as BabelAstNode | undefined);
  if (!expr) return;

  if (expr.type === 'JSXElement') {
    const opening = expr.openingElement as BabelAstNode | undefined;
    const nameNode = opening?.name as { type?: string; name?: string } | undefined;
    if (nameNode?.type === 'JSXIdentifier' && nameNode.name === localRenderName && opening) {
      if (isSymbolShadowedInScope(localRenderName, scope)) {
        shadowingDetected.value = true;
      }
      hits.push({ element: opening, scope });
    }
    for (const child of (expr.children as BabelAstNode[] | undefined) ?? []) {
      if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
        collectRenderedJsxFromExpr(
          child,
          localRenderName,
          scope,
          visitedFns,
          hits,
          shadowingDetected,
        );
      } else if (child.type === 'JSXExpressionContainer') {
        collectRenderedJsxFromExpr(
          child.expression,
          localRenderName,
          scope,
          visitedFns,
          hits,
          shadowingDetected,
        );
      }
    }
    return;
  }

  if (expr.type === 'JSXFragment') {
    for (const child of (expr.children as BabelAstNode[] | undefined) ?? []) {
      if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
        collectRenderedJsxFromExpr(
          child,
          localRenderName,
          scope,
          visitedFns,
          hits,
          shadowingDetected,
        );
      } else if (child.type === 'JSXExpressionContainer') {
        collectRenderedJsxFromExpr(
          child.expression,
          localRenderName,
          scope,
          visitedFns,
          hits,
          shadowingDetected,
        );
      }
    }
    return;
  }

  if (expr.type === 'SequenceExpression') {
    const exprs = (expr.expressions as BabelAstNode[] | undefined) ?? [];
    if (exprs.length > 0) {
      collectRenderedJsxFromExpr(
        exprs[exprs.length - 1],
        localRenderName,
        scope,
        visitedFns,
        hits,
        shadowingDetected,
      );
    }
    return;
  }

  if (expr.type === 'ConditionalExpression') {
    const test = unwrapExpr(expr.test as BabelAstNode | undefined);
    if (test?.type === 'BooleanLiteral') {
      collectRenderedJsxFromExpr(
        test.value ? expr.consequent : expr.alternate,
        localRenderName,
        scope,
        visitedFns,
        hits,
        shadowingDetected,
      );
    } else {
      collectRenderedJsxFromExpr(
        expr.consequent,
        localRenderName,
        scope,
        visitedFns,
        hits,
        shadowingDetected,
      );
      collectRenderedJsxFromExpr(
        expr.alternate,
        localRenderName,
        scope,
        visitedFns,
        hits,
        shadowingDetected,
      );
    }
    return;
  }

  if (expr.type === 'LogicalExpression') {
    const left = unwrapExpr(expr.left as BabelAstNode | undefined);
    if (expr.operator === '&&' && left?.type === 'BooleanLiteral' && left.value === false) {
      return;
    }
    if (expr.operator === '||' && left?.type === 'BooleanLiteral' && left.value === true) {
      collectRenderedJsxFromExpr(
        left,
        localRenderName,
        scope,
        visitedFns,
        hits,
        shadowingDetected,
      );
      return;
    }
    collectRenderedJsxFromExpr(
      expr.left,
      localRenderName,
      scope,
      visitedFns,
      hits,
      shadowingDetected,
    );
    collectRenderedJsxFromExpr(
      expr.right,
      localRenderName,
      scope,
      visitedFns,
      hits,
      shadowingDetected,
    );
    return;
  }

  if (expr.type === 'CallExpression' || expr.type === 'OptionalCallExpression') {
    const callee = unwrapExpr(expr.callee as BabelAstNode | undefined);
    if (callee?.type === 'Identifier' && typeof callee.name === 'string') {
      if (scope.shadowed.has(callee.name)) {
        return;
      }
      const targetFn = scope.fns.get(callee.name);
      if (targetFn) {
        collectRenderedJsxFromFunction(
          targetFn,
          localRenderName,
          scope,
          visitedFns,
          hits,
          shadowingDetected,
        );
      }
    }
  }
}

function collectRenderedJsxFromFunction(
  fnNode: BabelAstNode,
  localRenderName: string,
  parentScope: BindingScope,
  visitedFns: Set<BabelAstNode>,
  hits: RenderedJsxHit[],
  shadowingDetected: { value: boolean },
): void {
  if (visitedFns.has(fnNode)) return;
  visitedFns.add(fnNode);

  const fnScope = createFunctionScope(parentScope, fnNode);
  for (const ret of collectReturnedExpressions(fnNode, fnScope)) {
    collectRenderedJsxFromExpr(
      ret.node,
      localRenderName,
      ret.scope,
      visitedFns,
      hits,
      shadowingDetected,
    );
  }
}

function walkVueTemplateReachable(
  node: VueTemplateNode | undefined,
  visitor: (n: VueTemplateNode) => void,
): void {
  if (!node) return;
  const hasStaticFalseVIf = (node.props ?? []).some(
    (p) => p.type === 7 && p.name === 'if' && p.exp?.content?.trim() === 'false',
  );
  if (hasStaticFalseVIf) {
    return;
  }
  visitor(node);
  for (const child of node.children ?? []) {
    walkVueTemplateReachable(child, visitor);
  }
}

function validateExecutableSafety(
  source: string,
  expected: ExpectedGeneratedSpec,
  violations: Array<{ rule: RejectionRuleCode; message: string }>,
): void {
  const strippedLiterals = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  if (/<\/script\s*><\s*script/i.test(strippedLiterals)) {
    violations.push({
      rule: 'UNSAFE_EXECUTABLE_INJECTION',
      message: '检测到未转义的 </script><script> 注入语法',
    });
  }
  for (const forbidden of expected.forbiddenExecutableSyntax ?? []) {
    if (strippedLiterals.includes(forbidden)) {
      violations.push({
        rule: 'UNSAFE_EXECUTABLE_INJECTION',
        message: `检测到危险文本脱离字符串字面量成为可执行语法：${forbidden}`,
      });
    }
  }
}

/**
 * 独立于 B 产品的 SFC/TSX 生成物安全与 API 对齐断言（基于 @babel/parser 与 @vue/compiler-sfc）。
 */
export function assertGeneratedComponentMatchesExpected(
  sourceCode: string,
  expected: ExpectedGeneratedSpec,
): AssertionResult {
  const violations: Array<{ rule: RejectionRuleCode; message: string }> = [];
  const audit = findAuditEntry(expected.componentId, expected.framework);
  const { babelParse, babelParseExpr, vueParse } = loadParsers();

  const allowedPropSet = new Set([
    ...audit.requiredProps.map((p) => p.name),
    ...audit.optionalProps.map((p) => p.name),
  ]);
  const allowedEventSet = new Set(audit.events.map((e) => e.name));

  if (expected.framework === 'react') {
    const ast = babelParse(sourceCode, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const body = ast.program.body;
    const { hasComponentImport, localRenderName, topShadowed } = analyzeImportsAndTopShadowing(
      body,
      expected,
      violations,
    );
    const moduleScope = createModuleScope(body);
    const exportedFns = collectExportedFunctions(body, moduleScope);

    const hits: RenderedJsxHit[] = [];
    const visitedFns = new Set<BabelAstNode>();
    const shadowingDetected = { value: topShadowed };

    for (const fnNode of exportedFns) {
      collectRenderedJsxFromFunction(
        fnNode,
        localRenderName,
        moduleScope,
        visitedFns,
        hits,
        shadowingDetected,
      );
    }

    if (shadowingDetected.value) {
      violations.push({
        rule: 'LOCAL_SYMBOL_SHADOWING',
        message: `存在同名局部声明或参数遮蔽 SDK 组件 ${localRenderName}`,
      });
    }

    if (hits.length === 0) {
      const hasStringOnly = !hasComponentImport && sourceCode.includes(expected.exportName);
      violations.push({
        rule: hasStringOnly ? 'UNRELATED_STRING_LITERAL_ONLY' : 'COMPONENT_NOT_RENDERED',
        message: `TSX 导出组件渲染路径中未实际渲染 <${localRenderName} />`,
      });
    } else {
      for (const hit of hits) {
        const attrs = (hit.element.attributes as BabelAstNode[] | undefined) ?? [];
        const boundPropExprs = new Map<string, unknown>();

        for (const attr of attrs) {
          if (attr.type === 'JSXSpreadAttribute') {
            violations.push({
              rule: 'TRAILING_SPREAD_OVERRIDE',
              message: `禁止在 <${localRenderName} /> 上使用 spread 覆盖属性`,
            });
            continue;
          }
          if (attr.type === 'JSXAttribute') {
            const nameNode = attr.name as { type?: string; name?: string } | undefined;
            if (nameNode?.type === 'JSXIdentifier' && nameNode.name) {
              const attrName = nameNode.name;
              if (attrName === 'point-click') {
                violations.push({
                  rule: 'WRONG_EVENT_NAME',
                  message: 'React 组件禁止使用 Vue 事件名 point-click，应使用 onPointClick',
                });
                continue;
              }
              boundPropExprs.set(attrName, attr.value);
              if (!allowedPropSet.has(attrName) && !allowedEventSet.has(attrName)) {
                violations.push({
                  rule: 'UNKNOWN_OR_FOREIGN_PROP',
                  message: `React <${localRenderName} /> 传入了未定义或跨组件属性：${attrName}`,
                });
              }
            }
          }
        }

        for (const binding of expected.propBindings) {
          if (!binding.sourceKey.trim() || !boundPropExprs.has(binding.prop)) {
            violations.push({
              rule: 'MISSING_REQUIRED_BINDING',
              message: `React <${localRenderName} /> 缺少必需 ${binding.prop} 绑定`,
            });
            continue;
          }
          const referencedKeys = extractBoundStringsFromExpr(
            boundPropExprs.get(binding.prop),
            hit.scope,
          );
          if (!referencedKeys.has(binding.sourceKey)) {
            violations.push({
              rule: 'MISSING_REQUIRED_BINDING',
              message: `React <${localRenderName} /> 的 ${binding.prop} 未绑定预期 sourceKey`,
            });
          }
        }

        for (const cb of expected.callbackBindings) {
          if (!cb.handlerKey.trim() || !boundPropExprs.has(cb.event)) {
            violations.push({
              rule: 'MISSING_REQUIRED_BINDING',
              message: `React <${localRenderName} /> 缺少必需事件绑定 ${cb.event}`,
            });
            continue;
          }
          const referencedHandlers = extractBoundStringsFromExpr(
            boundPropExprs.get(cb.event),
            hit.scope,
          );
          if (!referencedHandlers.has(cb.handlerKey)) {
            violations.push({
              rule: 'MISSING_REQUIRED_BINDING',
              message: `React <${localRenderName} /> 的 ${cb.event} 未绑定预期 handlerKey`,
            });
          }
        }
      }
    }
  } else {
    const parsed = vueParse(sourceCode);
    const scriptContent =
      parsed.descriptor.scriptSetup?.content ?? parsed.descriptor.script?.content ?? '';
    const ast = babelParse(scriptContent, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const body = ast.program.body;
    const { hasComponentImport, localRenderName, topShadowed } = analyzeImportsAndTopShadowing(
      body,
      expected,
      violations,
    );
    const moduleScope = createModuleScope(body);

    if (topShadowed) {
      violations.push({
        rule: 'LOCAL_SYMBOL_SHADOWING',
        message: `Vue <script> 存在同名声明遮蔽 SDK 组件 ${localRenderName}`,
      });
    }

    const renderedTags: VueTemplateNode[] = [];
    walkVueTemplateReachable(parsed.descriptor.template?.ast, (node) => {
      if (node.type === 1 && node.tag === localRenderName) {
        renderedTags.push(node);
      }
    });

    if (renderedTags.length === 0) {
      const hasStringOnly = !hasComponentImport && sourceCode.includes(expected.exportName);
      violations.push({
        rule: hasStringOnly ? 'UNRELATED_STRING_LITERAL_ONLY' : 'COMPONENT_NOT_RENDERED',
        message: `Vue 模板中未实际渲染 <${localRenderName} />`,
      });
    } else {
      for (const el of renderedTags) {
        const boundPropExprs = new Map<string, string>();
        const boundEventExprs = new Map<string, string>();

        for (const prop of el.props ?? []) {
          if (prop.type === 6) {
            const attrName = prop.name;
            if (attrName === 'onPointClick') {
              violations.push({
                rule: 'WRONG_EVENT_NAME',
                message: 'Vue 组件禁止使用 React 事件名 onPointClick，应使用 @point-click',
              });
              continue;
            }
            if (attrName === 'ref' || attrName === 'key' || attrName === 'class' || attrName === 'style') {
              continue;
            }
            const normalized = attrName === 'option-overrides' ? 'optionOverrides' : attrName;
            if (!allowedPropSet.has(normalized)) {
              violations.push({
                rule: 'UNKNOWN_OR_FOREIGN_PROP',
                message: `Vue <${localRenderName} /> 传入了未定义或跨组件属性：${attrName}`,
              });
            }
            boundPropExprs.set(normalized, JSON.stringify(prop.value?.content ?? ''));
          } else if (prop.type === 7) {
            const argName = prop.arg?.content;
            if (prop.name === 'bind' && !argName) {
              violations.push({
                rule: 'TRAILING_SPREAD_OVERRIDE',
                message: `Vue 模板禁止使用 v-bind 覆盖 <${localRenderName} /> 绑定`,
              });
              continue;
            }
            if (prop.name === 'on' && argName === 'onPointClick') {
              violations.push({
                rule: 'WRONG_EVENT_NAME',
                message: 'Vue 组件禁止使用 React 事件名 onPointClick，应使用 @point-click',
              });
              continue;
            }
            if (prop.name === 'bind' && argName) {
              const normalized = argName === 'option-overrides' ? 'optionOverrides' : argName;
              if (!allowedPropSet.has(normalized)) {
                violations.push({
                  rule: 'UNKNOWN_OR_FOREIGN_PROP',
                  message: `Vue <${localRenderName} /> 传入了未定义或跨组件属性：${argName}`,
                });
              }
              boundPropExprs.set(normalized, prop.exp?.content ?? '');
            }
            if (prop.name === 'on' && argName) {
              if (!allowedEventSet.has(argName)) {
                violations.push({
                  rule: 'UNKNOWN_OR_FOREIGN_PROP',
                  message: `Vue <${localRenderName} /> 绑定了未定义事件：${argName}`,
                });
              }
              boundEventExprs.set(argName, prop.exp?.content ?? '');
            }
          }
        }

        for (const binding of expected.propBindings) {
          const exprCode = boundPropExprs.get(binding.prop);
          if (!binding.sourceKey.trim() || !exprCode) {
            violations.push({
              rule: 'MISSING_REQUIRED_BINDING',
              message: `Vue <${localRenderName} /> 缺少必需 ${binding.prop} 绑定`,
            });
            continue;
          }
          try {
            const exprAst = babelParseExpr(exprCode, { plugins: ['typescript'] });
            const referencedKeys = extractBoundStringsFromExpr(exprAst, moduleScope);
            if (!referencedKeys.has(binding.sourceKey)) {
              violations.push({
                rule: 'MISSING_REQUIRED_BINDING',
                message: `Vue <${localRenderName} /> 的 ${binding.prop} 未绑定预期 sourceKey`,
              });
            }
          } catch {
            violations.push({
              rule: 'MISSING_REQUIRED_BINDING',
              message: `Vue <${localRenderName} /> 的 ${binding.prop} 表达式无法解析`,
            });
          }
        }

        for (const cb of expected.callbackBindings) {
          const exprCode = boundEventExprs.get(cb.event);
          if (!cb.handlerKey.trim() || !exprCode) {
            violations.push({
              rule: 'MISSING_REQUIRED_BINDING',
              message: `Vue <${localRenderName} /> 缺少必需事件绑定 ${cb.event}`,
            });
            continue;
          }
          try {
            const exprAst = babelParseExpr(exprCode, { plugins: ['typescript'] });
            const referencedHandlers = extractBoundStringsFromExpr(exprAst, moduleScope);
            if (!referencedHandlers.has(cb.handlerKey)) {
              violations.push({
                rule: 'MISSING_REQUIRED_BINDING',
                message: `Vue <${localRenderName} /> 的 ${cb.event} 未绑定预期 handlerKey`,
              });
            }
          } catch {
            violations.push({
              rule: 'MISSING_REQUIRED_BINDING',
              message: `Vue <${localRenderName} /> 的 ${cb.event} 表达式无法解析`,
            });
          }
        }
      }
    }
  }

  validateExecutableSafety(sourceCode, expected, violations);

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

export const EXPECTED_FROZEN_MANIFEST_SHA256 =
  '04a7c4fb267dd2fe760c9c10f3706d28e23d03a5a0cc0fc3be8c6a2963f50aa1';

/**
 * 只读核对冻结 SDK bundle 的 manifest.json SHA-256 与 0.0.11 / 0.0.12 逐包版本，不重新打包。
 */
export function verifyFrozenSdkManifestReadOnly(bundleDir: string): {
  manifestSha256: string;
  packages: Record<string, string>;
} {
  const manifestPath = path.join(bundleDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`冻结 manifest 不存在：${manifestPath}`);
  }
  const bytes = readFileSync(manifestPath);
  const manifestSha256 = createHash('sha256').update(bytes).digest('hex');
  if (manifestSha256 !== EXPECTED_FROZEN_MANIFEST_SHA256) {
    throw new Error(
      `冻结 manifest SHA-256 不匹配：期望 ${EXPECTED_FROZEN_MANIFEST_SHA256}，实际 ${manifestSha256}`,
    );
  }
  const parsed = JSON.parse(bytes.toString('utf8')) as {
    packages: Array<{ name: string; version: string }>;
  };
  const packages: Record<string, string> = {};
  for (const pkg of parsed.packages) {
    packages[pkg.name] = pkg.version;
  }
  return { manifestSha256, packages };
}
