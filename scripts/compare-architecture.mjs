#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import {compareArchitecture} from '../src/insight.mjs';
try {
  const [, , beforePath, afterPath, output='architecture-comparison.json'] = process.argv;
  if (!beforePath || !afterPath) throw new Error('Usage: node scripts/compare-architecture.mjs BEFORE.json AFTER.json [OUTPUT.json]');
  const [before,after] = await Promise.all([readFile(beforePath,'utf8').then(JSON.parse),readFile(afterPath,'utf8').then(JSON.parse)]);
  const result=compareArchitecture(before,after);
  await writeFile(output, JSON.stringify(result,null,2));
  console.log(`Compared ${result.metrics.length} architecture metrics. Wrote ${output}. Runtime performance not measured.`);
} catch(e) { console.error(e.message); process.exitCode=1; }
