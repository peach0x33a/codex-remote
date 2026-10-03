# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
GitHub: https://github.com/peach0x33a/codex-remote (private; origin/master upstream)
Published frontend: d0dcb2c
Published backend: b2266f5

## Latest delivery

The top workspace error banner now fills the full workspace width with no outer margin or rounded corners on desktop/mobile. Inner padding, wrapping and dismissal remain intact. Details: task-history/2026-10-03-edge-to-edge-error-banner.md.

## Verification

For this CSS-only change: Vue/server typechecks, Vite/PWA production build and diff checks passed. Four isolated browser checks reproduced the real connection-error banner across desktop/mobile and light/dark themes, verifying exact edge alignment, no overflow, header adjacency and dismissal. Screenshots were reviewed. Mobile coverage is emulated. No permanent test was added and the full suite was not rerun; prior highlighting validation had 658 unit/integration tests and eight browser cases passing. Existing large-bundle warning remains.

## Running service

Frontend published at 2026-10-03T19:05:30.582501+08:00. Actual Bun listener PID 3102363 continues on port 3000 without a restart. Health and exact served hashes were verified. The live unauthenticated session endpoint already reported requiresKey=false before this deployment; this task preserved it, the environment and device credentials. Earlier records referring to PID 274217 and enabled access-key authentication are historical. Deployment metadata: .local/deployment.json. Previous frontend: /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261003-190530-before-d0dcb2c.

## Preserved behavior

- Markdown syntax highlighting and copy controls remain deployed. See task-history/2026-10-02-markdown-syntax-highlighting.md and task-history/2026-10-02-markdown-code-copy.md.

- Multiple exact APP_ORIGIN values, active Goal time updates and unified menu geometry remain deployed; Tailscale is not configured. See task-history/2026-10-02-origins-goal-menu-consistency.md.
- Mobile keyboard avoidance, server-side device persistence, deferred workspace preparation, Goal resume, context-window-only Session ID copying, stream backpressure handling and stopped-turn work time remain in place.
- Prior GitHub publication is recorded in task-history/2026-10-02-github-publication.md. This fix is committed on local master and was not pushed by this task.
- Older feature/snapshot worktrees remain available as recovery points. The earlier merge/test-pruning record is task-history/2026-10-01-main-merge-test-pruning.md.
