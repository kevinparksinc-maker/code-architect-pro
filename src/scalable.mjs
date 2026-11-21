/** Disk-backed, incremental JS/TS architecture scanner.
 * No preset file-count/source-size cap. Reads and parses one source file at a time.
 * Memory use remains dependent on the graph and report size, and on the largest source file.
 */
import ts from 'typescript';
import {readdir, readFile, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import posix from 'node:path/posix';
import {makeRepairPlan} from './knowledge.mjs';
import {analyzeArchitecture} from './insight.mjs';
import {buildRefactorBlueprint} from './refactor-blueprint.mjs';
import {buildAgentTask} from './engine.mjs';
import {createProjectResolver} from './project-resolution.mjs';
const SOURCE=/\.(?:[cm]?ts|[cm]?js|tsx|jsx)$/i;
const EXCLUDE=new Set(['node_modules','.git','.next','.turbo','.cache','dist','build','coverage','vendor','out']);
const hash=s=>createHash('sha256').update(s).digest('hex');
const lineno=(sf,n)=>sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1;
const kind=name=>name.endsWith('.tsx')?ts.ScriptKind.TSX:name.endsWith('.jsx')?ts.ScriptKind.JSX:/\.[cm]?js$/.test(name)?ts.ScriptKind.JS:ts.ScriptKind.TS;
const normalize=s=>s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'').replace(/\s+/g,' ').trim();
const findName=n=>ts.isIdentifier(n)?n.text:null;
async function* walk(root, relative='') {
  for (const item of await readdir(path.join(root,relative),{withFileTypes:true})) {
    if (EXCLUDE.has(item.name)) continue;
    const name=posix.join(relative,item.name);
    if (item.isSymbolicLink()) continue;
    if (item.isDirectory()) yield* walk(root,name);
    else if (item.isFile()) yield name;
  }
}
function components(graph) {
  // Iterative Kosaraju avoids stack overflow on very large dependency chains.
  const reversed=new Map([...graph.keys()].map(k=>[k,[]]));
  for (const [from,tos] of graph) for(const to of tos) if(reversed.has(to)) reversed.get(to).push(from);
  const visited=new Set(),order=[];
  for(const first of graph.keys()) {
    if(visited.has(first))continue;
    const stack=[[first,false]];
    while(stack.length){const [n,done]=stack.pop();if(done){order.push(n);continue;}if(visited.has(n))continue;visited.add(n);stack.push([n,true]);for(const next of graph.get(n)||[])if(!visited.has(next))stack.push([next,false]);}
  }
  const groups=[],found=new Set();
  while(order.length){const start=order.pop();if(found.has(start))continue;const group=[],todo=[start];found.add(start);
    while(todo.length){const n=todo.pop();group.push(n);for(const child of reversed.get(n)||[])if(!found.has(child)){found.add(child);todo.push(child);}}
    if(group.length>1||graph.get(start)?.has(start))groups.push(group.sort());
  }
  return groups;
}
function collectImports(sf) {
  const imports = new Map(), namespaces = new Map(), specs = [];
  const add = (specifier, kind, node) => specs.push({specifier, kind, line:lineno(sf,node)});
  for (const node of sf.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const allInlineTypes = !clause?.name && bindings && ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 && bindings.elements.every(binding=>binding.isTypeOnly);
      add(spec, clause?.isTypeOnly ? 'type' : allInlineTypes ? 'inline-type' : 'runtime', node);
      if (clause?.isTypeOnly) continue;
      if (clause?.name) imports.set(clause.name.text,{spec,original:'default'});
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          if (!binding.isTypeOnly) imports.set(binding.name.text,{spec,original:binding.propertyName?.text ?? binding.name.text});
        }
      }
      if (bindings && ts.isNamespaceImport(bindings)) namespaces.set(bindings.name.text,spec);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const inlineTypes = clause && ts.isNamedExports(clause) && clause.elements.length > 0 &&
        clause.elements.every(binding=>binding.isTypeOnly);
      add(node.moduleSpecifier.text, node.isTypeOnly ? 'type' : inlineTypes ? 'inline-type' : 'runtime', node);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
      add(node.moduleReference.expression.text,node.isTypeOnly ? 'type' : 'runtime',node);
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind===ts.SyntaxKind.ImportKeyword) add(node.arguments[0].text,'dynamic',node);
      if (findName(node.expression)==='require') add(node.arguments[0].text,'runtime',node);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      add(node.argument.literal.text,'type',node);
    }
    ts.forEachChild(node,visit);
  }
  visit(sf);
  return {imports,namespaces,specs};
}
function scope(n) {let p=n.parent;while(p){if(ts.isFunctionDeclaration(p)&&p.name)return p.name.text;
  if(ts.isVariableDeclaration(p)&&ts.isIdentifier(p.name)&&p.initializer&&(ts.isArrowFunction(p.initializer)||ts.isFunctionExpression(p.initializer)))return p.name.text;
  p=p.parent;}return '<module>';}
