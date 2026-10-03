# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
GitHub: https://github.com/peach0x33a/codex-remote (private; origin/master upstream)
Published frontend: 2822c29
Published backend: 1f36f43

## Latest delivery

Removed literal outer square brackets from pasted-text chips in the composer and sent/steer previews. Frontend 2822c29 published; backend 1f36f43 and PID 527090 remain live. Typechecks, isolated Vite/PWA build and served asset hashes passed. See task-history/2026-10-03-pasted-text-label.md.

Terminal unobserved steers can be removed as hints or returned to the composer draft; they no longer remain permanently waiting or count as live work. Long pastes fold into editable text chips while preserving full native input, and caret scrolling follows paste/expansion/recall. The latest 100 submitted inputs per device are stored privately on the Bun server and recalled across conversations, refreshes and browser contexts. Details and the active-steer cancellation protocol limit: task-history/2026-10-03-composer-history-pasted-text-steer-recovery.md.

Session device/thread IDs now appear in the URL and restore after authentication/profile loading. The live-turn ID owns timers and sends, preventing historical unfinished turns from restarting a finished working clock. Prior release: task-history/2026-10-03-session-url-live-turn-state.md.

Navigation error banners remain directly below the header, edge to edge. The header file-browser button opens the current directory and can navigate out of a missing default path. Details and capability/entry matrix: task-history/2026-10-03-navigation-files-entry-audit.md.

User criterion: commands count as first-level menu entries. Goal, Git changes, skills and mentions already have valid command entries. Under this criterion, no additional independent capability lacking a button/menu/command entry was confirmed after adding the file browser. Do not add duplicate controls merely because a capability's entry is a command.

## Verification

670 full unit/integration tests passed (5,770 assertions, 51 files), and 112 full desktop/mobile browser cases passed. After the final local pasted-part ID fix, 16 prompt/history unit cases and 10 browser cases passed against the exact final build. Final Vue/server typechecks and Vite/PWA build passed. Light/dark desktop/mobile pasted-input and terminal-steer captures were inspected. Mobile coverage is emulated. Existing large-bundle warning remains.

## Running service

Frontend 2822c29 published at 2026-10-03T23:29:37.154232+08:00 without a backend restart. Backend 1f36f43 was published at 2026-10-03T23:12:05.694749+08:00. Actual Bun PID 527090 listens on 127.0.0.1:3000 after a verified restart from PID 3102363. Health, auth, history API and exact served hashes were verified. The existing requiresKey=false state, environment and saved device credentials were preserved. Metadata: .local/deployment.json. Previous frontend: .local/releases/20261003-231205-before-1f36f43. Rollback backend source: .local/releases/20261003-231205-backend-b2266f5. Older PID/auth state records are historical.

Input history shares the existing .local/credentials.json private atomic store; 100 entries per device and 16 MiB globally. Do not put this file under dist. The installed Codex CLI is 0.159.0; its schema has no individual accepted-steer cancellation method. Ended-steer removal is a hint/draft operation, not a server history edit. Website history is collected prospectively; external TUI inputs are not bulk-imported.

## Preserved behavior

- Markdown syntax highlighting and copy controls remain deployed. See task-history/2026-10-02-markdown-syntax-highlighting.md and task-history/2026-10-02-markdown-code-copy.md.

- Multiple exact APP_ORIGIN values, active Goal time updates and unified menu geometry remain deployed; Tailscale is not configured. See task-history/2026-10-02-origins-goal-menu-consistency.md.
- Mobile keyboard avoidance, server-side device persistence, deferred workspace preparation, Goal resume, context-window-only Session ID copying, stream backpressure handling and stopped-turn work time remain in place.
- Prior GitHub publication is recorded in task-history/2026-10-02-github-publication.md. This fix is committed on local master and was not pushed by this task.
- Older feature/snapshot worktrees remain available as recovery points. The earlier merge/test-pruning record is task-history/2026-10-01-main-merge-test-pruning.md.
