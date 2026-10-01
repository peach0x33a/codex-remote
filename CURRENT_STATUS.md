# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
Published application code: b7df274

## Latest delivery
Mobile keyboard avoidance is fixed and published. The shell/composer follows the visible viewport, handles dismissal and rotation, preserves drafts/reading position, and keeps side chats/dialogs usable. Details: task-history/2026-10-02-mobile-keyboard-viewport.md.

The default-directory connection failure, missing limited-goal Resume control, Session ID placement/copy behavior, false browser-speed disconnects, and interrupted-turn work-time footer are fixed and published. Current behavior and evidence: task-history/2026-10-02-session-streaming-stop-fixes.md.

- Connecting a device does not prepare directories. Explicit new work creates its configured default directory as needed, without silent fallback or connection loss on failure.
- Paused/blocked/usage-limited goals can resume. Exhausted budgets require user-confirmed edits; counters/objective are preserved.
- Session ID appears in Context Capacity with a Copy button. No Session ID action remains in the three-dot menu, and copy failure never opens a window or selects the visible ID.
- Browser-bound backpressure queues messages in order, without relying on Bun 1.3.14's unimplemented ws pause/resume methods. Combined queue/native pending data is bounded; lack of progress is distinguished from transient pressure.
- Stopped-turn durations freeze at each turn boundary in the main conversation and side chat. Native/history timing is authoritative; unknown history is not assigned invented time.
- All earlier multi-device, credentials, responsive layout, file preview/download, goals and queue work is retained.

## Verification
648 unit/integration tests pass (619 unit + 29 integration; 5,519 assertions). All 94 desktop/mobile browser cases pass; 10 focused keyboard cases were also rerun after the final small-screen height bound. Keyboard evidence uses synthetic VisualViewport events in Chromium, not physical iPhone/Android keyboards or Safari. Typecheck, production build and diff checks pass. Existing bundle-size warning remains.

## Running service
Frontend published at 2026-10-02T02:35:15.011147+08:00, code b7df274. Backend PID remains 3888293; this frontend-only publication preserved login sessions and live transports. PID/output: .local/server.pid and .local/server.log. Health and exact served HTML/service-worker hashes were verified. Previous static release: /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261002-023515-before-keyboard-layout. No real upstream task/goal mutations were used in tests and no remote Git push occurred.

## Continuity
The merge and test-pruning records remain in task-history/2026-10-01-main-merge-test-pruning.md. The old snapshot and feature worktree remain available as recovery points; current work is on master.
