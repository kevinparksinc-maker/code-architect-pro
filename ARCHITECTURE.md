# Architecture v0.3

```
 Samsung / Chromebook browser
      ZIP upload / public GitHub repo
                  |
                  v
          Node HTTP scan API
       operational storage budgets
                  |
       [disk-backed ZIP file / ZIP64]
                  |
             FIFO job queue
                  |
       secure streamed extraction
                  |
       incremental JS/TS AST scanner
                  |
        +---------+----------+
        | module graph       |
        | partial call graph |
        | AST issue detectors|
        | file evidence      |
        +---------+----------+
                  |
         architecture insights
          fan-in/fan-out, SCC,
        hotspots, migration waves
                  |
        file-specific refactor plan
                  |
   browser report preview + full JSON
                  |
       reviewed conservative patches
              /            \
      demo ZIP export   patch manifest
                          |
                 separate trusted copy
                          |
            OPTIONAL isolated AI agent
                          |
                tests / benchmarks
                          |
                 diff / approval
```

## Trust boundaries

The HTTP scanning server parses uploaded text and archive metadata but NEVER runs downloaded project code. The local patch-applier modifies only a separate copy. Test/build/benchmark commands are explicitly opt-in and run only on trusted code outside the scanner. The OpenCode SDK adapter is not part of the server and must be hardened further before any multi-user deployment.

## Important modules

- `src/engine.mjs`: original complete-in-memory scanner for small/demo projects.
- `src/scalable.mjs`: incremental large-project scanner, one syntax tree at a time; remains O(number of modules + references + findings) memory.
- `src/archive-stream.mjs` and `src/github-stream.mjs`: disk-oriented ZIP32/ZIP64 and public GitHub ingestion.
- `src/insight.mjs`: quantitative structural measurements, prioritized findings and migration waves.
- `src/refactor-blueprint.mjs`: specific file-level alternative target designs and refactor checklists.
- `src/knowledge.mjs`: architecture decision rules.
- `src/server.mjs`: read-only scan API, asynchronous work queue, full report and repair manifest download.
- `scripts/*`: trusted optional applied patches, verification, benchmarking, AI agent.

## API endpoints

- `GET /`, `/app.js`, `/style.css` — static UI.
- `GET /api/health` — version and server upload/expansion budgets.
- `GET /api/knowledge` — engineering strategy catalog.
- `POST /api/demo` — immediate small demonstration report and safe repair ZIP export.
- `POST /api/scan/zip` — streamed ZIP, returns 202 `{jobId,poll}`.
- `POST /api/scan/github` — public GitHub `{repository}` input, returns 202 job.
- `GET /api/jobs/:id` — queued/running/complete/error state, progress and preview.
- `GET /api/jobs/:id/report` — download full JSON report.
- `POST /api/analyzers/import` — import precomputed JSON tool results (Knip/jscpd/dependency-cruiser), no user code execution.
- `POST /api/export/patch-manifest` — selected conservative patch descriptions with hashes.
- `POST /api/export/repaired-zip` — legacy small/demo in-memory repair ZIP, not the large scan path.

## Pending production requirements

- Persistent DB and indexed graph for massive codebases, paginated API, resumable upload and restart-safe jobs.
- Full type-checked TS symbols, code execution sandbox, agents with permission scopes, privacy/auth, audit logs and draft PR integration.
- Verified semantic refactoring beyond import cleanup.
