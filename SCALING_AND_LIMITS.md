# Large project scanning: exact operational limits

## What 'no arbitrary limit' means

The v0.3 **local directory scanner** enforces no fixed project-size, source-file-count, source-file-byte, or report-finding-count ceiling. It walks the repository, keeps a name index and graph in memory, and parses each JS/TS source file one at a time. This means it can progress through repositories much larger than v0.2 without holding all source ASTs in RAM at once.

**It is not mathematically unlimited.** Its resource use scales with the number of source files, graph edges, function references, findings and the *largest individual file*. Node/V8 memory, disk space, filesystem limits and execution time remain real. JavaScript parse recursion and Node process heap limits also apply.

## Browser default resource budgets

| Resource | v0.3 default | Adjust without editing code |
|---|---:|---|
| ZIP request / GitHub archive download | 1 GiB | `ARCHITECT_MAX_UPLOAD_BYTES` |
| ZIP expanded data | 3 GiB | `ARCHITECT_MAX_EXPANDED_BYTES` |
| Simultaneous large scans | 1 | `ARCHITECT_CONCURRENT_SCANS` |
| Large scan jobs retained | 60 minutes (best effort) | code/config change needed |
| Parallel queued jobs | up to 16 queued/active jobs | code/config change needed |
| Optional external JSON analyzer report | 32 MiB | `ARCHITECT_MAX_ANALYZER_REPORT_BYTES` |

These are operational safety settings, not freemium plans. **Use the local CLI for much larger trusted projects**; the CLI does not apply these browser budgets.

## Architecture design supporting scale

- Streaming uploads and remote archive downloads write to disk, not an in-memory concatenated ZIP.
- ZIP central-directory indexing supports ZIP32 and ZIP64. Entries are decompressed to a temporary directory with path validation, CRC checks and configured budgets to prevent ZIP bombs.
- Web server responds with a job ID; UI polls progress. Heavy scans are queued rather than all running at once.
- Per-file AST parsing releases each file's syntax tree before moving to the next. The in-memory graph and full findings remain necessary for cross-module analysis.
- The full report is written to disk; the web UI receives only a preview (first 250 findings, 300 graph edges, 100 repair candidates). Full details remain downloadable.
- Static scan jobs never install npm dependencies, run imports, execute code, or invoke the project's test/build commands.

## To scale further (builder target)

- Replace in-memory graph and findings with an indexed SQLite/Postgres store and paginated queries.
- Parse in bounded worker threads and persist function symbol indexes. Schedule work according to actual RAM measurements.
- Cache file fingerprints and only re-index files changed since last scan.
- Add support for monorepo workspace graphs and framework-resolved entrypoints.
- Stream export of patched files/ZIP64; current large-project path exports patch manifests, not an automatically rebuilt large ZIP.
- Add multipart/resumable browser uploads with authentication, encrypted temporary storage and explicit retention controls for hosted deployment.
- On the server, enforce low-level CPU, memory, disk and request timeout policies independently of the app to protect against malicious archives.
