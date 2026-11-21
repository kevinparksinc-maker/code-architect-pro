You are building CODE ARCHITECT PRO, an AI-assisted repository repair and architectural improvement platform. THIS IS A SOURCE-CODE CONTINUATION JOB, NOT A SCREENSHOT/MOCKUP REQUEST.

Open and preserve the attached v0.3 project. Run `npm ci && npm test` first; currently 23 tests pass. Read `BUILDER_HANDOFF.md`, `STATUS.md`, `SCALING_AND_LIMITS.md`, `ARCHITECTURE_UPGRADE_BLUEPRINT.md`, and `AGENTS.md` before changing code.

Keep ZIP32/ZIP64 upload, public GitHub scan, stream-to-disk handling, live progress, downloadable full reports, safe patch manifest, and file-specific architecture-change blueprints. Never reintroduce hard file-count or per-file-byte caps. Browser upload/storage budgets must remain user-configurable and secure.

Next, build a REAL semantic-index + data-flow + code-repair execution layer: TypeScript LanguageService, tsconfig resolution, call-path tracing, domain/layer boundary inference, architectural alternative evaluation, AST codemods, optional user-configured coding-agent sandbox, staged diffs, trusted regression and performance verification, rollback and explicit user approval. No external AI provider is required for deterministic scans. Never execute uploaded untrusted code in the public scan server.

The output must be a working updated repository with tests, logs, a real diff viewer, stable architecture-migration contracts and a clear record of what remains incomplete. Do not claim full autonomous safe refactoring until the code actually does it and its verification passes.
