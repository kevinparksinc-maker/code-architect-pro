/** Evidence-based architectural assessment. Structural signals are not proof of runtime speed. */
const SEVERITY = {high: 3, medium: 2, low: 1};
const unique = a => [...new Set(a)];
export function analyzeArchitecture(report) {
  const edges = (report.graph?.edges || []).filter(e => e.to && e.to !== e.from);
  const incoming = new Map(), outgoing = new Map(), nodes = new Set(report.graph?.nodes || []);
  for (const n of nodes) { incoming.set(n, new Set()); outgoing.set(n, new Set()); }
  for (const {from, to} of edges) {
    nodes.add(from); nodes.add(to);
    if (!incoming.has(to)) incoming.set(to, new Set());
    if (!outgoing.has(from)) outgoing.set(from, new Set());
    incoming.get(to).add(from); outgoing.get(from).add(to);
  }
  const modules = [...nodes].map(file => {
    const dependents = incoming.get(file)?.size || 0;
    const dependencies = outgoing.get(file)?.size || 0;
    const risk = dependents * 2 + dependencies;
    return {file, dependents, dependencies, changeImpact: risk,
      caution: dependents >= 8 ? 'Many callers: use incremental migration and interface tests.' : dependencies >= 12 ? 'Broad coupling: investigate cohesive boundaries.' : null};
  }).sort((a,b) => b.changeImpact - a.changeImpact || a.file.localeCompare(b.file));
  const cycleCount = report.findings.filter(f => f.rule === 'circular-dependency').length;
  const duplicates = report.findings.filter(f => f.rule === 'duplicate-function-body').length;
  const unresolved = report.findings.filter(f => f.rule === 'unresolved-local-import').length;
  const maxFanIn = Math.max(0, ...modules.map(m => m.dependents));
  const maxFanOut = Math.max(0, ...modules.map(m => m.dependencies));
  const highChangeImpact = modules.filter(m => m.dependents >= 8).length;
  const findingsByRule = Object.fromEntries([...new Set(report.findings.map(f=>f.rule))].sort().map(rule => [rule, report.findings.filter(f=>f.rule===rule).length]));
  const ranked = report.findings.map(f => {
    const related = modules.find(m => m.file === f.location?.file);
    const severity = SEVERITY[f.severity] || 1;
    const confidence = {high: 3, medium: 2, low: 1}[f.confidence] || 1;
    const impact = Math.min(5, 1 + Math.floor((related?.dependents||0) / 3));
    const effort = ['unused-named-import', 'invalid-package-json'].includes(f.rule) ? 1 : ['circular-dependency','duplicate-function-body'].includes(f.rule) ? 4 : 2;
    return {findingId:f.id, rule:f.rule, location:f.location, title:f.title, priority:severity * 3 + confidence + impact - effort,
      impact, effort, confidence:f.confidence, evidence:[f.location], needsReview:true};
  }).sort((a,b)=>b.priority-a.priority||a.findingId.localeCompare(b.findingId));
  const zones = [
    {id:'stabilize', title:'1 · Establish baseline and protect behavior', deliverables:['Identify public APIs and app entry points.','Record current build, test and runtime results in a trusted sandbox.','Create a rollback branch and representative golden-output fixtures.'], verification:['Baseline tests and build pass or existing failures are explicitly recorded.']},
    {id:'boundaries', title:'2 · Correct architectural boundaries', deliverables:['Investigate cycles and high-dependency modules.','Separate calculation/domain logic, I/O, presentation and orchestration where justified.','Move one coherent responsibility at a time; preserve public facades.'], verification:['Rescan reports show targeted coupling/cycle reductions.','Contract and integration tests pass.']},
    {id:'duplication', title:'3 · Remove verified redundancy', deliverables:['Confirm duplicate routines are semantically equivalent.','Extract shared implementations only for truly identical contracts.','Keep deliberate domain separation when semantics differ.'], verification:['Golden outputs match for edge inputs.','Duplicate count decreases without increased coupling.']},
    {id:'performance', title:'4 · Optimize proven bottlenecks', deliverables:['Instrument actual startup, build, memory, CPU, API calls and representative workflows.','Address measured slow paths; prefer caching/batching only with equivalent behavior.'], verification:['Compare repeated baseline and changed runs under identical conditions.','Reject performance regressions and any failing correctness tests.']}
  ];
  return {
    schemaVersion:'1.0', evidenceType:'static-architecture',
    measurements:{modules:nodes.size, importEdges:edges.length, cycles:cycleCount, duplicateGroups:duplicates, unresolvedImports:unresolved, maxFanIn, maxFanOut, highChangeImpact, findingsByRule},
    hotspots:modules.filter(m=>m.dependents>=5||m.dependencies>=8).slice(0,200),
    moduleMetrics:modules,
    prioritizedFindings:ranked,
    migrationWaves:zones,
    acceptanceCriteria:{
      correctness:['No new type errors, test failures or broken API contracts.','Compare baseline and changed application outputs for representative inputs.'],
      architecture:['No new dependency cycles.','Targeted coupling and duplication metrics improve or justified exceptions are recorded.'],
      performance:['App-level speed/memory claims require actual instrumented before/after workloads, not static guesses.'],
      security:['Never execute untrusted uploaded code on the web scanner.','All semantic patches require explicit approval and an isolated test workspace.']
    },
    warning:'Architecture signals are hypotheses; lower coupling is not automatically faster or more correct.'
  };
}

export function compareArchitecture(before, after) {
  if (!before?.architecture?.measurements || !after?.architecture?.measurements) throw new Error('Both inputs must be Code Architect v0.3 reports with architectural measurements');
  const fields = ['modules','importEdges','cycles','duplicateGroups','unresolvedImports','maxFanIn','maxFanOut','highChangeImpact'];
  const metrics = fields.map(name => ({name, before:before.architecture.measurements[name], after:after.architecture.measurements[name], delta:after.architecture.measurements[name]-before.architecture.measurements[name]}));
  return {
    schemaVersion:'1.0', projectBefore:before.project, projectAfter:after.project, metrics,
    changes:{improved:metrics.filter(m=>m.delta<0).map(m=>m.name), worsened:metrics.filter(m=>m.delta>0).map(m=>m.name)},
    limitations:['A reduction in structural counts is not proof that behavior, runtime performance or reliability improved.','Module count, fan-in and import-edge counts are contextual and may legitimately increase during good refactoring.','Run type checks, regression tests and repeatable application benchmarks in an isolated trusted environment.']
  };
}
