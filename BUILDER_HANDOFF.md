# CODE ARCHITECT PRO v0.3 — BUILDER HANDOFF / MANDATORY ENGINEERING CONTRACT

You are receiving a **working, tested source-code project**. Extend this code; **do not regenerate a mockup** or substitute screenshots for functioning analysis.

## Primary outcome

Build a reliable software-architecture improvement engine: **ingest complete repositories → map actual code relationships → diagnose genuine defects → select an appropriate target architecture → generate small, reversible code changes → test against the original behavior and benchmark real performance → present the diff and evidence → export approved repairs.**

Default mode is **Repair / Structural Improvement**. New features and product scope changes are prohibited unless the user explicitly enables **Enhancement mode** and approves requirements.

## What is already coded and tested

- Node.js 20+, TypeScript compiler parser, browser UI, ZIP/public GitHub scan inputs.
- `src/scalable.mjs`: disk-backed incremental JS/TS source scanner, **no arbitrary file-count/per-file-source-size cap**.
- `src/archive-stream.mjs`: streamed ZIP32/ZIP64 extraction with CRC, path security, symlink and zip-bomb protections.
- `src/github-stream.mjs`: disk-streaming archive download for validated public GitHub repositories.
- `src/server.mjs`: async scan jobs, progress polling, preview/full report, configurable storage budgets, safe patch export API.
- `src/insight.mjs`: structural architecture measurements, ranked hotspot and migration waves, before/after scorecard comparator.
- `src/refactor-blueprint.mjs`: exact file-specific change sets for duplication, circular dependency, hub, fan-out, and async defects.
- `src/knowledge.mjs`: strategies, use/avoid criteria, invariants and verification for architecture rules.
- `src/engine.mjs`: original in-memory scanner / conservative AST-informed unused-import repair candidates (kept for legacy/demo compatibility).
- `scripts/apply-reviewed-fixes.mjs`: local hash-matched import changes in a separate directory.
- `scripts/compare-architecture.mjs`: before/after structural report comparison.
- `scripts/verify-trusted.mjs`: opt-in test/build comparison for **trusted** original and candidate apps only.
- `scripts/benchmark-trusted.mjs`: opt-in repeated application benchmark script timing for **trusted** code.
- `scripts/opencode-repair.mjs`: optional manual OpenCode SDK adapter; **no model configured, not web-connected**.
- Tests: `npm test`, **23 passing automated tests**.

## THE SCALING REQUIREMENT

**Never introduce arbitrary caps of 1,200 source files, 1 MiB per source file, or 32 MiB compressed ZIP.** Local CLI scanning should operate until the machine's real resource constraints. Browser/hosted scans must use explicit configurable safe budgets, streaming disk I/O, queueing, cancellation, progress, and a transparent error if disk/memory/time is exhausted. Current server defaults: 1 GiB uploaded / 3 GiB uncompressed; env variables control both.

For massive repositories, replace in-memory symbol/graph/finding arrays with persistent file indexes and incremental caching; do not pretend there are no resource limits. Add resumable multipart uploads and paginated findings before production-scale hosting.

## Mandatory deep-architecture features to implement next

### A. True semantic project model

- Integrate TypeScript LanguageService/compiler Program for real symbol identities, definitions/references, aliases, re-exports, tsconfig project references, path aliases, dynamic imports, type/interface relations.
- Map imports, function calls, event handlers, work queues, API routes, database access, caches, global state, configuration and generated code.
- Add framework entrypoint conventions: React/Vite/Next/Angular/Node/Express and then adapter packs for other languages (Tree-sitter/LSP).
- Persist graph into SQLite or another indexed store, with changed-file caching and pagination.

### B. Diagnose architecture, not only syntax

- Detect genuinely duplicate computation, conflicting data ownership, unreachable/unused paths **with confidence**, circular dependencies, layer violations, oversized domain services, scattered configuration, inconsistent error paths, N+1 request/database patterns, unsafe async operations, and memory/resource leaks where evidence supports it.
- Distinguish dynamic/plugin/runtime code from safe-to-delete dead code.
- Show exact source file, span, symbol, related callers, evidence, and downstream impact radius. Rank by **business severity, likelihood, repair risk, and verification cost**.

### C. Generate better target structures

