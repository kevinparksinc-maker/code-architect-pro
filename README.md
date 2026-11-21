# Code Architect Pro · v0.4

A **real, locally runnable JS/TS codebase analysis and architectural repair-planning application**, with ZIP/public GitHub intake and a mobile-friendly browser dashboard. No AI key, subscription, or expired trial is required for static scans.

## What is now implemented

- **Scalable source intake:** incremental, one-source-at-a-time analysis for local directories; streamed ZIP32/ZIP64 extraction and public GitHub ZIP downloads for browser scans. No fixed number-of-source-files or per-source-byte limit in the incremental scan engine.
- **Disk-backed browser jobs:** queued scans, progress polling, server-side full JSON reports, and lightweight browser previews.
- **Dependency intelligence:** project-wide import graph, circular dependencies, partial cross-file function calls, static entrypoint reachability, high fan-in/high fan-out modules, and ranked change-impact hotspots.
- **Code quality signals:** duplicated function bodies, suspiciously unused imports, large multi-responsibility candidates, fetch calls in loops, async `forEach` mistakes, empty error handlers, unresolved paths and parse errors.
- **Better-architecture proposals:** evidence-backed architecture scorecard, file-specific change-set proposals, multiple refactor strategies, affected modules, compatibility rules, ordered migration waves, and verification gates.
- **Actual conservative repair:** AST-informed unused named-import rewrites, hash-checked and reviewable. Export patched ZIP for the built-in demonstration, or a patch manifest for large scanned projects. An opt-in CLI can apply selected conservative fixes to a separate local copy.
- **Proof workflow:** compare pre-/post-scan structural metrics, locally run trusted test/build comparisons, and optionally benchmark trusted `bench` or `benchmark` scripts with repeated runs.
- **AI option:** a *separate, unconnected-by-default* OpenCode SDK example for work in a temporary copy of trusted projects. Requires an installed SDK, explicit permission, configured model and sandbox.

**Not implemented as a completed feature:** arbitrary autonomous redesign of entire repositories with guaranteed working code, semantic full-project typechecking, Python/Java/Go understanding, reliable runtime bottleneck detection from static code, safe untrusted-code execution, auto-push to GitHub. These are clearly scoped in the builder handoff.

## Start

Requires Node.js **20+**. From this extracted project directory:

```bash
npm ci
npm test
npm start
```

Open **http://127.0.0.1:3000** in Chrome. UI is mobile-friendly; the Node backend must run on a computer/server, not in the Samsung browser alone.

### No hard source-count limits for local scans

```bash
npm run scan -- /path/to/any/repository report-before.json
npm run scan -- /path/to/project.zip report-from-zip.json
```

The local scanner parses one source file at a time and does **not** enforce a fixed number of files or source bytes. Practical resources (disk, RAM, CPU, available time and maximum size of a single AST) still apply. Generated directories and symlinks are skipped.

### Browser upload budgets are NOT permanent license limits

These safety budgets are set via environment variables, not hard-coded project quotas. Defaults are **1 GiB compressed upload**, **3 GiB expanded ZIP** and **1 simultaneous scan**.

```bash
ARCHITECT_MAX_UPLOAD_BYTES=4294967296 ARCHITECT_MAX_EXPANDED_BYTES=12884901888 ARCHITECT_CONCURRENT_SCANS=1 npm start
```

Raise limits only when your host has sufficient free disk, RAM and available request time. See **SCALING_AND_LIMITS.md**.

## Actual repair workflow

1. Upload ZIP or enter a **public** `owner/repository` on the home page.
2. Review the high-impact modules, architectural improvement blueprint, precise findings and proposed change sets.
3. Download the **full JSON report** (not only the browser preview). For a ZIP/GitHub scan, export selected conservative patches as a patch manifest.
4. For code you **trust**, extract your original ZIP locally and apply selected fix IDs to a **separate copy**:

```bash
node scripts/apply-reviewed-fixes.mjs ./original ./architecture-report.json ./candidate fix-1
```

5. Compare scans and verify the new app in your own trusted isolated environment:

