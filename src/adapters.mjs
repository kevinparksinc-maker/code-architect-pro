/** Imports JSON emitted by trusted independent analyzers. NEVER executes their binaries. */
import { buildAgentTask } from './engine.mjs';
import { makeRepairPlan } from './knowledge.mjs';
const cleanPath = value => {
  if (typeof value !== 'string' || value.length > 240) return null;
  const path = value.replaceAll('\\', '/').replace(/^\.\//, '');
  return !path.startsWith('/') && !path.includes('..') && !path.includes('\0') ? path : null;
};
const cleanText = value => String(value ?? '').slice(0, 500);
const safeLine = line => Number.isInteger(line) && line > 0 ? line : 1;
function add(items, allowed, tool, rule, file, line, title, detail, severity = 'low') {
  const path = cleanPath(file);
  if (!path || !allowed.has(path)) return;
  if (items.length >= 500) return;
  items.push({ id: '', rule, severity, confidence: 'external-unverified', location: { file: path, line: safeLine(line) }, title: cleanText(title), detail: cleanText(detail), recommendation: 'Confirm this finding against the actual source and project runtime before changing code.', externalTool: tool });
}
export function normalizeAnalyzerReport(tool, data, allowedFiles) {
  if (!['knip','jscpd','dependency-cruiser'].includes(tool)) throw new Error('Supported tools: knip, jscpd, dependency-cruiser');
  if (!(allowedFiles instanceof Set)) throw new Error('Expected allowed file paths');
  const items = [];
  if (tool === 'knip') {
    if (!data || !Array.isArray(data.issues)) throw new Error('Knip data must have an issues array');
    for (const group of data.issues.slice(0, 1000)) {
      if (!group || typeof group.file !== 'string') continue;
      for (const [kind, values] of Object.entries(group)) {
        if (kind === 'file' || !Array.isArray(values)) continue;
        for (const item of values.slice(0, 100)) {
          if (item && typeof item === 'object') add(items, allowedFiles, tool, `knip-${kind}`, group.file, item.line, `Knip: ${kind}`, `Reported candidate: ${cleanText(item.name)}. Knip analysis depends on accurate framework entrypoint configuration.`);
        }
      }
    }
  } else if (tool === 'jscpd') {
    if (!data || !Array.isArray(data.duplicates)) throw new Error('jscpd data must have a duplicates array');
    for (const clone of data.duplicates.slice(0, 500)) {
      if (!clone?.firstFile || !clone?.secondFile) continue;
      const first = clone.firstFile, second = clone.secondFile;
      if (!allowedFiles.has(cleanPath(first.name)) || !allowedFiles.has(cleanPath(second.name))) continue;
      add(items, allowedFiles, tool, 'jscpd-duplication', first.name, first.startLoc?.line || first.start, 'Duplicate or similar code region', `${cleanText(clone.kind || 'exact')} clone: ${cleanText(first.name)}:${safeLine(first.start)} and ${cleanText(second.name)}:${safeLine(second.start)}. Lines: ${cleanText(clone.lines)}. Compare semantics before extracting shared logic.`, 'medium');
    }
  } else {
    if (!data || !Array.isArray(data.modules)) throw new Error('dependency-cruiser data must have a modules array');
    for (const mod of data.modules.slice(0, 1500)) {
      if (!mod || !Array.isArray(mod.dependencies)) continue;
      for (const dep of mod.dependencies.slice(0, 300)) {
        for (const violation of (dep?.rules || []).slice(0, 25)) {
          add(items, allowedFiles, tool, `depcruise-${violation.name || 'rule'}`, mod.source, 1, `Dependency rule: ${cleanText(violation.name)}`, `Source ${cleanText(mod.source)} depends on ${cleanText(dep.resolved || dep.module)}; rule severity: ${cleanText(violation.severity)}.`, violation.severity === 'error' ? 'high' : 'medium');
        }
      }
    }
    // Summary shape also exists in standard JSON output.
    for (const violation of (data.summary?.violations || []).slice(0, 150)) {
      add(items, allowedFiles, tool, `depcruise-${violation.rule?.name || 'rule'}`, violation.from, 1, `Dependency rule: ${cleanText(violation.rule?.name)}`, `Dependency ${cleanText(violation.from)} -> ${cleanText(violation.to)}.`, violation.rule?.severity === 'error' ? 'high' : 'medium');
    }
  }
  // Duplicate a single report's identical finding once, bounded for user-supplied input.
  const seen = new Set();
  return items.filter(item => { const key = [item.rule,item.location.file,item.location.line,item.detail].join('|'); if (seen.has(key)) return false; seen.add(key); return true; });
}
export function mergeExternalReport(report, external, tool, allowedFiles) {
  const imported = normalizeAnalyzerReport(tool, external, allowedFiles);
  const findings = [...report.findings, ...imported].slice(0, 1250);
  findings.forEach((f, i) => { f.id = `finding-${i+1}`; });
  const merged = { ...report, findings, externalReports: [...(report.externalReports || []), { tool, accepted: imported.length, noCodeExecution: true }],
    summary: { ...report.summary, findings: findings.length, bySeverity: Object.fromEntries(['high','medium','low'].map(s => [s, findings.filter(f => f.severity === s).length])) } };
  merged.repairPlan = makeRepairPlan(merged);
  merged.agentTask = buildAgentTask(merged.project, merged.findings);
  return merged;
}
