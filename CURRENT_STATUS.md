# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
GitHub: https://github.com/peach0x33a/codex-remote (private; origin/master upstream)
Published application code: b2266f5 (frontend and backend)

## Latest delivery

Published the existing master history to the private GitHub repository on 2026-10-02. Initial source tip 1d1aaf695e5bf85797765ec7f49433e0ec06f42a was verified against the remote master reference. Publication details: task-history/2026-10-02-github-publication.md.

Multiple APP_ORIGIN addresses, live Goal time and consistent menu geometry are implemented and published. Details: task-history/2026-10-02-origins-goal-menu-consistency.md.

- APP_ORIGIN supports comma-separated exact HTTP/HTTPS origins with existing authentication retained. HTTPS logins retain Secure cookies when LAN HTTP is allowed. Deployment addresses remain unchanged; Tailscale was discussed but not configured.
- Active Goal time refreshes every second using the existing clock without periodic goal polling. Native counters stay authoritative and inactive goals stop advancing.
- Model, permission, device, project, conversation, changes, settings and task-grouping menus share 16px panel / 8px option corners, 8px panel inset and 44px minimum rows. Dialog spacing and control shapes follow shared tokens.
- Mobile keyboard avoidance remains published: visible-viewport tracking, preserved drafts/reading position, and usable side chats/dialogs. Evidence: task-history/2026-10-02-mobile-keyboard-viewport.md.
- Earlier connection readiness, goal resume, Session ID, stream backpressure and stopped-turn time fixes remain intact. Evidence: task-history/2026-10-02-session-streaming-stop-fixes.md.

## Verification

654 unit/integration tests passed (5,589 assertions, 50 files). All 96 desktop/mobile browser cases passed in 4.2 minutes. Typechecks, production Vite/PWA build, startup/auth smoke checks and diff checks passed. Reviewed 32 desktop/mobile light/dark menu captures with consistent geometry and no clipping, overflow or page errors. Phone coverage uses browser emulation, not physical phones. Existing large-bundle warning remains.

## Running service

Published at 2026-10-02T05:28:59.346906+08:00. Actual old listener PID 16894 was replaced with PID 274217; the stale PID file was corrected. PID/output: .local/server.pid and .local/server.log. Health and exact served HTML/service-worker hashes were verified. Authentication remains enabled; users log in again after restart. Environment and credentials were preserved. Previous frontend: .local/releases/20261002-052859-before-b2266f5. Metadata: .local/deployment.json. No real upstream task/goal mutations occurred during that deployment. The GitHub publication did not restart or revalidate the running service.

## Continuity

The prior merge/test-pruning record is task-history/2026-10-01-main-merge-test-pruning.md. Old snapshot and feature worktrees remain available as recovery points. Current work is on master.
