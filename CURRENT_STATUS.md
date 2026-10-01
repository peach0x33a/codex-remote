# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote-device-sync
Branch: fix/server-device-sync
Baseline snapshot: bc51b81b7cfc6bc5c30d1df8d4b9895812f078f8 (parent 5facbd4).
This task's changes remain uncommitted. Main workspace and running service were not modified by this task; other concurrent edits remain in the original workspace.

## Latest delivery
LAN HTTP UUID compatibility, server-owned shared device profiles with atomic credential updates and browser migration, native subAgentActivity parsing, and ~/codex-remote/no-project defaults are implemented. Details and exact verification boundaries: task-history/2026-10-01-server-device-sync.md.

Device metadata and secrets use APP_CREDENTIALS_FILE (default .local/credentials.json, private 0600); the profile-bearing schema is v2 and accepts legacy credential-only v1 on read. Browser profiles refresh after login, on returning to the page and every ten seconds while visible. New writes do not persist device metadata in browser storage. Existing UI preferences and drafts remain separately scoped as before.

## Verification
1,017 unit/integration tests pass; typecheck and production build pass. All 12 new desktop/mobile cases pass. Real insecure LAN HTTP and a second fresh authenticated browser pass against an isolated synthetic daemon. Wider selected browser regression: 111/114 pass; two baseline mobile failures and one badge fixture timing failure remain documented. Five additional pre-existing full-suite failures were reproduced in the baseline. No claim of a green full browser suite. Main bundle retains its size warning.

## Deployment / continuity
No production restart, merge, feature commit or push occurred. Production credentials were not read or copied. Stop the old bridge and preserve its credential-file path when deploying this branch; open an existing browser once to import its old devices.

Original workspace /home/peach0x33a/source/repos/apps/codex-remote has independent concurrent changes to App.vue, ThreadActionsMenu.vue, their tests and task records. Reconcile during a later merge; do not replace that tree wholesale.

Earlier feature records (composer, queue, credentials, Git/worktree badge) remain in task-history/. Native model execution/deployment was not tested; tests used a synthetic App Server.
