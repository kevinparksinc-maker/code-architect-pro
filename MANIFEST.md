# Application manifest — Code Architect Pro v0.3

- **App:** browser-facing code architecture diagnosis, structural redesign planning and reviewed repair output.
- **Runtime:** Node.js >=20, ESM JavaScript and `typescript` package pinned to 5.8.3.
- **UI:** plain HTML/CSS/JS, mobile-responsive; requires Node backend to process source.
- **Inputs:** project ZIP32/ZIP64, validated public GitHub ZIP, local folder/ZIP CLI, optional external JSON analyzer results.
- **Static analyses:** parse errors, imports, unresolved local references, cycles, partial direct function calls, duplicate function bodies, unreachable from known entries, suspicious fetch-in-loop, async-forEach, empty-catch, hub/fanout, large modules, unused named-import candidates.
- **Architecture:** source graph and change impact, hotspot priority, migration waves, file-specific refactor change sets with risk/verification criteria, golden-output and benchmark instructions.
- **Real automatic patches:** only conservative import binding removal after review and hash verification. Complex semantic refactoring is not automatically performed.
- **Output:** full JSON report, web preview, AI task Markdown, architecture improvement blueprint, refactor change sets, safe patch manifest, and demo patched ZIP.
- **Operational controls:** disk streaming, FIFO scans, configurable web storage budgets, ZIP security, local no preset source-count cap.
- **External AI:** *none required*. Optional SDK example needs explicit setup, consent and model access.
- **Tests:** 21 automated tests passing at time of packaging. Scripts: `npm test`, `npm start`, `npm run scan`, `npm run compare`.
- **Licensing:** this project MIT; third-party code/model services separately licensed.

## Non-negotiable product rules

1. Preserve functionality: do not blindly delete heuristically unreachable code.
2. Prefer incremental architectural improvement with public API shims rather than all-files rewrites.
3. Make improvement claims only with before/after build, test and application performance evidence.
4. Keep enhancement mode separate from structural repair mode.
5. No surprise cost, trial expiration or subscription requirement for deterministic scanner.
6. Never execute uploaded untrusted projects in the scan API.
7. No fixed project-size or source-file-count ceilings in local streaming scan; always report real resource constraints and use configurable safety budgets online.
