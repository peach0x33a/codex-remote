# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
GitHub: https://github.com/peach0x33a/codex-remote (private; origin/master upstream)
Published frontend: 40b7e98
Published backend: 40b7e98

## Latest delivery

Application updates are no longer gated on running work. The full-width banner below navigation keeps a single availability message, applies the update as an explicit user action regardless of task, revision or queue state, and disables the button only while its own request is in flight. Failure still shows the retryable error toast. Details: task-history/2026-10-04-unblocked-update-banner.md.

Portable appearance export/import includes theme, content width, wrapping, font names/sizes, embedded uploaded background or remote HTTP/HTTPS URL, and image effects. Invalid imports or failed image loads preserve the existing appearance. Network backgrounds load directly in the browser; export excludes connection settings and credentials.

File browser directory actions set the next conversation's cwd, create folders, or create empty files on the remote device without overwriting existing entries. Docked opening/closing animates the conversation width; mobile overlay and reduced-motion behavior are preserved. Complete HTML/HTM files offer static HTML/CSS/SVG preview and source tabs; scripts and relative asset serving are unsupported. Native fileChange activities now use file cards and numbered colored diffs, with truthful raw fallbacks.

Subagent conversations carry visible sidebar/header/details badges, native names/roles and a parent-conversation link; ordinary forks are not mislabeled. The Session ID field is content-sized and retains its explicit copy action. Inline thinking text and icons align to the first line. Details: task-history/2026-10-04-appearance-transfer-file-browser.md.

## Recent preserved delivery

Two deliberate older-direction gestures at the transcript top load one earlier page, with wheel inertia grouping, touch support, duplicate/loading guards and fresh retry intent. The manual history button is centered. A visible message anchor preserves reading position; late responses cannot scroll a different device/thread.

Read groups expand into deduplicated vertical paths under 读取了 X 个文件; original execution data is behind 执行详情. Image-view records can open the actual remote image through the conversation device's file preview. Completed one-line reasoning displays its icon, sanitized text and native duration inline; multi-line reasoning stays collapsible, and live/blank reasoning stays out of the transcript. Application updates use a full-width banner below navigation with manual update, duplicate-request protection and retry; task activity does not disable the action. Details: task-history/2026-10-04-history-gestures-tool-previews-update-banner.md.

/fast toggles Priority off/on and shares its state with the top-left reasoning lightning button. The menu displays 快速模式 with Chinese description. /compact and the context-capacity button invoke native thread/compact/start with streamed progress. See task-history/2026-10-04-fast-priority-manual-compaction.md and task-history/2026-10-04-fast-menu-name.md.

Terminal unobserved steers can be removed as hints or returned to the draft. Long pastes fold into editable chips (outer square brackets removed) while preserving full native input and caret scrolling. Device-wide input history keeps the latest 100 website submissions on the private Bun store and restores them across conversations, refreshes and browser contexts. See task-history/2026-10-03-composer-history-pasted-text-steer-recovery.md and task-history/2026-10-03-pasted-text-label.md.

## Verification

682 full unit/integration cases passed (5,889 assertions, 51 files) with the unblocked update banner in the tree; the focused banner case asserts an enabled button during work, one call for duplicate clicks and a real retry after failure. Vue/server typechecks passed. 34 focused desktop/mobile browser cases passed against the previous staged build; this change has no browser or deployment verification yet — no Vite/PWA build, backend restart or served-hash check. Vue/server typechecks, Vite/PWA build, diff check and live asset hashes passed. Captures for portable settings, directory actions, HTML, subagent identity, colored diffs and compact Session ID were inspected. Mobile coverage is browser emulation; no physical handset check. Earlier full-browser results are historical, not a full-suite run for this release.

## Running service

Frontend and backend 40b7e98 published at 2026-10-04T03:16:20.272246+08:00. Backend restarted as Bun PID 2072024 on 127.0.0.1:3000 for the network-image and sandboxed-frame CSP. Isolated startup preflight and live health, exact HTML/service worker/entry hashes, CSP, history API and unchanged saved profiles/credentials passed. Existing requiresKey=false state preserved. .local/deployment.json records the release and both rollback locations.

Appearance remains browser-local but can be transferred by JSON. Font names require those fonts on the destination device; font binaries are not exported. HTTPS pages may block HTTP image URLs under the browser's mixed-content rules. HTML preview is static and isolated, without scripts or automatic relative assets.

Input history shares .local/credentials.json (private, atomic; 100 entries per device, 16 MiB globally). Do not put credentials under dist. Codex CLI 0.159.0 has no individual accepted-steer cancellation method: ended-steer removal is a hint/draft operation, not a server history edit. External TUI input history is not bulk-imported.

## Preserved behavior

- Session device/thread URL restoration and runtime current-turn timers/sending remain in place. Historical inProgress items cannot reactivate finished work. See task-history/2026-10-03-session-url-live-turn-state.md.
- Error banners stay below navigation, edge to edge. The persistent header file-browser button opens the current directory and can recover from a missing default path. Slash commands count as first-level entries; avoid duplicate controls for /goal, /diff, /skills and /mention. See task-history/2026-10-03-navigation-files-entry-audit.md.
- Markdown code highlighting/copy, multiple exact APP_ORIGIN values, active Goal time, unified menu geometry, mobile keyboard avoidance, server-side device persistence and deferred default-directory preparation remain deployed. Tailscale is not configured.
- Goal resume, context-window-only Session ID copy, stream backpressure handling and stopped-turn duration remain in place.
- Local master commits are published to origin/master. Prior publication/merge/pruning records and recovery worktrees remain available.
