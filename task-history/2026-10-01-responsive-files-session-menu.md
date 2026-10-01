# 2026-10-01 — Compact island, device file links, Session ID copy

## Requests and delivery
- Fixed the reviewed narrow-screen overlap when project, worktree and goal share the island. Container-based rules preserve the three 44px goal actions, compact elapsed time, accessible labels and independent workspace display.
- Filesystem links no longer resolve against the browser URL. Markdown, text/code and raster images open in the right panel; directories can be browsed; unsupported binaries ask before download. Relative Markdown links use the document directory and source links support line references.
- Reads bind to the conversation's own device, including side chats. Closing the preview or switching context cancels work and discards stale responses. Fixed Python 3 source and separate path arguments implement bounded, read-only command/exec access. File fingerprints protect multi-chunk downloads.
- Downloads use 256 KiB chunks. Direct browser file saving streams to disk; the Blob fallback caps downloads at 128 MiB. Text previews cap at 128 KiB, raster images at 8 MiB and directory lists at 500 entries. Remote filesystem access currently requires Unix/Python 3.
- Conversation actions → Copy → Copy Session ID copies active.id verbatim with existing clipboard feedback. Empty conversations are supported, and switching conversations changes the copied ID.

## Changed areas
- ApprovalIsland.vue, GoalPanel.vue, WorkingDirectoryPicker.vue and workspace-badge.e2e.ts.
- file-links.ts, markdown-engine.ts, workspace-files.ts, WorkspaceFilePanel.vue, MessageItem.vue, ToolActivityGroup.vue, SideChat.vue, App.vue and style.css.
- ThreadActionsMenu.vue, thread-actions.e2e.ts; file-links tests, workspace-files tests, side-chat test boundary and tests/mock-daemon.ts.

## Verification
- 992 unit/integration tests passed: 5438 assertions across 45 files.
- 16 desktop/mobile island regressions passed, including 320/390px, 150% typography, narrow desktop containers and actual goal operations.
- 10 file browser regressions passed: rendered Markdown, relative links, directories, images, download confirmation, exact downloaded bytes, streamed saving and stale-response cancellation.
- 4 Session ID browser regressions passed: conversation switches and empty conversations on desktop/mobile. Markdown panel/composer non-overlap was also checked.
- Typecheck, production build and git diff --check passed; existing bundle-size warning remains non-fatal. Desktop/mobile screenshots reviewed in light/dark modes.
- Existing localhost service returned ok:true; its index.html exactly matched current dist/index.html. Static files are served from disk, so no server restart was needed. PWA clients may need the update action.

Tests used isolated mock servers and temporary filesystem fixtures. No live upstream tasks, credentials or user filesystem mutations were exercised. No commit/push performed; unrelated uncommitted work remains intact.