- Produce at least two justified architecture alternatives for high-impact findings: modular extraction versus dependency inversion, stable facade versus service split, sequential versus bounded concurrency, shared kernel versus deliberate duplication.
- Explain why each architecture fits or does not fit the project, using *actual files and current dependency graph*, rather than generic advice.
- Build staged change sets specifying new modules, changed APIs, compatibility shims, dependency migration, rollback points, and exact files to modify.
- Never auto-convert a modular monolith to microservices without measured or operational need.

### D. Real code refactoring

- Use AST-powered codemods for deterministic transformations; configurable AI coding model for semantic changes.
- `@opencode/sdk` can create in-process sessions. Prefer a dedicated isolated agent worker, **not an AI endpoint inside the public scan handler**. User chooses provider/model and explicitly consents to sharing code.
- Work on a throwaway Git branch/worktree or isolated volume; produce unified diffs per change set; refuse unapproved external writes.
- Add rollback and per-change transaction state. Every agent-generated claim must link to actual modified files and test outcomes.

### E. Verify that the app *actually works better*

- Record baseline test/build/type/lint status and selected golden outputs before refactoring.
- Re-run all applicable checks on candidate. If a baseline test passed and candidate fails, mark **REGRESSION** and block acceptance.
- Add integration tests for app routes, data pipelines, configs, background jobs and core flows. Add Playwright UI smoke tests where the project supports it.
- Measure actual startup, key-flow latency, memory footprint, build/bundle size, error rates and API call counts on repeatable workloads. Show before, after, percent change, sample sizes and uncertainty.
- **Never** claim improved speed merely because fewer dependencies or files exist. Missing tests/benchmarks imply **INCONCLUSIVE**, not verified safe.

### F. Product and GitHub

- Keep ZIP upload, public GitHub read, Android/Chromebook-friendly browser UI.
- Add opt-in private GitHub OAuth, draft-PR creation and review diff viewer. Never auto-push or auto-merge without user approval.
- Never require a paid proprietary subscription for the deterministic scanner. AI models and hosting may have costs; display them transparently.
- Support optional direct coding enhancement mode only with user-approved requirements and new tests. Keep normal Structural Repair mode behavior-preserving.

## Required output/report schema

Preserve `summary`, `graph`, `findings`, `fixes`, `repairPlan`, `architecture`, `refactorBlueprint`, `agentTask`, and full JSON report downloads. New fields should be versioned and backward compatible.

For every generated refactor:

```
ChangeSet {
  id, findingIds, affectedFiles, entrypoints, callPaths,
  sourceEvidence, targetDesign, rejectedOptions,
  intendedBehavior, contractsToPreserve,
  baseRevision, beforeSnapshot, patchDiff,
  verificationPlan, actualTestResults, benchmarkEvidence,
  warnings, rollbackPlan, approvalStatus
}
```

No invented test results. No silent deletions. No giant all-files rewrite without a staged migration.

## Acceptance checklist

1. `npm ci && npm test` passes all 23 baseline tests, plus new feature tests.
2. Can scan a **1,200+ file repo** and **33+ MiB archive**; behavior is bounded by configurable machine resources, not former hard caps.
3. Detects exact circular dependency and shows both refactor alternatives with actual files.
4. A duplicate-calculation fixture yields an appropriate shared extraction proposal, preserving public exports; a future agent actually creates a working patch on a copy.
5. A seeded regression in candidate causes automatic acceptance to fail.
6. No uploaded source code is executed in scan worker or sent to external AI without explicit opt-in.
7. UI shows the most important modules, exact change sets, preview diffs, plan choices, tests, rollback and downloadable result.
8. No unmeasured performance improvement claim.
9. User can upload ZIP, or public GitHub repository with no login, and obtain a complete report.
10. If any phase fails or model is rate limited, the deterministic scanner remains fully usable and no project files are lost.

## Technical references

Official documentation: https://opencode.ai/docs/build/sdk , https://knip.dev/explanations/how-knip-works , https://ast-grep.github.io/ , https://nodejs.org/api/cli.html . Other open-source scanners may be integrated under their own compatible licenses.

Start with README, STATUS, SCALING_AND_LIMITS, ARCHITECTURE_UPGRADE_BLUEPRINT, source modules and tests. **Build on the supplied code; do not replace it.**
