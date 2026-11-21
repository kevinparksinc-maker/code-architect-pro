const $ = id => document.getElementById(id);
let latest = null;
const label = value => document.createTextNode(String(value));
function el(tag, classes, value) {
  const n = document.createElement(tag);
  if (classes) n.className = classes;
  if (value !== undefined) n.textContent = String(value);
  return n;
}
function setStatus(message, error = false) { $('status').textContent = message; $('status').className = `status${error ? ' error' : ''}`; }
async function request(url, method = 'POST', body, contentType = 'application/json') {
  setStatus('Scanning code and building the dependency map…');
  for (const id of ['uploadButton', 'demoButton']) $(id).disabled = true;
  try {
    const response = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': contentType }, body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    let completed=result;
    if(result.jobId){
      let attempts=0;
      do {
        await new Promise(ok=>setTimeout(ok,850));
        const r=await fetch(result.poll);
        if(!r.ok)throw new Error(`Unable to check scan status: HTTP ${r.status}`);
        completed=await r.json();
        setStatus(`${completed.stage||'Working'}: ${completed.progress?.stage==='scan'?`${completed.progress.completed} / ${completed.progress.total} source files`:`${completed.progress?.entries||0} ZIP entries`} processed...`);
        if(completed.status==='error')throw new Error(completed.error||'Scan failed');
        if(++attempts>4000)throw new Error('Scan check timed out; retrieve the scan by its job ID.');
      } while(completed.status!=='complete');
    }
    latest = completed;
    render(completed.report);
    setStatus(`Scan complete. ${completed.report.summary.findings} findings and ${completed.report.summary.safeFixCandidates} reviewable repair candidates.${completed.report.partialPreview?' Showing a preview; download the full JSON report for everything.':''}`);
  } catch (error) { setStatus(error.message || String(error), true); }
  finally { for (const id of ['uploadButton', 'demoButton']) $(id).disabled = false; }
}
function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function render(report) {
  $('results').classList.remove('hidden');
  $('projectTitle').textContent = report.project;
  $('filesMetric').textContent = report.summary.sourceFiles;
  $('edgesMetric').textContent = report.summary.importEdges;
  $('findingsMetric').textContent = report.summary.findings;
  $('fixMetric').textContent = report.summary.safeFixCandidates;
  $('severity').value = 'all';
  showArchitecture(report);
  showPlan(report);
  showFindings(report);
  const fixList = $('fixList'); fixList.replaceChildren();
  if (!report.fixes.length) fixList.append(el('p', '', 'No conservative auto-repair candidates. See architectural recommendations above.'));
  for (const fix of report.fixes) {
    const row = el('div', 'fix-row'), lab = el('label'), input = el('input');
    input.type = 'checkbox'; input.value = fix.id; input.dataset.fix = 'true';
    lab.append(input, label(`${fix.file} · ${fix.description}`)); row.append(lab);
    const details = el('details'), summary = el('summary', '', 'Preview change'), before = el('pre', '', `BEFORE\n${fix.before}\n\nAFTER\n${fix.after}`);
    details.append(summary, before); row.append(details); fixList.append(row);
  }
  const list = $('graphList'); list.replaceChildren();
  for (const edge of report.graph.edges.slice(0, 80)) {
    const item = el('div', `edge${!edge.to ? ' missing' : ''}`);
    item.append(label(`${edge.from} → `), el('b', '', edge.to || `(unresolved) ${edge.specifier}`));
    if (edge.kind) item.append(label(` · ${edge.kind === 'type' ? 'type-only' : edge.kind}`));
    list.append(item);
  }
  if (!report.graph.edges.length) list.append(el('p', '', 'No static import links were found.'));
  const calls = report.graph.calls || {nodes:[],edges:[],unresolved:[]};
  $('callGraphSummary').textContent = `${calls.nodes.filter(n => n.kind === 'function').length} discovered functions · ${calls.edges.length} resolved direct call references · ${calls.unresolved.length} unresolved examples. These are partial static results.`;
  const callList = $('callGraphList'); callList.replaceChildren();
  for (const edge of calls.edges.slice(0, 70)) callList.append(el('div', 'edge', `${edge.from} → ${edge.to} (${edge.file}:${edge.line})`));
  if (!calls.edges.length) callList.append(el('p', '', 'No direct calls resolved by the limited function analyzer.'));
  const limits = $('limitsList'); limits.replaceChildren(); for (const note of report.limitations) limits.append(el('li', '', note));
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function showArchitecture(report) {
  const a=report.architecture||{},m=a.measurements||{};
  $('architectureSummary').textContent=`${m.modules||0} modules · ${m.cycles||0} ${report.graph?.cycles?'runtime cycles · '+(m.typeInvolvedCycles||0)+' cycles involving types':'dependency cycles'} · ${m.duplicateGroups||0} duplicate function groups · ${m.highChangeImpact||0} high-impact modules. Static structure is not a runtime speed measurement.`;
  const hotspots=$('hotspotList');hotspots.replaceChildren();
  for(const x of (a.hotspots||[]).slice(0,20)){
    const detail=el('details','plan-item');detail.append(el('summary','',`${x.file} · ${x.dependents} callers / ${x.dependencies} imports`));
    detail.append(el('p','',x.caution||'Investigate module responsibility, do not split automatically.'));hotspots.append(detail);
  }
  if(!hotspots.children.length)hotspots.append(el('p','','No high-coupling hotspots crossed the heuristic thresholds.'));
  const waves=$('waveList');waves.replaceChildren();
  for(const phase of a.migrationWaves||[]){const detail=el('details','plan-item');detail.append(el('summary','',phase.title));
    const list=el('ol');for(const d of phase.deliverables)list.append(el('li','',d));detail.append(list);
    detail.append(el('h4','','Evidence required'));for(const check of phase.verification)detail.append(el('p','',check));waves.append(detail);
  }
  const changes=$('changeList');changes.replaceChildren();
  for(const item of (report.refactorBlueprint?.changeSets||[]).slice(0,30)){
    const detail=el('details','plan-item');detail.append(el('summary','',`${item.rule} · ${item.sourceEvidence.file}:${item.sourceEvidence.line} · ${item.approach}`));
    detail.append(el('p','',`Affected files: ${item.affectedFiles.join(', ')}`));
    const list=el('ol');for(const step of item.transform)list.append(el('li','',step));detail.append(list);
    detail.append(el('h4','','Verification'));for(const v of item.validation)detail.append(el('p','',v));changes.append(detail);
  }
  if(!changes.children.length)changes.append(el('p','','No candidate restructuring change sets identified.'));
}
function showPlan(report) {
  const list = $('planList'); list.replaceChildren();
  for (const step of (report.repairPlan?.steps || []).slice(0, 35)) {
    const details = el('details', 'plan-item');
    details.append(el('summary', '', `${step.severity.toUpperCase()} · ${step.file}:${step.line} · ${step.title}`));
    details.append(el('p', '', `Question: ${step.decisionQuestion}`));
    for (const option of step.options) {
      details.append(el('h4', '', option.name));
      details.append(el('p', '', `Use when: ${option.useWhen}`));
      details.append(el('p', '', `Avoid when: ${option.avoidWhen}`));
      const ol = el('ol'); for (const item of option.steps) ol.append(el('li','',item)); details.append(ol);
    }
    details.append(el('h4', '', 'Verification gates'));
    const ul = el('ul'); for (const item of step.verification) ul.append(el('li','',item)); details.append(ul);
    list.append(details);
  }
  if (!report.repairPlan?.steps?.length) list.append(el('p', '', 'No findings requiring a repair plan.'));
}
function showFindings(report) {
  const filter = $('severity').value, list = $('findingsList'); list.replaceChildren();
  const findings = report.findings.filter(f => filter === 'all' || f.severity === filter);
  if (!findings.length) { list.append(el('p', '', 'No findings match the selected filter.')); return; }
  for (const f of findings) {
    const card = el('article', 'finding'), heading = el('div', 'finding-head');
    heading.append(el('span', `pill ${f.severity}`, f.severity.toUpperCase()), el('span', 'location', `${f.location.file}:${f.location.line}`), el('span', 'confidence', `Confidence: ${f.confidence}`));
    card.append(heading, el('h3', '', f.title), el('p', '', f.detail), el('p', 'recommendation', `REPAIR → ${f.recommendation}`));
    list.append(card);
  }
}
$('zipInput').addEventListener('change', e => { $('fileName').textContent = e.target.files?.[0]?.name || 'Select a .zip file'; });
$('uploadButton').addEventListener('click', async () => {
  const file = $('zipInput').files?.[0];
  if (!file) return setStatus('Select a project ZIP first.', true);
  await request('/api/scan/zip', 'POST', file, 'application/zip');
});
$('demoButton').addEventListener('click', () => request('/api/demo'));
$('githubForm').addEventListener('submit', e => { e.preventDefault(); request('/api/scan/github', 'POST', JSON.stringify({ repository: $('repo').value })); });
$('severity').addEventListener('change', () => { if (latest) showFindings(latest.report); });
$('downloadJson').addEventListener('click', () => {
  if(!latest)return;
  if(latest.fullReportUrl){const a=el('a');a.href=latest.fullReportUrl;a.download='code-architect-full-report.json';a.click();}
  else download(JSON.stringify(latest.report,null,2),'architecture-report.json','application/json');
});
$('downloadTask').addEventListener('click', () => { if (latest) download(latest.report.agentTask, 'ai-repair-task.md', 'text/markdown'); });
$('exportFixes').addEventListener('click', async () => {
  if (!latest) return;
  const ids = [...document.querySelectorAll('input[data-fix]:checked')].map(i => i.value);
  if (!ids.length) return setStatus('Select a repair candidate before exporting.', true);
  $('exportFixes').disabled = true;
  try {
    const manifest=!!latest.fullReportUrl;
    const response=await fetch(manifest?'/api/export/patch-manifest':'/api/export/repaired-zip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scanId:latest.scanId,fixIds:ids})});
    if(!response.ok)throw new Error((await response.json()).error||'Repair export failed');
    const url=URL.createObjectURL(await response.blob()),a=el('a');a.href=url;a.download=manifest?'code-architect-reviewed-patches.json':'code-architect-reviewed-repairs.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
    setStatus(manifest?'Patch manifest exported. Apply changes to a local copy using the provided script; build and test before deploying.':'Patched ZIP generated. Review source changes and run project tests before deploying.');
  } catch (error) { setStatus(error.message, true); }
  finally { $('exportFixes').disabled = false; }
});

$('downloadPlan').addEventListener('click', () => { if (latest) download(JSON.stringify(latest.report.repairPlan, null, 2), 'architectural-repair-plan.json', 'application/json'); });
$('downloadBlueprint').addEventListener('click',()=>{if(latest)download(JSON.stringify(latest.report.architecture,null,2),'architecture-improvement-blueprint.json','application/json');});
$('downloadChangeSets').addEventListener('click',()=>{if(latest)download(JSON.stringify(latest.report.refactorBlueprint,null,2),'target-architecture-change-sets.json','application/json');});
$('importReport').addEventListener('click', async () => {
  if (!latest) return setStatus('Scan a project before importing external findings.', true);
  const file = $('externalFile').files?.[0]; if (!file) return setStatus('Choose a JSON report first.', true);
  if (file.size > 32 * 1024 * 1024) return setStatus('External JSON report exceeds the current server budget (32 MiB by default). Configure ARCHITECT_MAX_ANALYZER_REPORT_BYTES to increase it.', true);
  $('importReport').disabled = true;
  try {
    const response = await fetch('/api/analyzers/import', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({scanId:latest.scanId, tool:$('externalTool').value, report:JSON.parse(await file.text())}) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    latest = data; render(data.report);
    setStatus(`Imported external report. ${data.report.summary.findings} total findings now available.`);
  } catch (e) { setStatus(e.message, true); }
  finally { $('importReport').disabled = false; }
});
