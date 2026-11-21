# Deeper architectural redesign — how this engine becomes an actual app improver

A better app is not just an app with fewer imports. Refactoring requires understanding **what the application must do**, establishing current behavior, choosing an architecture appropriate for its constraints, implementing a limited patch, and measuring the result.

## The seven capabilities

1. **Full symbol + call graph** (current: partial). Use the TypeScript compiler Program/LanguageService to resolve imports, re-exports, aliases, references, type relations, decorators, plugin registrations and framework entrypoints. Add language-server/Tree-sitter adapters for other languages. Link every symbol to callers, mutations, I/O and public contracts.
2. **Data-flow and ownership** (builder stage). Model where data originates, who transforms/caches/reads it, where validation occurs, where it can be dropped and where each output is consumed. Detect unnecessary recomputation, duplicated derivation, inconsistent cache keys, missing error propagation, and accidental cross-layer dependencies.
3. **Target-architecture synthesis** (partially implemented). Infer feature boundaries, service/domain layers, stable interface contracts, composition roots and reusable kernels. Compare choices: keep the modular monolith, extract a library, invert dependency direction, separate event processing, or use a controlled worker. Never force microservices from line counts alone.
4. **File-specific migration planning** (implemented as proposals). Generate `report.refactorBlueprint.changeSets`: source evidence, affected files, chosen intervention, refactor steps, alternatives, risks and acceptance checks. Order changes to avoid unrelated rewrites and preserve APIs.
5. **Code generation/patch application** (current: conservative import cleanup; agent optional). Agent should use actual source + change-set evidence to generate a unified diff. Use AST-based codemods where deterministic; use AI for genuine redesign. Isolate all writes, never touch source repository until approved, and preserve a rollback point.
6. **Verification and performance proof** (current: opt-in trusted scripts). Re-run type checks, lint, tests and build; compare golden outputs and high-risk workflows; detect changed exports/routes/events; benchmark end-to-end latency, CPU, memory, startup and bundle size on a repeatable workload. Block unsafe regressions and show inconclusive results when evidence is missing.
7. **Architectural history + continual improvement** (builder stage). Keep snapshots of graph metrics, accepted changes and measured runtime results per commit. Reject 'improvements' that increase faults or unmeasured complexity, and track architecture drift and regression trends.

## Concrete redesign cases

### Duplication without semantic drift

- Compare duplicated function signatures, closures, side effects, error handling and domain meaning.
- Extract a shared pure implementation when actually equivalent.
- Preserve existing public exports as wrappers to avoid breaking callers.
- Run golden outputs before and after on representative input and edge cases.
- Check whether the new shared dependency creates a cycle. If so, choose another ownership boundary.

### Dependency-cycle repair

- Produce an exact cycle: `A → B → C → A`.
- Ask which edge reflects an inverted responsibility.
- Offer **two justified strategies**: isolate common types/pure code into a shared kernel; or use dependency injection/inversion where domain code should not import infrastructure.
- Change one edge at a time and re-run graph check + integration tests.

### Excessive service/module coupling

- Measure dependent count, import count, and actual clusters of consumers.
- Determine whether the module is a valid stable facade or an overloaded "god module".
- Keep a public facade while moving cohesive internal responsibilities into focused modules. Keep domain services separate from UI and network orchestration.
- Confirm exact consumers still build and integration behavior is preserved.

### Slow / unstable reading pipeline

- Trace input → calculation → cache → transformation → synthesis → UI response.
- Identify repeated calculations, inconsistent results, long sequential waits, retry loops, missing error paths, and API calls that the backend should batch.
- Refactor only after measured traces. Use instrumentation with before/after latency and error data.
- Compare output shapes and semantics before declaring a refactor correct.

## What an AI builder must implement next

- Authenticated, provider-agnostic agent orchestrator with user consent to send code to a selected model.
- Sandboxed build/test workers with CPU/RAM/time/network policies separate from the scan API.
- AST-safe codemod engine + patch staging + unified diff viewer.
- Full TypeScript LanguageService and tsconfig/workspace-aware module resolution.
- Representative golden-master fixtures, browser smoke tests, API/route verification and repeatable performance baselines.
- Optional GitHub OAuth/private repo read and **draft PR only after explicit approval**, with no hidden push.
- Persisted incremental index and paginated reports for very large monorepos.

**Truth rule:** The included prototype can propose and perform small conservative code changes; full autonomous architectural redesign with proven behavior preservation is the **next build stage**, not a completed claim.
