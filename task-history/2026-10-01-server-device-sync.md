# 2026-10-01 — Server device sync, LAN UUIDs and native sub-agent activity

## Request
Create a separate worktree; fix crypto.randomUUID failures on LAN HTTP; keep device metadata alongside server credentials so clients share it; correctly render the supplied subAgentActivity event; default an empty device directory to ~/codex-remote and use the device default for no-project work.

## Workspace and isolation
- Worktree: /home/peach0x33a/source/repos/apps/codex-remote-device-sync
- Branch: fix/server-device-sync
- Baseline: bc51b81b7cfc6bc5c30d1df8d4b9895812f078f8, an isolated snapshot of the original uncommitted workspace, parent 5facbd4. The temporary Git index did not modify the original index or source files.
- This task's changes remain uncommitted in the new worktree. No push, merge, production restart, or production credential read/copy occurred.
- The original master workspace changed independently during this run (CURRENT_STATUS.md, App.vue, ThreadActionsMenu.vue, file-links/thread-actions e2e tests, and responsive-files-session-menu task history). Those concurrent changes were not overwritten or imported. Reconcile them deliberately when merging later.

## Implementation
- Centralized browser UUID v4 generation uses native randomUUID when available and getRandomValues otherwise. All frontend UUID callers use this helper, including message/queue IDs, attachments, mentions, background notices and undo records.
- Added authenticated /api/profiles GET/POST/PATCH/DELETE. Profiles and their bearer secrets commit together in the existing private atomic credential store. Storage format v2 prevents an older bridge from silently discarding metadata; legacy credential-only v1 files remain readable and upgrade on profile writes.
- GETs support secure-origin Fetch Metadata plus a custom request header on LAN HTTP, where browsers omit those metadata headers. Untrusted Origin/cross-site requests, unauthenticated callers and CORS preflights remain rejected. Secrets never return to clients.
- Device names, normalized endpoints, default directories, credential references and the default selection persist on the server. Per-record mutations merge against current server state; concurrent clients do not replace one another's lists. The current page keeps its active selection when another client switches devices.
- The metadata owner loads on session startup/login, refreshes on focus/visibility and every ten seconds while visible, drops removed/reconfigured device transports, and ignores stale reads after saves. Expired sessions clear metadata and transports. Session-only tokens remain in memory.
- Old browser metadata imports once, without overwriting existing endpoints. The legacy storage key is removed only after all imports succeed. Server-backed saves work even when browser storage is unavailable. Offline copy/tests now accurately describe server-dependent metadata.
- Empty device directories become ~/codex-remote. Home paths are resolved and prepared by a bounded command/exec on the connected device, with paths passed as shell arguments. No-project selection maps to the same default. Absolute custom directories remain explicit.
- Native started/interacted/interrupted/completed subAgentActivity events receive readable cards with path and thread ID. Inspector discovery uses the actual child thread ID. An interaction's completedAtMs does not imply the agent finished its task.
- Updated connection copy, README, environment comments and test isolation. Browser tests use a dedicated .local/e2e-credentials.json and reset server profiles between cases.

## Verification
- bun test tests/unit tests/integration: 1,017 passing tests across 49 files (final run details in /tmp/codex-remote-final-tests.log).
- bun run build: Vue/server typechecking and production build pass. The pre-existing main-chunk size warning remains.
- All 12 new desktop/mobile device-sync browser cases pass: clean second browser, edit/remove refresh, migration failure/retry, absent randomUUID, three default-directory variants, and native sub-agent rendering.
- Wider selected browser regression: 111 passed, 3 failed out of 114. Two failures (duplicate mobile close-navigation locator and missing mobile .working-status) reproduce in the pre-change snapshot. The third, workspace-badge scenario timing, passes on the pre-change snapshot and all three isolated reruns of the changed worktree. This is not an all-green full browser suite.
- Earlier broad run exposed five additional pre-existing failures: three background-control selectors plus file-mention timing and a file-search error-language expectation. All five reproduce against the isolated pre-change snapshot. No unrelated UI fixes were included.
- Real Chromium against http://192.168.2.71 on an isolated ephemeral port: isSecureContext=false, crypto.randomUUID absent, getRandomValues available. Saving/connecting, sending a message, ~/codex-remote resolution, readable sub-agent activity, and restoring the saved device in a second clean authenticated browser all pass. Browser device storage stays null. Only a synthetic daemon and synthetic credentials were used; listeners were closed afterward.
- git diff --check passes. The LAN screenshot was visually reviewed.

## Evidence and deployment boundary
Logs: /tmp/codex-remote-final-tests.log, /tmp/codex-remote-build.log, /tmp/codex-remote-device-final-e2e.log, /tmp/codex-remote-regression-e2e.log, /tmp/codex-remote-baseline-e2e.log, /tmp/codex-remote-baseline-mobile.log, /tmp/codex-remote-baseline-badge.log, /tmp/codex-remote-badge-rerun.log, /tmp/codex-remote-lan-proof.log.

The running main-workspace service was not replaced. When deploying this worktree, stop the old bridge and retain its configured APP_CREDENTIALS_FILE path; the production credentials were intentionally not copied into the new worktree. Existing browsers must visit the updated service once to migrate their previously browser-only device metadata.
