import ts from 'typescript';
import posix from 'node:path/posix';
import { createHash } from 'node:crypto';
import { buildCallGraph } from './callgraph.mjs';
import { makeRepairPlan } from './knowledge.mjs';
import { analyzeArchitecture } from './insight.mjs';
import { buildRefactorBlueprint } from './refactor-blueprint.mjs';
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const EXCLUDES = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|vendor|\.cache|out|\.turbo)(\/|$)/;
const SOURCE = /\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/i;

const sha = data => createHash('sha256').update(data).digest('hex');
const lineAt = (source, start) => source.getLineAndCharacterOfPosition(start).line + 1;
const hasModifier = (node, kind) => !!node.modifiers?.some(m => m.kind === kind);
const normalize = text => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const isIdent = node => ts.isIdentifier(node);

function newFinding(rule, severity, confidence, file, line, title, detail, recommendation, more = {}) {
  return { id: '', rule, severity, confidence, location: { file, line }, title, detail, recommendation, ...more };
}
function sourceKind(name) {
  if (/\.tsx$/i.test(name)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(name)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(name)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
function resolveLocal(from, spec, files) {
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  if (base.startsWith('../') || base.startsWith('/')) return null;
  const tries = [base, ...EXTENSIONS.map(x => base + x), ...EXTENSIONS.map(x => posix.join(base, 'index' + x))];
  for (const candidate of tries) if (files.has(candidate)) return candidate;
  return null;
}
function entryPoints(files, graph) {
  const entries = new Set();
  const pkg = files.get('package.json');
  if (pkg) {
    try {
      const cfg = JSON.parse(pkg.toString('utf8'));
      const refs = [];
      for (const key of ['main', 'module', 'browser', 'types', 'typings']) if (typeof cfg[key] === 'string') refs.push(cfg[key]);
      if (typeof cfg.bin === 'string') refs.push(cfg.bin);
      else if (cfg.bin && typeof cfg.bin === 'object') refs.push(...Object.values(cfg.bin));
      function collectExports(x) { if (typeof x === 'string') refs.push(x); else if (x && typeof x === 'object') Object.values(x).forEach(collectExports); }
      collectExports(cfg.exports);
      for (const value of refs) if (typeof value === 'string') {
        const base = value.replace(/^\.\//, '');
        const f = resolveLocal('root.ts', './' + base, graph) || (graph.has(base) ? base : null);
        if (f) entries.add(f);
      }
    } catch { /* other checks will flag broken package.json */ }
  }
  for (const name of graph.keys()) {
    if (/(^|\/)(main|index|server|app|App|cli|bootstrap|entry)\.[cm]?[jt]sx?$/i.test(name) ||
      /(^|\/)(__tests__|tests|test|spec|pages|routes|app|api)\//i.test(name) ||
      /\.(test|spec)\.[cm]?[jt]sx?$/i.test(name)) entries.add(name);
  }
  for (const [name, data] of files) if (/\.html?$/i.test(name) && data.length < 500000) {
    const html = data.toString('utf8');
    for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
      const spec = m[1].split(/[?#]/)[0].replace(/^\//, '');
      const target = resolveLocal(name, './' + spec, graph);
      if (target) entries.add(target);
    }
  }
  return entries;
}
function tarjan(graph) {
  const index = new Map(), low = new Map(), stack = [], on = new Set(), groups = [];
  let current = 0;
  function dfs(node) {
    index.set(node, current); low.set(node, current++); stack.push(node); on.add(node);
    for (const next of graph.get(node) || []) {
      if (!index.has(next)) { dfs(next); low.set(node, Math.min(low.get(node), low.get(next))); }
      else if (on.has(next)) low.set(node, Math.min(low.get(node), index.get(next)));
    }
    if (low.get(node) === index.get(node)) {
      const scc = []; let part;
      do { part = stack.pop(); on.delete(part); scc.push(part); } while (part !== node);
      if (scc.length > 1 || graph.get(node)?.has(node)) groups.push(scc.sort());
    }
  }
  for (const node of graph.keys()) if (!index.has(node)) dfs(node);
  return groups;
}
function countUses(sf, symbol, excludedNode) {
  let count = 0;
  function visit(node) {
    if (node === excludedNode) return;
    if (isIdent(node) && node.text === symbol) count++;
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}
function importSpecifiers(node, sf) {
  const result = [];
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) result.push(node.moduleSpecifier.text);
  if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) result.push(node.moduleSpecifier.text);
  // The caller visits each AST node already; do not recursively walk here.
  // Rewalking subtrees at every node would be quadratic for large projects.
  if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword || (isIdent(node.expression) && node.expression.text === 'require')) result.push(node.arguments[0].text);
  }
  return result;
}
function collectFunctions(sf, name, functions) {
  function visit(node) {
    let symbol = null, body = null;
    if (ts.isFunctionDeclaration(node) && node.name && node.body) { symbol = node.name.text; body = node.body; }
    if (ts.isVariableDeclaration(node) && isIdent(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      symbol = node.name.text; body = node.initializer.body;
    }
    if (symbol && body) {
      const text = normalize(body.getText(sf));
      if (text.length >= 70) functions.push({ symbol, file: name, line: lineAt(sf, node.getStart(sf)), signature: sha(text), body: text });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}

export function scanFiles(inputFiles, label = 'Uploaded project') {
  if (!(inputFiles instanceof Map)) throw new Error('scanFiles expects a Map of path -> Buffer');
  const files = new Map([...inputFiles].filter(([name]) => typeof name === 'string' && !EXCLUDES.test(name)));
  const sourceNames = [...files.keys()].filter(name => SOURCE.test(name));
  const parse = new Map(), graph = new Map(), references = [], findings = [], fixes = [], functions = [], externals = new Set();
  const add = f => { findings.push(f); };
  let parseErrors = 0;
  for (const name of sourceNames) {
    const data = files.get(name);
    const sf = ts.createSourceFile(name, data.toString('utf8'), ts.ScriptTarget.Latest, true, sourceKind(name));
    parse.set(name, sf); graph.set(name, new Set());
    if (sf.parseDiagnostics.length) {
      for (const diagnostic of sf.parseDiagnostics.slice(0, 3)) {
        parseErrors++;
        add(newFinding('syntax-error', 'high', 'high', name, lineAt(sf, diagnostic.start ?? 0), 'Source parse error', ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '), 'Correct the syntax error before structural refactoring.'));
      }
    }
    const lines = sf.getLineAndCharacterOfPosition(sf.end).line + 1;
    if (lines > 420) add(newFinding('large-module', 'low', 'high', name, 1, `Large module: ${lines} lines`, 'Large files often combine responsibilities and make maintenance harder.', 'Look for separable cohesive modules; do not split blindly.'));
    collectFunctions(sf, name, functions);
  }
  for (const [name, sf] of parse) {
    const specs = new Set();
    function visit(node) {
      for (const spec of importSpecifiers(node, sf)) specs.add(spec);
      // Only a direct expression check: fetch in a loop is a potentially expensive call.
      if (ts.isIterationStatement(node, false)) {
        function nested(n) {
          if (ts.isCallExpression(n) && isIdent(n.expression) && n.expression.text === 'fetch') {
            add(newFinding('fetch-in-loop', 'medium', 'medium', name, lineAt(sf, n.getStart(sf)), 'Network request inside loop', 'Repeated fetch calls inside a loop may be serialized or excessive.', 'Consider batching, concurrency limits and caching, after checking API semantics.'));
          }
          ts.forEachChild(n, nested);
        }
        nested(node.statement);
      }
      ts.forEachChild(node, visit);
    }
    // Visit once. Collect import targets from declaration nodes, dynamic imports and require calls.
    visit(sf);
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        const target = resolveLocal(name, spec, graph);
        references.push({ from: name, specifier: spec, to: target });
        if (target) graph.get(name).add(target);
        else add(newFinding('unresolved-local-import', 'medium', 'medium', name, 1, `Unresolved import: ${spec}`, `No scanned source module matches the relative import '${spec}'. It could refer to an asset or generated file.`, 'Check path aliases, generated code, filename casing and missing files.'));
      } else if (!spec.startsWith('node:')) externals.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
    }
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause || statement.importClause.name || statement.attributes || statement.assertClause) continue;
      const clause = statement.importClause, bindings = clause.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const kept = [], dropped = [];
      for (const element of bindings.elements) {
        const local = element.name.text;
        if (countUses(sf, local, statement) === 0) dropped.push(local);
        else kept.push(element);
      }
      if (!dropped.length) continue;
      const quote = statement.moduleSpecifier.getText(sf);
      const replacement = kept.length ? `import ${clause.isTypeOnly ? 'type ' : ''}{ ${kept.map(x => x.getText(sf)).join(', ')} } from ${quote};` : (clause.isTypeOnly ? '' : `import ${quote};`);
      const start = statement.getStart(sf), end = statement.getEnd(), before = sf.text.slice(start, end);
      const fixId = `fix-${fixes.length + 1}`;
      fixes.push({ id: fixId, rule: 'unused-named-import', file: name, start, end, before, after: replacement, fileHash: sha(files.get(name)), description: `Remove unused named bindings: ${dropped.join(', ')}. Side-effect imports are preserved.` });
      add(newFinding('unused-named-import', 'medium', 'medium', name, lineAt(sf, start), `Unused import binding${dropped.length > 1 ? 's' : ''}: ${dropped.join(', ')}`, 'No identifier reference to these imported names was found within this source file.', 'Preview and approve the proposed AST-informed import rewrite.', { fixId, evidence: dropped }));
    }
  }
  const groups = new Map();
  for (const fn of functions) {
    if (!groups.has(fn.signature)) groups.set(fn.signature, []);
    groups.get(fn.signature).push(fn);
  }
  for (const matches of groups.values()) if (matches.length > 1) {
    const first = matches[0];
    add(newFinding('duplicate-function-body', 'medium', 'high', first.file, first.line, `Repeated function body in ${matches.length} locations`, matches.map(m => `${m.file}:${m.line} (${m.symbol})`).join(' | '), 'Compare contracts and side effects, then extract common behavior into a shared module. Do not automatically merge functions with different semantics.', { evidence: matches.map(({file, line, symbol}) => ({ file, line, symbol })) }));
  }
  for (const name of graph.keys()) {
    const fanOut=graph.get(name).size,fanIn=[...graph.values()].filter(set=>set.has(name)).length;
    if(fanIn>=10)add(newFinding('high-coupling-hub','medium','medium',name,1,`High-dependency module (${fanIn} dependents)`, 'Structural change can affect many consumers; this is a candidate for a stable facade, not automatically a defect.','Map public contracts and test consumers before extraction.'));
    if(fanOut>=12)add(newFinding('excessive-fan-out','medium','medium',name,1,`Broad-coupling module (${fanOut} dependencies)`,'Module depends on many other source modules; it may be an orchestration root.','Separate cohesive responsibilities only after reviewing architecture intent.'));
  }
  for (const cycle of tarjan(graph)) {
    add(newFinding('circular-dependency', 'high', 'high', cycle[0], 1, `${cycle.length}-module dependency cycle`, cycle.join(' → '), 'Split shared interfaces/types from implementation, or invert a dependency to break the cycle.', { evidence: cycle }));
  }
  const entries = entryPoints(files, graph);
  if (entries.size) {
    const visited = new Set(), queue = [...entries];
    while (queue.length) {
      const name = queue.shift();
      if (visited.has(name)) continue;
      visited.add(name);
      for (const next of graph.get(name) || []) queue.push(next);
    }
    for (const name of graph.keys()) if (!visited.has(name)) {
      add(newFinding('unreachable-from-known-entrypoints', 'low', 'low', name, 1, 'Module not reachable from detected entry points', 'No static import chain reaches this source file from conventional entry points. It may still be loaded dynamically by framework routing or runtime logic.', 'Inspect framework conventions and runtime behavior before deleting or moving this file.'));
    }
  }
  for (const [name, data] of files) if (name.endsWith('package.json')) {
    try { JSON.parse(data.toString('utf8')); }
    catch { add(newFinding('invalid-package-json', 'high', 'high', name, 1, 'Invalid package.json', 'The manifest could not be parsed as JSON.', 'Correct JSON formatting and validate dependency metadata.')); }
  }
  findings.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] - { high: 0, medium: 1, low: 2 }[b.severity]) || a.location.file.localeCompare(b.location.file));
  findings.forEach((f, i) => f.id = `finding-${i+1}`);
  const callGraph = buildCallGraph(files);
  const report = {
    schemaVersion: '1.0', generatedAt: new Date().toISOString(), project: label,
    summary: { sourceFiles: parse.size, totalFiles: files.size, importEdges: references.filter(r => r.to).length, entrypoints: entries.size, parseErrors, findings: findings.length, safeFixCandidates: fixes.length, bySeverity: Object.fromEntries(['high','medium','low'].map(s => [s, findings.filter(f => f.severity === s).length])) },
    limitations: [
      'Static TypeScript/JavaScript AST analysis only; no runtime tracing or full semantic/type checking.',
      'Entry-point reachability is heuristic. Framework routes, reflection, plugins and dynamic entry points can look unused.',
      'Duplicate bodies may intentionally differ in contracts or side effects; no automatic merging.',
      'Import rewrites are reviewable candidates, not guarantees. Builds and regression tests are not run on uploaded code.',
      'Sources are scanned without executing third-party code; no npm install, build scripts or postinstall scripts are invoked.',
      'Call graph is a partial heuristic and never establishes safe deletion or full reachability.'
    ],
    graph: { nodes: [...graph.keys()], edges: references, entrypoints: [...entries], calls: callGraph },
    findings, fixes,
    agentTask: buildAgentTask(label, findings)
  };
  report.architecture = analyzeArchitecture(report);
  report.refactorBlueprint = buildRefactorBlueprint(report);
  report.repairPlan = makeRepairPlan(report);
  report.summary.directFunctionCalls = callGraph.edges.length;
  report.summary.functionSymbols = callGraph.nodes.filter(n => n.kind === 'function').length;
  return report;
}
export function buildAgentTask(project, findings) {
  const work = findings.map(f => `- [${f.severity}] ${f.rule} at ${f.location.file}:${f.location.line}: ${f.title}. ${f.recommendation}`).join('\n');
  return `# Code Architect · repair task\nProject: ${project}\n\nReview the actual codebase and verify each scanner finding before editing. Preserve application behavior and API contracts. Work in a separate branch or copy, propose targeted patches, and run relevant tests in a trusted, isolated environment. Never delete code solely because reachability heuristics flag it. Do not expose secrets.\n\n## Findings to investigate\n${work || 'No findings were produced.'}\n\n## Deliverables\n1. Confirmed findings with source evidence and call-path explanation.\n2. A minimal file-by-file repair plan.\n3. Reviewed patch/diff, with changes separated by category.\n4. Build/test logs and remaining uncertainties.\n`;
}
export function applySelectedFixes(originalFiles, report, ids) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('Select unique fix IDs');
  const selected = ids.map(id => { const fix = report.fixes.find(f => f.id === id); if (!fix) throw new Error(`Unknown fix ${id}`); return fix; });
  const byFile = new Map();
  for (const fix of selected) { if (!byFile.has(fix.file)) byFile.set(fix.file, []); byFile.get(fix.file).push(fix); }
  const output = new Map(originalFiles);
  for (const [file, patches] of byFile) {
    const original = output.get(file);
    if (!original || sha(original) !== patches[0].fileHash) throw new Error(`Source changed since scan: ${file}`);
    let source = original.toString('utf8'), lastStart = source.length + 1;
    for (const patch of patches.sort((a, b) => b.start - a.start)) {
      if (patch.end > lastStart) throw new Error(`Overlapping changes to ${file}`);
      if (source.slice(patch.start, patch.end) !== patch.before) throw new Error(`Patch source mismatch in ${file}`);
      source = source.slice(0, patch.start) + patch.after + source.slice(patch.end);
      lastStart = patch.start;
    }
    output.set(file, Buffer.from(source));
  }
  return output;
}
