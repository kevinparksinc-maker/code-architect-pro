# Deploy Code Architect Pro to GitHub + Render

## Security requirements
- The **public** Render site requires `ARCHITECT_USERNAME` and an `ARCHITECT_PASSWORD` of at least 16 characters. Set password **only in Render Secret Environment Variables**, not in GitHub, manifests, or README.
- All routes except `GET /api/health` and `GET /healthz` are protected with HTTP Basic authentication. Use the HTTPS URL Render provides.
- Static scanning does **not** execute uploaded source. Treat uploaded repositories as confidential: free Render's filesystem is ephemeral and report files are removed after a retention period.
- HTTP Basic is intended for **single-operator use**, not public multi-tenant SaaS. Add user accounts, per-user storage isolation, rate limiting and more comprehensive upload abuse prevention before opening it to other users.

## GitHub
1. Create a new **private** repository named `code-architect-pro`.
2. Upload the **contents** of this directory to the repo root, not a top-level `code-architect-pro-v0.3` folder.
3. Never commit `.env`, secrets, `node_modules`, uploaded ZIPs or reports.

## Render
1. From Render > New > Web Service, connect the private GitHub repo (or configure a Blueprint using `render.yaml`).
2. Build command: `npm ci`; start command: `npm start`; runtime: Node 22; plan: free.
3. Configure `HOST=0.0.0.0`, `NODE_ENV=production`, `ARCHITECT_USERNAME=architect`, and a strong `ARCHITECT_PASSWORD` using Render's secret env controls.
4. Health-check path: `/api/health`.
5. Start with `ARCHITECT_MAX_UPLOAD_BYTES=25165824` and `ARCHITECT_MAX_EXPANDED_BYTES=134217728` on free-tier; increase only when memory, disk and observed scan duration support it.
6. Verify unauthenticated homepage responds 401, authenticated homepage responds 200, health responds 200, and a demo scan works.

## Operational limitations
- Web uploads are bounded by configurable resources and HTTP request limits even when local CLI scanner has no hard file-count ceiling.
- No multi-user isolation, no persistent job store, and no automatic architecture AI agent in this release.
- Free Render instances may sleep and ephemeral storage is not durable.
