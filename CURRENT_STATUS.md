# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
GitHub: https://github.com/peach0x33a/codex-remote (private; origin/master upstream)
Published frontend: ac18bc1
Published backend: b2266f5

## Latest delivery

Error banners now appear directly below the navigation header, edge to edge. A persistent header folder button opens the current conversation/working directory. Missing default paths can navigate to their parent/remote home without creating directories or starting a task. Narrow-header controls remain reachable. Details and capability/entry matrix: task-history/2026-10-03-navigation-files-entry-audit.md.

User criterion: commands count as first-level menu entries. Goal, Git changes, skills and mentions already have valid command entries. Under this criterion, no additional independent capability lacking a button/menu/command entry was confirmed after adding the file browser. Do not add duplicate controls merely because a capability's entry is a command.

## Verification

658 unit/integration tests passed (5,669 assertions, 50 files). Final Vue/server typechecks and Vite/PWA build passed. 36 desktop/mobile browser cases passed. Four theme/viewport file-panel captures, four error-banner captures and ten header geometry/hit-target checks passed; /goal and /diff entries opened their existing panels. Mobile coverage is emulated. Existing large-bundle warning remains.

## Running service

Frontend published at 2026-10-03T19:25:01.787096+08:00. Actual Bun PID 3102363 continues on port 3000 without restart. Health, auth state and exact served hashes were verified. The existing requiresKey=false state, environment and saved device credentials were preserved. Metadata: .local/deployment.json. Previous frontend: /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261003-192501-before-ac18bc1. Older PID/auth state records are historical.

## Preserved behavior

- Markdown syntax highlighting and copy controls remain deployed. See task-history/2026-10-02-markdown-syntax-highlighting.md and task-history/2026-10-02-markdown-code-copy.md.

- Multiple exact APP_ORIGIN values, active Goal time updates and unified menu geometry remain deployed; Tailscale is not configured. See task-history/2026-10-02-origins-goal-menu-consistency.md.
- Mobile keyboard avoidance, server-side device persistence, deferred workspace preparation, Goal resume, context-window-only Session ID copying, stream backpressure handling and stopped-turn work time remain in place.
- Prior GitHub publication is recorded in task-history/2026-10-02-github-publication.md. This fix is committed on local master and was not pushed by this task.
- Older feature/snapshot worktrees remain available as recovery points. The earlier merge/test-pruning record is task-history/2026-10-01-main-merge-test-pruning.md.
