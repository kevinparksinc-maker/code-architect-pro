# Google AI Studio / alternate builder — exact handoff

1. Extract `CodeArchitect_Pro_v0.3_Builder_Kit.zip` on a machine with Node.js 20+; test locally with `npm ci && npm test && npm start`.
2. Import the **source project**, not a screenshot or standalone prompt. If the builder cannot import ZIP or directories, push the extracted source into **your own private GitHub repository** first, then import that repository. Do not assume a particular Google AI Studio upload workflow is supported without checking the current UI.
3. Give the builder `BUILDER_HANDOFF.md` as the primary engineering contract and `ARCHITECTURE_UPGRADE_BLUEPRINT.md` as the feature specification. The prompt in `GOOGLE_STUDIO_BUILD_PROMPT.md` is the short handoff.
4. Explicitly require running all tests and showing changed files, diffs, and the output of the before/after verification scripts. No fake demos or 'done' statements without evidence.
5. Keep deterministic scanning and ZIP/GitHub access functional without an AI model. Connect an AI provider only if you choose to, with transparent usage pricing.
6. Before deployment, move untrusted build/test execution into a hardened isolated worker with resource and network policies; do not run uploaded code in the same process that hosts the UI.

**Important:** Browser app builders may create front ends but not support durable backend filesystem scanning. Verify persistent Node process, disk space, scheduled job capacity, upload limits and ZIP upload support before picking a builder. A Chromebook/Samsung browser alone cannot execute the Node backend.
