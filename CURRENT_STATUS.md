# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master

## Current work
The device-sync branch is being merged with the independently completed responsive file-preview and Copy Session ID changes. Both sets of production changes are retained. Test-suite reduction to approximately 600 effective cases is in progress; final counts and verification will replace this section when complete.

## Preserved deliveries
- Server-owned device metadata and credentials, automatic browser migration, LAN HTTP UUID support, native subAgentActivity cards, and ~/codex-remote/no-project defaults: task-history/2026-10-01-server-device-sync.md.
- Responsive island layout, device-aware file previews/downloads, and Copy Session ID: task-history/2026-10-01-responsive-files-session-menu.md.
- Previous composer, goal, queue, notification and appearance work remains included; see earlier task-history entries.

## Recovery points
- Original shared workspace snapshot: bc51b81.
- Concurrent master changes checkpoint: 263ebd6, retained on backup/master-before-device-sync-20261001.
- Feature changes commit: 9eadf8a on fix/server-device-sync.

## Runtime boundary
No Bun production-service restart or remote push in this phase. Device profiles and credentials use the private APP_CREDENTIALS_FILE; real credentials are excluded from Git and tests use isolated stores.
