# Multiple origins, live goal time, and consistent menu geometry

Date: 2026-10-02 (Asia/Singapore)
Application commit: b2266f54a69c555addb868ea5f0eab54a0ddffd3 on master.

## Delivered behavior

- APP_ORIGIN accepts comma-separated exact origins while retaining single-origin configuration and loopback development defaults. Values are trimmed, canonicalized and deduplicated. Credentials, wildcards, paths, queries, fragments and malformed entries are rejected. Any configured non-loopback origin requires the existing strong access key, including a public second entry.
- HTTP routes and WebSocket handshakes retain the same exact allowlist. Secure cookies follow the validated browser-facing Origin, so allowing LAN HTTP does not remove Secure from HTTPS logins behind a proxy. Different hostnames retain their own login cookies; device data stays shared on the server.
- Active Goal summaries update every second, even without an active-turn notification. They reuse the existing clock and interpolate from native time counters without per-second server polling. Token-only updates do not restart timing. Counter/status/thread changes reset the baseline; paused, blocked, limited and completed goals show the fixed authoritative duration. Full and compact labels share one calculation.
- Button-opened menus share 16px panel corners, 8px panel inset, 8px option corners, 8px/12px option padding and 44px minimum rows. Removed conflicting overrides in project, conversation, changes and task-grouping menus. Model, permission, device and settings menus inherit the same rules.
- Select triggers follow existing pill controls; menu keyboard focus is visible and inset. Standard dialog padding is 24px desktop / 16px mobile. Split-pane and fullscreen layouts keep their structures. Session ID field spacing is aligned without changing copy behavior. DESIGN.md records the geometry.

## Verification

- 654 unit/integration tests passed, 0 failed, 5,589 assertions across 50 files.
- All 96 desktop/mobile Chromium Playwright cases passed in 4.2 minutes, including live Goal time, pause/resume, keyboard avoidance, settings, copy behavior and shared profiles.
- Vue/server typechecks, production Vite/PWA build and git diff --check passed. Existing large-bundle warning remains.
- An isolated real startup check verified both configured origins, HTTPS cookie flags through an HTTP proxy hop, foreign-origin rejection, malformed-list rejection and strong authentication with a public second origin.
- Reviewed 32 menu views: eight menu types across desktop/mobile and light/dark themes. All panels computed to 16px radius / 8px padding; all options to 8px radius / 8px 12px padding / 44px minimum height. No viewport overflow, clipping or page errors. Screenshot contact sheet reviewed.
- UI review tools/artifacts stay ignored under .local/review-menus.ts and .local/menu-review/, rather than becoming redundant permanent tests. Phone coverage uses Chromium emulation, not physical devices.
- Logs: /tmp/codex-origins-goal-ui-tests.log, /tmp/codex-origins-goal-ui-types.log, /tmp/codex-origins-goal-ui-build.log, /tmp/codex-origins-goal-ui-browser.log, /tmp/codex-menu-review.log.

## Publication

- Published at 2026-10-02T05:28:59.346906+08:00; frontend and backend code b2266f5.
- Retained 21 previous hashed assets. Previous frontend: .local/releases/20261002-052859-before-b2266f5.
- The previous PID file was stale. Verified the actual listener before restarting: PID 16894 to 274217. Preserved its executable, command, cwd and environment; .env and stored credentials remained byte-for-byte unchanged.
- Health is ok and access-key authentication remains required. Served index.html and sw.js exactly match the tested build with no-cache headers. Hashes are in .local/deployment.json.
- In-memory login sessions reset during restart; users log in again. Device metadata, saved credentials and Codex daemon tasks were preserved. PID/output: .local/server.pid and .local/server.log.
- Actual APP_ORIGIN addresses were not changed. No Tailscale Serve, certificates, public endpoint or real model task was configured or started. No remote Git push occurred.
