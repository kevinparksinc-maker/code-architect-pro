# Code Architect Pro v0.3 — Start Here

Verified on Node.js 22: `npm test` passes 23/23, the server starts, and the built-in demo scan runs end to end.

## Run it (one time setup, then every time you want to use it)

1. Install Node.js 20 or newer from https://nodejs.org (LTS version).
2. Open a terminal in this folder.
3. Run:

   npm ci
   npm start

4. Open http://127.0.0.1:3000 in your browser.
5. Click the demo button to see a sample report, or upload a ZIP of your own project, or enter a public GitHub owner/repo.

## Important

- The app runs on the computer you start it on. Phones and tablets can open it only if it is running on a computer on the same network, or on a hosted server.
- It does not run the code you upload. It only reads it.
- Download the full JSON report from the results page to keep your analysis.
- To apply fixes, see README.md, "Actual repair workflow". Always work on a copy.

## Hosting (Render)

Set these environment variables on the host: `HOST=0.0.0.0` (required so the host can reach the app). Render sets `PORT` automatically. Build command: `npm ci`. Start command: `npm start`.
