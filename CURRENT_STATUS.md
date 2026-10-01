# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master

## Latest delivery
Device synchronization work is merged with the parallel file-preview, responsive layout and Copy Session ID changes. Merge commit: d9451d5. The default test suite is reduced from 1,017 to 634 cases (609 unit + all 25 integration); browser tests are reduced from 246 to 78 desktop/mobile cases. Details: task-history/2026-10-01-main-merge-test-pruning.md.

## Preserved features
- Server-owned shared device profiles/credentials, legacy browser migration and independent device runtimes.
- LAN HTTP UUID support, subAgentActivity cards, and ~/codex-remote/no-project defaults.
- Responsive island, device-aware file preview/downloads, Copy Session ID, side chat, native goals, queue controls and notifications.
- Earlier implementation records remain in task-history/2026-10-01-server-device-sync.md and task-history/2026-10-01-responsive-files-session-menu.md.

## Verification
634 unit/integration cases pass with 5,420 assertions. Vue/server typechecks and isolated production build pass. All previously covered lines in the eight critical bridge/store/runtime/queue/file modules remain covered. All 78 retained desktop/mobile browser cases pass (3.9 minutes). Exact commands and coverage comparison are recorded in this task's history entry. No skip/only/fixme markers are used to reduce counts.

## Repository / runtime boundary
- Feature commit: 9eadf8a. Main's concurrent source changes were preserved at 263ebd6 before the three-way merge. Recovery branch: backup/master-before-device-sync-20261001.
- Test pruning modifies tests/configuration and documentation, not production behavior.
- Verification build uses .local/e2e-dist and synthetic credentials. The live service's dist and real credentials were not replaced. No service restart or remote push occurred.
- Tests use tests/mock-bridge.ts, which does not inherit production .env authentication or credential paths.
