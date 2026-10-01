# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
HEAD: 5facbd4 feat: build codex remote workspace. Changes remain uncommitted.

## Current delivery
Latest work fixes the compact island layout, adds device-aware file previews/downloads and adds Copy Session ID. Details: task-history/2026-10-01-responsive-files-session-menu.md. Prior workspace/goal work is recorded in task-history/2026-10-01-workspace-badge.md; earlier records remain in task-history/.

- Project and goal share one compact island row. Slash/mention/skill lists replace the island, use source tabs and only real pending pages. Paused goal can resume directly; /goal, /goal objective, /goal edit and /goal status have distinct behaviors.
- Native conversation actions and side chat are wired. Sidebar logo starts a new chat; its duplicate expanded-sidebar entry is removed. Choices and device-specific drafts are retained.
- Multiple devices remain connected independently; state and notifications are isolated/aggregated deliberately. The device picker reports each connection and can disconnect it separately.
- Connection tokens live in an endpoint-bound Bun private file, default .local/credentials.json (0600), overridable with APP_CREDENTIALS_FILE. Browser stores only the credential reference. Remember/replace/clear/remove workflows are available. No real tokens were read or saved by tests.
- The island shows the current directory's Git branch beside the project picker, independent of any goal: a fork icon in the accent colour for a linked worktree, a branch icon for an ordinary repository, a short commit for a detached HEAD. It is read-only (rev-parse/symbolic-ref over command/exec, bounded and abortable), clears on device or directory change, refreshes when a turn ends, and is absent outside Git (src/lib/git-context.ts, src/composables/useGitContext.ts, src/components/WorkspaceBadge.vue).
- Shared switches correct dark thumb contrast and positioning. Existing notification, font, background, slider and image-preview work remains included.

- Narrow island layouts preserve readable goal text/time and three 44px controls while keeping the workspace independent of goal state.
- Device file links open Markdown/text/code/images in a right preview panel, browse directories, or ask before downloading binaries. The Unix/Python 3 reader uses bounded, fingerprint-verified chunks. Browser streaming is supported; the Blob fallback caps downloads at 128 MiB.
- Conversation actions → Copy → Copy Session ID copies the current backend thread ID verbatim, including empty conversations.

## Verification
992 unit/integration tests passed with 5438 assertions across 45 files. Typecheck, production build and diff checks passed. 30 focused Playwright cases passed on desktop/mobile: 16 island-layout cases, 10 file-preview/download cases and 4 Session ID cases. Light/dark screenshots were reviewed. Existing main-bundle size warning remains non-fatal (~875 kB). The full historical browser suite was not rerun.

## Runtime boundaries
Current execution allowed isolated mock servers and Chromium tests. The earlier credential API 404 is resolved. The existing service on 127.0.0.1:3000 returned ok:true and served exactly current dist/index.html after the build. Static frontend files are read from disk; changes to non-watch server code still require restarting the existing tmux service. No live upstream task, credentials, archive mutation or workspace undo was used for tests.

Accepted turn/steer cancellation and scheduled-task creation are not exposed by the installed App Server. Pending pre-dispatch steers and native queued messages can be removed. Native TUI queue display remains separate from the shared Web queue. The slash menu intentionally lists implemented web actions, not unsupported TUI-only commands.

## Continuity
Earlier feature records remain in task-history/ (including 2026-09-30-conversation-motion-changes-queue.md and 2026-09-30-composer-goals-conversation-inspector.md). Local Codex source was inspected read-only at /home/peach0x33a/workspace/codex/codex-rs; it was not modified. Current localhost service health and frontend build freshness were verified on 2026-10-01.
