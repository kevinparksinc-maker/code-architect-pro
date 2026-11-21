# Deploy Code Architect Pro to GitHub + Render — public no-login mode

## Public, no-login access
- Set `ARCHITECT_PUBLIC_ACCESS=true` on Render to open the site and scan endpoints without any password. This is an explicit opt-in.
- **Anyone with the URL can upload code and use scan resources.** Do not submit confidential code, because there are no per-user accounts or isolated reports. URLs for scan results can be shared.
- Archive safety checks, concurrency quotas, and upload limits remain enabled. Uploaded source is not executed by the static scanner.
- Keep API keys and environment secrets on Render, never in GitHub.

## GitHub
1. Create a GitHub repository named `code-architect-pro`.
2. Upload the **contents** of this directory to the repo root, not a top-level `code-architect-pro-v0.3` folder.
3. Never commit `.env`, secrets, `node_modules`, uploaded ZIPs or reports.

## Render
1. From Render > New > Web Service, connect the GitHub repo (or configure a Blueprint using `render.yaml`).
2. Build command: `npm ci`; start command: `npm start`; runtime: Node 22; plan: free.
3. Configure `HOST=0.0.0.0`, `NODE_ENV=production`, and `ARCHITECT_PUBLIC_ACCESS=true`. Existing username and password settings are ignored while public access is enabled.
4. Health-check path: `/api/health`.
5. Start with `ARCHITECT_MAX_UPLOAD_BYTES=25165824` and `ARCHITECT_MAX_EXPANDED_BYTES=134217728` on free-tier; increase only when memory, disk and observed scan duration support it.
6. Verify unauthenticated homepage responds 200, health responds 200, and a demo scan works.

## Operational limitations
- Web uploads are bounded by configurable resources and HTTP request limits even when local CLI scanner has no hard file-count ceiling.
- No multi-user isolation, no persistent job store, and no automatic architecture AI agent in this release.
- Free Render instances may sleep and ephemeral storage is not durable.
