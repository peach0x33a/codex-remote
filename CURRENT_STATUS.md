# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
GitHub: https://github.com/peach0x33a/codex-remote (private; origin/master upstream)
Published frontend: 3787046
Published backend: b2266f5

## Latest delivery

Markdown code blocks now have an always-visible copy button. Exact code copying uses the existing HTTP-compatible clipboard path and toasts, with keyboard focus preserved. Shared rendering covers messages, reasoning/plans and Markdown previews. Styles follow current tokens, support both appearances and retain 44px touch targets. Details: task-history/2026-10-02-markdown-code-copy.md.

## Verification

655 unit/integration tests passed (5,603 assertions, 50 files). Vue/server typechecks and production Vite/PWA build passed. Final six focused desktop/mobile browser cases passed; 34 existing cases also passed during the broader initial run. Four light/dark desktop/mobile code-block captures were reviewed. The complete browser suite was not rerun for this change. Mobile coverage is emulated. Existing large-bundle warning remains.

## Running service

Frontend published at 2026-10-02T14:08:46.919809+08:00. Bun PID 274217 continues on port 3000 without a restart; existing login sessions and connections remain intact. Saved device credentials and environment were preserved. Health, authentication requirement and exact served hashes were verified. Metadata: .local/deployment.json. Logs/PID: .local/server.log and .local/server.pid. Previous frontend: /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261002-140846-before-3787046.

## Preserved behavior

- Multiple exact APP_ORIGIN values, active Goal time updates and unified menu geometry remain deployed; Tailscale is not configured. See task-history/2026-10-02-origins-goal-menu-consistency.md.
- Mobile keyboard avoidance, server-side device persistence, deferred workspace preparation, Goal resume, context-window-only Session ID copying, stream backpressure handling and stopped-turn work time remain in place.
- Prior GitHub publication is recorded in task-history/2026-10-02-github-publication.md. This fix is committed on local master and was not pushed by this task.
- Older feature/snapshot worktrees remain available as recovery points. The earlier merge/test-pruning record is task-history/2026-10-01-main-merge-test-pruning.md.
