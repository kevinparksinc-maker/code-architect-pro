# Next implementation milestones (after v0.3)

- **P0 — semantic correctness:** TypeScript Program/LanguageService, reliable alias/module resolution, framework entrypoint plugin registry, precise unused-symbol confidence, snapshot cache. Accept when tests cover complicated TS monorepo aliases and React routes.
- **P1 — real refactor runner:** isolated copy/worktree, AST codemod templates, agent-selected change sets, patch review, rollback. Accept when semantic repairs are applied to realistic test fixtures and baseline passing tests remain passing.
- **P2 — app behavior validation:** trusted containerized worker, golden-output API/route testing, frontend Playwright smoke tests and failure injection. Accept when regressions are blocked with logs.
- **P3 — measured performance:** startup/interaction/memory/bundle test protocol, repeatability stats, before/after charts. Accept when speed claims link to same-workload benchmark samples.
- **P4 — high scale & hosted security:** indexed SQLite graph, resumable uploads, async restarts, server budget controls, auth, storage encryption/deletion. Accept when 100k-file fixtures complete under documented machine RAM and time budgets.
- **P5 — GitHub private and PR:** OAuth scoped read, optional draft PR write with explicit approval, no auto-merge.
