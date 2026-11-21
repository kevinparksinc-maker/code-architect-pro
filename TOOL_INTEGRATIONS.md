# Integration choices, licensing and trust rules

| Tool | Job | v0.3 status |
|---|---|---|
| TypeScript compiler AST | Parse JS/TS and inspect syntax | Integrated |
| Internal import graph + partial call graph | Cross-file relationships | Integrated (heuristic) |
| Built-in duplicate/cycle/hub/async detectors | Evidence for architecture issues | Integrated |
| Knip | Unused modules/exports/dependencies | **JSON import only** (tool is not run on uploads) |
| jscpd | Copy/paste duplicate blocks | **JSON import only** |
| Dependency Cruiser | Dependency graph/rules | **JSON import only** |
| ts-morph / TypeScript LanguageService | Full semantic references and codemods | Planned; not installed |
| ast-grep | Structural search and targeted codemods | Planned; not installed |
| OpenCode SDK `@opencode/sdk` | Optional coding-agent implementation | Example adapter only; must install and configure separately |
| Playwright, benchmark harness | Prove UI/runtime behavior and performance | Builder stage; only basic trusted npm script helpers included |

Current documentation references: https://opencode.ai/docs/build/sdk, https://ast-grep.github.io/, https://knip.dev/features/reporters, https://nodejs.org/api/cli.html.

Never invoke a project's npm scripts, package install, generated configuration, build step, or binary while scanning untrusted uploads. Hosted AI providers may incur fees and receive code only after the user's specific opt-in.
