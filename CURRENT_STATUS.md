# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
GitHub: https://github.com/peach0x33a/codex-remote (private; origin/master upstream)
Published frontend: b6de9a0
Published backend: b2266f5

## Latest delivery

Markdown code blocks now have language-aware syntax colors in both themes, alongside their always-visible copy buttons. Common languages plus Dockerfile/PowerShell and framework/shell aliases are supported. Source text and copying are preserved. Unknown/unlabeled code and blocks over 20,000 UTF-16 code units use escaped plain text; highlighting has a bounded cache. Details: task-history/2026-10-02-markdown-syntax-highlighting.md. Prior copy-control delivery: task-history/2026-10-02-markdown-code-copy.md.

## Verification

658 unit/integration tests passed (5,669 assertions, 50 files). Vue/server typechecks and Vite/PWA build passed. Eight focused desktop/mobile browser cases passed, including colored tokens/theme switching, exact copy behavior, file previews, sanitization and the existing HTTP fallback. Four light/dark desktop/mobile captures were reviewed. The full browser suite was not rerun. Mobile coverage is emulated; the existing large-bundle warning remains.

## Running service

Frontend published at 2026-10-02T14:26:19.006711+08:00. Bun PID 274217 continues on port 3000 without restart; existing login sessions and connections remain intact. Environment and saved device credentials were preserved. Health, authentication requirement and served hashes were verified. Metadata: .local/deployment.json. Logs/PID: .local/server.log and .local/server.pid. Previous frontend: /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261002-142618-before-b6de9a0.

## Preserved behavior

- Multiple exact APP_ORIGIN values, active Goal time updates and unified menu geometry remain deployed; Tailscale is not configured. See task-history/2026-10-02-origins-goal-menu-consistency.md.
- Mobile keyboard avoidance, server-side device persistence, deferred workspace preparation, Goal resume, context-window-only Session ID copying, stream backpressure handling and stopped-turn work time remain in place.
- Prior GitHub publication is recorded in task-history/2026-10-02-github-publication.md. This fix is committed on local master and was not pushed by this task.
- Older feature/snapshot worktrees remain available as recovery points. The earlier merge/test-pruning record is task-history/2026-10-01-main-merge-test-pruning.md.
