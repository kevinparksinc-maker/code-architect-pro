import ts from 'typescript';
import posix from 'node:path/posix';
const SOURCE = /\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/i;
const EXCLUDE = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|vendor|\.cache|out|\.turbo)(\/|$)/;
const EXTS = ['.ts','.tsx','.js','.jsx','.mjs','.cjs','.mts','.cts'];
function resolve(from, spec, names) {
  if (!spec.startsWith('.')) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  if (base.startsWith('../') || base.startsWith('/')) return null;
  const candidates = [base, ...EXTS.map(ext => base + ext), ...EXTS.map(ext => posix.join(base, 'index' + ext))];
  return candidates.find(candidate => names.has(candidate)) || null;
}
function getSource(name, code) {
  const kind = /\.tsx$/i.test(name) ? ts.ScriptKind.TSX : /\.jsx$/i.test(name) ? ts.ScriptKind.JSX : /\.[cm]?js$/i.test(name) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(name, code.toString('utf8'), ts.ScriptTarget.Latest, true, kind);
}
const findName = (node) => ts.isIdentifier(node) ? node.text : null;
const isFn = node => ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node);
function currentScope(node) {
  let n = node.parent;
  while (n) {
    if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
    if (ts.isMethodDeclaration(n) && n.name && ts.isIdentifier(n.name)) return n.name.text;
    if (ts.isVariableDeclaration(n) && n.initializer && isFn(n.initializer) && ts.isIdentifier(n.name)) return n.name.text;
    n = n.parent;
  }
  return '<module>';
}
function collect(sf) {
  const names = new Map();
  const imports = new Map();
  const nsImports = new Map();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const spec = statement.moduleSpecifier.text, clause = statement.importClause;
    if (clause?.name) imports.set(clause.name.text, { spec, imported: 'default' });
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const b of bindings.elements) imports.set(b.name.text, { spec, imported: b.propertyName?.text || b.name.text });
    if (bindings && ts.isNamespaceImport(bindings)) nsImports.set(bindings.name.text, { spec });
  }
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) names.set(node.name.text, { line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, exported: !!node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) });
    if (ts.isVariableDeclaration(node) && node.initializer && isFn(node.initializer) && ts.isIdentifier(node.name)) {
      const top = node.parent?.parent;
      const exported = !!top?.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
      names.set(node.name.text, { line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, exported });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return { sf, names, imports, nsImports };
}
/** Conservative direct-call references; reflection / dynamic calls cannot be resolved. */
export function buildCallGraph(files) {
  const names = new Set([...files.keys()].filter(n => SOURCE.test(n) && !EXCLUDE.test(n)));
  const modules = new Map();
  for (const name of names) modules.set(name, collect(getSource(name, files.get(name))));
  const nodes = [], edges = [], unresolved = [];
  for (const [file, {names: defs}] of modules) {
    nodes.push({id: `${file}::<module>`, file, symbol:'<module>', kind:'module'});
    for (const [symbol, meta] of defs) nodes.push({id: `${file}::${symbol}`, file, symbol, line: meta.line, exported: meta.exported, kind:'function'});
  }
  const nodeIds = new Set(nodes.map(n => n.id));
  for (const [file, {sf, names: defs, imports, nsImports}] of modules) {
    function record(node) {
      if (!ts.isCallExpression(node)) return;
      const caller = `${file}::${currentScope(node)}`;
      const from = nodeIds.has(caller) ? caller : `${file}::<module>`;
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const expr = node.expression;
      let to = null, resolution = null;
      if (ts.isIdentifier(expr)) {
        const symbol = expr.text;
        if (imports.has(symbol)) {
          const source = imports.get(symbol);
          const target = resolve(file, source.spec, names);
          if (target && modules.get(target)?.names.has(source.imported)) {
            to = `${target}::${source.imported}`; resolution = 'static-named-import';
          }
        } else if (defs.has(symbol)) { to = `${file}::${symbol}`; resolution = 'same-module'; }
      } else if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
        const ns = nsImports.get(expr.expression.text);
        if (ns) {
          const target = resolve(file, ns.spec, names);
          if (target && modules.get(target)?.names.has(expr.name.text)) { to = `${target}::${expr.name.text}`; resolution = 'static-namespace-import'; }
        }
      }
      if (to) edges.push({from, to, file, line, resolution, confidence: 'medium'});
      else unresolved.push({file, line, expression: expr.getText(sf).slice(0, 160), reason: 'Call cannot be resolved safely by this limited static analysis.'});
    }
    function visit(node) { record(node); ts.forEachChild(node, visit); }
    visit(sf);
  }
  return {kind: 'partial-static-call-graph', nodes, edges, unresolved, limitations: [
    'Only direct named and namespace imports and same-module function calls are resolved; exported aliasing, default exports, higher-order calls, object methods, overloads, and dynamic calls may be missed.',
    'No claim is made that a function is dead based on this graph. Function names may be shadowed; treat cross-file edges as hypotheses.',
    'A TypeScript type-checker and language-service index are required for reliable symbol-level references.'
  ]};
}
