# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
HEAD: 5facbd4 feat: build codex remote workspace. Changes remain uncommitted.

## Current delivery
Latest work adds the island's Git branch/worktree badge and fixes the goal resume button. Details: task-history/2026-10-01-workspace-badge.md. Before that: Up/Down input recall, completed work time and credential-API compatibility errors (task-history/2026-09-30-input-recall-work-duration.md). Previous larger delivery: task-history/2026-09-30-island-credentials-multi-device.md.

- Project and goal share one compact island row. Slash/mention/skill lists replace the island, use source tabs and only real pending pages. Paused goal can resume directly; /goal, /goal objective, /goal edit and /goal status have distinct behaviors.
- Native conversation actions and side chat are wired. Sidebar logo starts a new chat; its duplicate expanded-sidebar entry is removed. Choices and device-specific drafts are retained.
- Multiple devices remain connected independently; state and notifications are isolated/aggregated deliberately. The device picker reports each connection and can disconnect it separately.
- Connection tokens live in an endpoint-bound Bun private file, default .local/credentials.json (0600), overridable with APP_CREDENTIALS_FILE. Browser stores only the credential reference. Remember/replace/clear/remove workflows are available. No real tokens were read or saved by tests.
- The island shows the current directory's Git branch beside the project picker, independent of any goal: a fork icon in the accent colour for a linked worktree, a branch icon for an ordinary repository, a short commit for a detached HEAD. It is read-only (rev-parse/symbolic-ref over command/exec, bounded and abortable), clears on device or directory change, refreshes when a turn ends, and is absent outside Git (src/lib/git-context.ts, src/composables/useGitContext.ts, src/components/WorkspaceBadge.vue).
- Shared switches correct dark thumb contrast and positioning. Existing notification, font, background, slider and image-preview work remains included.

## Verification
959 unit/credential-handler integration tests passed with 5045 assertions across 43 files. Fixed the goal island's resume button, whose click handler referenced `resume` without calling it, so resuming a paused goal did nothing (src/components/GoalPanel.vue). Typecheck and production build passed. 210 Playwright cases discovered (not browser-executed; the three new workspace-badge.e2e.ts cases are unrun). Main JS bundle retains a non-fatal size warning (~842 kB).

## Runtime boundaries
Browser execution was denied earlier and real listeners are restricted; no workaround was attempted. The earlier /api/credentials 404 in the live backend is resolved (user confirmed after the Bun bridge was restarted). Per the Codex session record, the bridge runs in tmux session `codex-remote` on 127.0.0.1:3000; source changes only reach it after `bun run build` and restarting that session, since a non-watch Bun process does not reload. No live upstream task, credentials, archive mutation or workspace undo was used for tests.

Accepted turn/steer cancellation and scheduled-task creation are not exposed by the installed App Server. Pending pre-dispatch steers and native queued messages can be removed. Native TUI queue display remains separate from the shared Web queue. The slash menu intentionally lists implemented web actions, not unsupported TUI-only commands.

## Continuity
Earlier feature records remain in task-history/ (including 2026-09-30-conversation-motion-changes-queue.md and 2026-09-30-composer-goals-conversation-inspector.md). Local Codex source was inspected read-only at /home/peach0x33a/workspace/codex/codex-rs; it was not modified. A localhost service existed earlier, but current live service health is not asserted.