```bash
node scripts/compare-architecture.mjs before.json after.json
node scripts/verify-trusted.mjs ./original ./candidate --i-trust-both
node scripts/benchmark-trusted.mjs ./original ./candidate --i-trust-both
```

Benchmarks only run if your trusted project has a `bench` or `benchmark` npm script; changes to the app are never automatically declared better based on static scanner counts.

### Verify a specific repair

The ZIP, GitHub and CLI scanner resolves aliases from the nearest `tsconfig.json` or `jsconfig.json` and local JSON files it extends. The graph labels eager runtime, explicit type-only and literal lazy imports. Runtime cycles are listed separately from cycles involving type dependencies. Rescan both versions with the same Code Architect release before comparing counts. Custom bundler aliases, project-reference layouts and dynamically computed imports can require further review.

To check a reviewed patch, keep the original and candidate in separate copies with their dependencies available. The existing patch tool applies selected import fixes to a new folder. For other reviewed changes, prepare your candidate in a separate checkout. Use the optional verification plan to state the expected call and outputs:

```json
{
  "scripts": ["check"],
  "outputs": [{"script": "verify:fixture"}],
  "wiring": [{
    "entry": "src/main.ts",
    "caller": "src/route.ts::run",
    "callee": "src/calculation.ts::calculate",
    "replaces": "src/route.ts::oldCalculate"
  }]
}
```

```bash
node scripts/verify-trusted.mjs ./original ./candidate --i-trust-both --plan repair-plan.json
```

The verifier runs `test`, `build`, and any additional named npm scripts on both copies. Each output script writes one JSON document to the path in `ARCHITECT_VERIFICATION_OUTPUT`. Use the same deterministic fixture inputs in both versions. Objects are compared independently of key order and array order is preserved. The report records pass/fail and output equality without embedding fixture values. The wiring check walks runtime or literal lazy imports from the explicit entry, looks for the direct call from the named caller, and optionally checks for a remaining call to the old target. It reports source lines and the observed path. Static matches cannot attest that a branch ran or resolve every higher-order call.

The planned verifier exits with 0 when all specified checks pass, 1 for an observed regression, 2 for an invalid invocation or execution setup error, and 3 for inconclusive evidence. The scanner's browser routes continue to analyze source as data. Tests and fixture scripts run only from the local trusted verifier.

## Builder documents

- **BUILDER_HANDOFF.md** — detailed engineering requirements, acceptance gates and what remains.
- **GOOGLE_AI_STUDIO_HANDOFF.md** — handoff workflow for Google AI Studio or another builder.
- **ARCHITECTURE_UPGRADE_BLUEPRINT.md** — techniques for actual architectural restructuring and validation.
- **SCALING_AND_LIMITS.md** — how to scale scans and handle real resource constraints.
- **MANIFEST.md** — full functional inventory and API routes.
- **STATUS.md** — tested vs. not yet implemented.
- **ENGINEERING_KNOWLEDGE_BASE.json** — serialized architecture rules for agent retrieval.

## Security and cloud deployment

The original v0.3 browser scanner has been hardened for deployment in **v0.3.1**:

- **No-login public mode** (`ARCHITECT_PUBLIC_ACCESS=true`) lets anyone use the dashboard and scanning endpoints. HTTP Basic authentication remains optional if public mode is disabled.
- Public binding requires either an explicit `ARCHITECT_PUBLIC_ACCESS=true` or configured username/password. Keep API keys and passwords off GitHub.
- Temporary scan directories are pruned periodically. Archive size, expanded size and concurrency are configurable for the actual host capacity.
- Run `npm test` before deploying. The ready-to-use Render Blueprint is `render.yaml`; the step-by-step instructions are `DEPLOYMENT.md`.
- **Warning:** No-login mode is a public scanner. Anyone can submit code, scan resources are shared, and anyone with a report URL can read that report. Don't upload sensitive code. Uploaded source is not executed during static scans.

Unauthenticated local loopback development remains supported. Internet-facing no-login mode requires setting `ARCHITECT_PUBLIC_ACCESS=true` explicitly.

MIT license for this application code; third-party tools and hosted models have their own terms and costs.
