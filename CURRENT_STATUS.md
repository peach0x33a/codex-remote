# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
Published application code: 78e46cb

## Latest delivery
The default-directory connection failure, missing limited-goal Resume control, Session ID placement/copy behavior, false browser-speed disconnects, and interrupted-turn work-time footer are fixed and published. Current behavior and evidence: task-history/2026-10-02-session-streaming-stop-fixes.md.

- Connecting a device does not prepare directories. Explicit new work creates its configured default directory as needed, without silent fallback or connection loss on failure.
- Paused/blocked/usage-limited goals can resume. Exhausted budgets require user-confirmed edits; counters/objective are preserved.
- Session ID appears in Context Capacity with a Copy button. No Session ID action remains in the three-dot menu, and copy failure never opens a window or selects the visible ID.
- Browser-bound backpressure queues messages in order, without relying on Bun 1.3.14's unimplemented ws pause/resume methods. Combined queue/native pending data is bounded; lack of progress is distinguished from transient pressure.
- Stopped-turn durations freeze at each turn boundary in the main conversation and side chat. Native/history timing is authoritative; unknown history is not assigned invented time.
- All earlier multi-device, credentials, responsive layout, file preview/download, goals and queue work is retained.

## Verification
648 unit/integration tests pass (619 unit + 29 integration; 5,519 assertions). All 84 retained desktop/mobile browser cases pass. Typecheck, production build and diff checks pass. Existing bundle-size warning remains.

## Running service
Published at 2026-10-02T01:45:46.058398+08:00. Bun web bridge PID: 3888293; .local/server.pid and .local/server.log identify the detached process. Listener configuration and access-key authentication were preserved. A bridge restart invalidated old application login sessions; users refresh and log in again. Device settings and tokens remain persisted in the existing private store.

Health endpoint and served HTML/service-worker hashes were verified. Previous static release: /home/peach0x33a/source/repos/apps/codex-remote/.local/releases/20261002-014546-before-copy-pressure-stop. No real upstream task/goal mutations were used in tests and no remote Git push occurred.

## Continuity
The merge and test-pruning records remain in task-history/2026-10-01-main-merge-test-pruning.md. The old snapshot and feature worktree remain available as recovery points; current work is on master.