function newFinding(rule,severity,confidence,file,line,title,detail,recommendation,evidence) {
  return {id:'',rule,severity,confidence,location:{file,line},title,detail,recommendation,...(evidence?{evidence}:{})};
}
function isEntry(f) {return /(^|\/)(main|index|server|app|App|cli|bootstrap|entry)\.[cm]?[jt]sx?$/i.test(f)||/(^|\/)(__tests__|tests|test|spec|pages|routes|app|api)\//i.test(f)||/\.(test|spec)\.[cm]?[jt]sx?$/i.test(f);}

export async function scanLargeDirectory(directory, options={}) {
  const started=performance.now(), root=path.resolve(directory), name=options.label||path.basename(root);
  if(!(await lstat(root)).isDirectory())throw new Error('Expected an extracted project directory');
  const sources=[],allNames=new Set();let totalFiles=0;
  for await (const file of walk(root)){ totalFiles++;allNames.add(file);if(SOURCE.test(file))sources.push(file); }
  const sourceSet=new Set(sources), graph=new Map(sources.map(f=>[f,new Set()]));
  const resolver = createProjectResolver(root,allNames,sourceSet);
  const eager = new Map(sources.map(file=>[file,new Set()]));
  const staticDependencies = new Map(sources.map(file=>[file,new Set()]));
  const findings=[],fixes=[],references=[],fnGroups=new Map(),moduleInfo=new Map(),pendingCalls=[];
  const callNodes=[],callEdges=[],unresolved=[];
  let parseErrors=0,processedBytes=0, externals=new Set();
  for(let i=0;i<sources.length;i++){
    const file=sources[i], raw=await readFile(path.join(root,file)), text=raw.toString('utf8');processedBytes+=raw.length;
    const sf=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,kind(file));
    for(const d of sf.parseDiagnostics){parseErrors++;findings.push(newFinding('syntax-error','high','high',file,sf.getLineAndCharacterOfPosition(d.start||0).line+1,'Source parse error',ts.flattenDiagnosticMessageText(d.messageText,' '),'Correct source syntax before refactoring.'));}
    const lines=sf.getLineAndCharacterOfPosition(sf.end).line+1;
    if(lines>420)findings.push(newFinding('large-module','low','medium',file,1,`Large module: ${lines} lines`,'Potentially mixes responsibilities; size alone is not a defect.','Extract cohesive responsibilities only after caller and contract review.'));
    const {imports,namespaces,specs}=collectImports(sf),functions=new Map();
    callNodes.push({id:`${file}::<module>`,file,symbol:'<module>',kind:'module'});
    function visit(n){
      let sym=null,body=null;
      if(ts.isFunctionDeclaration(n)&&n.name&&n.body){sym=n.name.text;body=n.body;}
      if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer&&(ts.isArrowFunction(n.initializer)||ts.isFunctionExpression(n.initializer))){sym=n.name.text;body=n.initializer.body;}
      if(sym&&body){
        functions.set(sym,{line:lineno(sf,n)});
        const normalized=normalize(body.getText(sf));
        if(normalized.length>70){const signature=hash(normalized);if(!fnGroups.has(signature))fnGroups.set(signature,[]);fnGroups.get(signature).push({file,line:lineno(sf,n),symbol:sym});}
      }
      if(ts.isCallExpression(n)){
        const expr=n.expression;
        const caller=scope(n),line=lineno(sf,n);
        if(ts.isIdentifier(expr))pendingCalls.push({file,caller,line,local:expr.text,imported:imports.get(expr.text)});
        else if(ts.isPropertyAccessExpression(expr)&&ts.isIdentifier(expr.expression)&&namespaces.has(expr.expression.text))pendingCalls.push({file,caller,line,namespace:namespaces.get(expr.expression.text),member:expr.name.text});
        else unresolved.push({file,line,reason:'Dynamic/member call not resolved by static scanner',expression:expr.getText(sf).slice(0,120)});
      }
      if(ts.isIterationStatement(n,false)){
        function nested(inner){if(ts.isCallExpression(inner)&&findName(inner.expression)==='fetch')findings.push(newFinding('fetch-in-loop','medium','medium',file,lineno(sf,inner),'Fetch inside loop','Repeated requests may be expensive, sequential or rate limited.','Benchmark and evaluate batching or bounded concurrency without changing ordering.'));ts.forEachChild(inner,nested);}nested(n.statement);
      }
      if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='forEach'&&n.arguments.some(a=>ts.isArrowFunction(a)&&a.modifiers?.some(m=>m.kind===ts.SyntaxKind.AsyncKeyword)))
        findings.push(newFinding('async-foreach','high','high',file,lineno(sf,n),'Async callback passed to forEach','forEach does not await returned promises; errors and completion ordering may be lost.','Evaluate for...of with await or bounded Promise.allSettled, preserving required ordering.'));
      if(ts.isTryStatement(n)&&n.catchClause?.block.statements.length===0)
        findings.push(newFinding('empty-catch','medium','high',file,lineno(sf,n),'Empty catch block','Error handling may silently swallow failures.','Confirm intentional handling; log/rethrow/recover with domain-appropriate behavior.'));
      ts.forEachChild(n,visit);
    }
    visit(sf);
    moduleInfo.set(file,{functions});
    for (const {specifier,kind:declaredKind,line} of specs) {
      const {target:to,local,asset,verbatim} = resolver.resolve(file,specifier);
      const kind = /\.d\.[cm]?ts$/i.test(file) || /\.d\.[cm]?ts$/i.test(to ?? '') ? 'type' : declaredKind === 'inline-type' ? (verbatim ? 'runtime' : 'type') : declaredKind;
      if (!local) {
        if (!specifier.startsWith('node:')) externals.add(specifier);
        continue;
      }
      if (to || !asset) references.push({from:file,specifier,to,kind,line});
      if (to) {
        graph.get(file).add(to);
        if (kind !== 'dynamic') staticDependencies.get(file).add(to);
        if (kind === 'runtime') eager.get(file).add(to);
      } else if (!asset) {
        findings.push(newFinding('unresolved-local-import','medium','medium',file,line,
          `Unresolved import: ${specifier}`,'No indexed source target identified.','Inspect aliases, generated sources and framework resolution before editing.'));
      }
    }
    for(const statement of sf.statements){
      if(!ts.isImportDeclaration(statement)||!statement.importClause||statement.importClause.name||statement.attributes||statement.assertClause)continue;
      const clause=statement.importClause,b=clause.namedBindings;
      if(!b||!ts.isNamedImports(b)||!ts.isStringLiteral(statement.moduleSpecifier))continue;
      const uses=new Map([...b.elements].map(e=>[e.name.text,0]));
      function check(n){if(n===statement)return;if(ts.isIdentifier(n)&&uses.has(n.text))uses.set(n.text,uses.get(n.text)+1);ts.forEachChild(n,check);}check(sf);
      const dropped=b.elements.filter(e=>!uses.get(e.name.text)),kept=b.elements.filter(e=>uses.get(e.name.text));
      if(!dropped.length)continue;
      const start=statement.getStart(sf),end=statement.getEnd();
      const replacement=kept.length?`import ${clause.isTypeOnly?'type ':''}{ ${kept.map(x=>x.getText(sf)).join(', ')} } from ${statement.moduleSpecifier.getText(sf)};`:(clause.isTypeOnly?'':`import ${statement.moduleSpecifier.getText(sf)};`);
      const fixId=`fix-${fixes.length+1}`;
      fixes.push({id:fixId,rule:'unused-named-import',file,start,end,before:text.slice(start,end),after:replacement,fileHash:hash(raw),description:`Remove unused imports: ${dropped.map(x=>x.name.text).join(', ')}`});
      findings.push(newFinding('unused-named-import','medium','medium',file,lineno(sf,statement),'Unused named import',`No identifier use found for ${dropped.map(x=>x.name.text).join(', ')}.`,'Review the patch and confirm transforms/side effects.',{bindings:dropped.map(x=>x.name.text)}));
      findings[findings.length-1].fixId=fixId;
    }
    options.onProgress?.({completed:i+1,total:sources.length,file,readBytes:processedBytes});
  }
  const ids=new Set(callNodes.map(n=>n.id));
  for(const [file,meta] of moduleInfo)for(const [symbol,info] of meta.functions){const node={id:`${file}::${symbol}`,file,symbol,line:info.line,kind:'function'};callNodes.push(node);ids.add(node.id);}
  for(const c of pendingCalls){let target=null,resolution=null;
    if(c.imported){const mod=resolver.resolve(c.file,c.imported.spec).target;if(mod&&moduleInfo.get(mod)?.functions.has(c.imported.original)){target=`${mod}::${c.imported.original}`;resolution='static-import';}}
    else if(c.namespace){const mod=resolver.resolve(c.file,c.namespace).target;if(mod&&moduleInfo.get(mod)?.functions.has(c.member)){target=`${mod}::${c.member}`;resolution='static-namespace-import';}}
    else if(moduleInfo.get(c.file)?.functions.has(c.local)){target=`${c.file}::${c.local}`;resolution='same-module';}
    if(target){const from=ids.has(`${c.file}::${c.caller}`)?`${c.file}::${c.caller}`:`${c.file}::<module>`;callEdges.push({from,to:target,file:c.file,line:c.line,resolution,confidence:'medium'});}
    else unresolved.push({file:c.file,line:c.line,reason:'Static function target not found.',expression:c.local||c.member});
  }
  for(const arr of fnGroups.values())if(arr.length>1)findings.push(newFinding('duplicate-function-body','medium','high',arr[0].file,arr[0].line,`Repeated function body in ${arr.length} locations`,arr.map(x=>`${x.file}:${x.line} (${x.symbol})`).join(' | '),'Verify semantics, then consider one shared pure implementation.',arr));
  const inbound=new Map(sources.map(f=>[f,0]));for(const dests of graph.values())for(const dest of dests)inbound.set(dest,(inbound.get(dest)||0)+1);
  for(const file of sources){const fanIn=inbound.get(file)||0,fanOut=graph.get(file).size;
    if(fanIn>=10)findings.push(newFinding('high-coupling-hub','medium','medium',file,1,`High-dependency module (${fanIn} dependents)`,'Changes affect many consumers; check whether this is an appropriate shared kernel.','Preserve a stable API facade and test callers.'));
    if(fanOut>=12)findings.push(newFinding('excessive-fan-out','medium','medium',file,1,`Broad-coupling module (${fanOut} dependencies)`,'A module imports many systems and may mix responsibilities.','Review layer boundaries before refactoring; composition roots may be valid.'));
  }
  const runtimeCycles = components(eager);
  const runtimeCycleMembers = new Set(runtimeCycles.map(cycle=>JSON.stringify(cycle)));
  const typeInvolvedCycles = components(staticDependencies).filter(cycle=>!runtimeCycleMembers.has(JSON.stringify(cycle)));
  for (const cycle of runtimeCycles) {
    findings.push(newFinding('circular-dependency','high','high',cycle[0],1,
      `${cycle.length}-module runtime dependency cycle`,cycle.join(', '),'Inspect initialization order and extract shared definitions or invert the dependency.',cycle));
  }
  for (const cycle of typeInvolvedCycles) {
    findings.push(newFinding('type-dependency-cycle','low','high',cycle[0],1,
      `${cycle.length}-module cycle involving type dependencies`,cycle.join(', '),'Review contract ownership if these type dependencies make changes harder.',cycle));
  }
  const entries=new Set(sources.filter(isEntry));
  if(allNames.has('package.json')){
    try {const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));const refs=[];for(const key of ['main','module','browser','types'])if(typeof pkg[key]==='string')refs.push(pkg[key]);
      function x(v){if(typeof v==='string')refs.push(v);else if(v&&typeof v==='object')Object.values(v).forEach(x);}x(pkg.exports);
      for(const ref of refs){const candidate=resolver.resolve('root.ts',ref.startsWith('.')?ref:`./${ref}`).target;if(candidate)entries.add(candidate);}
    }catch {findings.push(newFinding('invalid-package-json','high','high','package.json',1,'Invalid package.json','Could not parse package manifest.','Correct manifest and rescan.'));}
  }
  if(entries.size){const reached=new Set(),todo=[...entries];for(let i=0;i<todo.length;i++){const f=todo[i];if(reached.has(f))continue;reached.add(f);for(const t of graph.get(f)||[])if(!reached.has(t))todo.push(t);}
    for(const f of sources)if(!reached.has(f))findings.push(newFinding('unreachable-from-known-entrypoints','low','low',f,1,'Module not reachable from detected entries','May be dynamically registered, a plugin or framework entry.','Confirm actual runtime loading before removal.'));
  }
  findings.sort((a,b)=>({high:0,medium:1,low:2}[a.severity]-{high:0,medium:1,low:2}[b.severity])||a.location.file.localeCompare(b.location.file));
  findings.forEach((f,i)=>f.id=`finding-${i+1}`);
  const report={schemaVersion:'1.2',generatedAt:new Date().toISOString(),project:name,summary:{sourceFiles:sources.length,totalFiles,importEdges:references.filter(e=>e.to).length,entrypoints:entries.size,parseErrors,findings:findings.length,safeFixCandidates:fixes.length,bySeverity:Object.fromEntries(['high','medium','low'].map(s=>[s,findings.filter(f=>f.severity===s).length])),directFunctionCalls:callEdges.length,functionSymbols:callNodes.filter(n=>n.kind==='function').length,sourceBytesRead:processedBytes,scanDurationMs:Math.round(performance.now()-started)},
    limitations:['One-source-file-at-a-time AST scanning: no fixed file count or source byte cap; bounded by disk, memory, execution time and OS constraints.','TypeScript/JavaScript static analysis only. Dynamic calls, framework conventions and reflection are incomplete.','No project code was executed. Runtime speed and correctness cannot be inferred from these signals.','Function symbol names may be shadowed; call graph contains hypotheses, not proof of dead code.','Unused import changes require review and regression checks.'],
    graph:{nodes:sources,edges:references,entrypoints:[...entries],resolution:{configs:Object.fromEntries(resolver.configs),scope:'indexed files and nearest tsconfig.json or jsconfig.json'},cycles:{runtime:runtimeCycles,typeInvolved:typeInvolvedCycles},calls:{kind:'partial-static-call-graph',nodes:callNodes,edges:callEdges,unresolved,limitations:['Direct calls only; unresolved dynamic and member calls are expected.']}},findings,fixes,externalDependencies:[...externals].sort(),agentTask:buildAgentTask(name,findings)};
  report.architecture=analyzeArchitecture(report);
  report.refactorBlueprint=buildRefactorBlueprint(report);
  report.repairPlan=makeRepairPlan(report);
  return report;
}
