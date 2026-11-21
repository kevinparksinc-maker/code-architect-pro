#!/usr/bin/env node
// OPTIONAL: model-powered repair in a disposable workspace.
// Not exposed to untrusted uploads. Requires an explicitly configured OpenCode model.
// Run only for projects you trust and from a hardened/sandboxed machine.
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, cp, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

async function run() {
  const [folder, reportPath, approval] = process.argv.slice(2);
  if (!folder || !reportPath || approval !== '--allow-agent') throw new Error('Usage: node scripts/opencode-repair.mjs <trusted-project-folder> <report.json> --allow-agent');
  const { OpenCode } = await import('@opencode/sdk').catch(() => { throw new Error('Install the optional OpenCode integration first: npm install @opencode/sdk'); });
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (!['1.0','1.1'].includes(report.schemaVersion) || !Array.isArray(report.findings)) throw new Error('Expected a Code Architect 1.0 report');
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'code-architect-ai-'));
  await cp(path.resolve(folder), workspace, { recursive: true, filter: source => !/(^|\/)(node_modules|\.git|dist|build|coverage)(\/|$)/.test(source) });
  await writeFile(path.join(workspace, 'architecture-report.json'), JSON.stringify(report, null, 2));
  if(report.refactorBlueprint)await writeFile(path.join(workspace, 'refactor-blueprint.json'), JSON.stringify(report.refactorBlueprint, null, 2));
  console.log(`Working only in the temporary copy: ${workspace}`);
  const host = await OpenCode.create();
  try {
    const session = await host.sessions.create({ location: { directory: workspace } });
    await host.sessions.prompt({ sessionID: session.id, text: `${report.agentTask}\nAlso study refactor-blueprint.json if present. Implement small staged refactoring patches and preserve known contracts; inspect each proposed affected file.\nThis folder is a disposable copy of a trusted project. Use the source files and report for confirmed fixes. Leave a summary of diffs and test results in REPAIR_SUMMARY.md. Keep changes minimal. Do not access external secrets or push to a remote. Ask approval before destructive steps. Do not modify the original folder.\n` });
    console.log(`Agent session completed or handed off; inspect the temporary folder: ${workspace}`);
  } finally { await host.close(); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
