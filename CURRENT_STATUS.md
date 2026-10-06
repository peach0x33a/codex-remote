# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
GitHub: https://github.com/peach0x33a/codex-remote (private; origin/master upstream)
Published frontend: validated feature delivery, 2026-10-06
Published backend: validated feature delivery, 2026-10-06

## Latest delivery

Task center conversation range is now explicit: 2/7/30 calendar days anchored to latest activity, all time, or custom inclusive dates. The toolbar shows the actual interval, remembers the choice per device, reads matching older pages and exposes continuation for incomplete scans. Details: task-history/2026-10-06-task-center-time-range.md.

Restored conversations now scroll to their latest messages after the transcript replaces the loading placeholder, including same-thread reopen and URL restoration. Sustained upward trackpad motion can load earlier history without an idle gap; decaying momentum alone remains a single gesture. Details: task-history/2026-10-06-history-opening-trackpad.md.

Web UI login now offers a default-on 记住密码 switch. It retains an opaque login cookie for 30 days and survives Bun restarts; logout revokes it, changing APP_ACCESS_KEY invalidates it, and opt-out uses a browser session cookie with a maximum 12-hour server lifetime. Only password-bound credential hashes persist in the private store; the access password is never saved. Details: task-history/2026-10-06-remember-web-password.md.

Browser-local automatic retry is available at 网页设置 → 失败与重试, default off, with selectable failure categories, delay and finite attempt limits. Confirmed selected failures receive a cancellable continuation countdown; explicit Stop remains stopped. Mobile failure text occupies the full row with Retry at the bottom right. Details: task-history/2026-10-05-auto-retry-mobile-error-layout.md.

Explicit Stop now records acknowledged pending steering messages, in order, as user messages after the stopped-turn footer. It preserves the idle state and paused queue; reopening restores saved inputs from native thread metadata. Native echoes reconcile before/after saving to prevent duplicate display. External interruption and uncertain saves retain recoverable hints. Details: task-history/2026-10-05-stop-record-pending-steers.md.

File attachments now accept arbitrary types without extension/MIME filters. Selection, paste and drop work across the composer, queue editor, message revision and side chat. Uploads preserve original bytes through bounded chunks on the selected Codex connection, support cancellation, and retain drafts on failure. File chips, native queues, editing and history preserve filename/size/path identity. Details: task-history/2026-10-05-arbitrary-file-attachments.md.

Codex async questions now have a pending-question entry and answer form above the composer. Shift + Left opens questions, Shift + Right returns to the draft, and mobile has touch controls with a visible Submit action. Replies use the native CLI 0.160.0 question identifiers; rejection preserves drafts and history restores unanswered questions. Blocking approval behavior is preserved. Details: task-history/2026-10-05-async-question-adaptation.md.

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

2026-10-06 task range/history scrolling: 769 full unit/integration cases passed (6,288 assertions, 58 files), 28 desktop/mobile browser cases passed, and types, Vite/PWA build and diff checks passed. Browser coverage verifies older date ranges, custom validation/endpoints, persisted choices, explicit conversation opening, newest-position restoration after hydration/reload, continuous trackpad input, inertia rejection, history anchors and stale-response isolation. Scoped UI detection and independent desktop/mobile capture reviews required no material fixes. Live health and exact HTML, entry, task-center and service-worker bytes match the tested build. Trackpad verification uses browser event sequences, not a physical Mac.

2026-10-06 remembered login: 761 full unit/integration cases passed (6,241 assertions, 57 files), eight desktop/mobile login cases and six existing session-URL browser cases passed across focused runs, and types, Vite/PWA build and diff checks passed. Private storage, restart/expiry, password change, token rotation, durable logout, failed writes and metadata preservation were verified. Final desktop light/mobile dark captures passed independent review; the scoped mechanical UI check returned no findings. A preflight using the running service configuration preserved its existing credential/profile/history data through remembered login, restart and logout. Live health, exact HTML/entry/service-worker bytes, unchanged authentication configuration, 30-day remembered login and logout revocation passed after deployment.

2026-10-05 automatic retry/mobile errors: 749 full unit/integration cases passed (6,151 assertions, 55 files), 16 focused desktop/mobile browser cases passed, and Vue/server types, Vite/PWA build and diff check passed. Captures and geometry assertions verify mobile full-width error text and trailing actions. Retry classification, persistence, count/limit/cancel, native/current-turn checks and preserved Stop behavior were verified. Scoped mechanical UI check returned no findings. Local health and served frontend bytes match the build.

2026-10-05 Stop/steer insertion: 717 full unit/integration cases passed (6,061 assertions, 54 files), 8 focused desktop/mobile browser cases passed, and Vue/server typechecks, Vite/PWA build and diff check passed. A real isolated CLI 0.160.0 App Server with a fake local inference endpoint confirmed insertion without further generation and independent metadata persistence. Desktop/mobile stopped-transcript captures were inspected; the scoped mechanical UI check returned no findings. Local health and exact served index/entry bytes match the build.

2026-10-05 arbitrary file attachments: 703 unit/integration cases passed (5,979 assertions, 53 files), 18 focused desktop/mobile browser cases passed, and Vue/server typechecks, Vite/PWA build and diff check passed. Binary transfer bytes and cancelled/stale uploads were verified. Composer and queue captures were inspected. Local service health and served index/entry bytes matched the new build.

2026-10-05 async-question adaptation: 693 unit/integration cases passed (5,937 assertions, 52 files) and 14 focused desktop/mobile browser cases passed, including existing approval, steering and completion flows. Vue/server typechecks, Vite/PWA build and diff check passed. Desktop light/mobile dark captures were inspected. The running local service serves the exact generated index and entry asset; health passed. No backend restart or external publication was performed for this adaptation.

682 full unit/integration cases passed (5,889 assertions, 51 files) with the unblocked update banner in the tree; the focused banner case asserts an enabled button during work, one call for duplicate clicks and a real retry after failure. Vue/server typechecks passed. 34 focused desktop/mobile browser cases passed against the previous staged build; this change has no browser or deployment verification yet — no Vite/PWA build, backend restart or served-hash check. Vue/server typechecks, Vite/PWA build, diff check and live asset hashes passed. Captures for portable settings, directory actions, HTML, subagent identity, colored diffs and compact Session ID were inspected. Mobile coverage is browser emulation; no physical handset check. Earlier full-browser results are historical, not a full-suite run for this release.

## Running service

Local frontend updated at 2026-10-06T16:24:02Z for task-center time ranges and restored-history/trackpad scrolling. Served HTML, entry, task-center chunk, service worker and health were verified. The existing Bun backend continues running. `.local/task-range-history-deployment.json` records the release and static rollback location.

Local frontend/backend updated at 2026-10-06T01:26:01Z for remembered login and the related completed Remote UI changes. Bun PID 1399410 uses the existing 0.0.0.0:3000 configuration and configured access password/origin/credential path. Live health, served bytes and authentication checks passed. `.local/remember-login-deployment.json` records hashes and rollback paths; the temporary environment snapshot and credential preflight copy were removed. Source publication to origin/master is separate from this verified local rollout.

Frontend and backend 40b7e98 published at 2026-10-04T03:16:20.272246+08:00. Backend restarted as Bun PID 2072024 on 127.0.0.1:3000 for the network-image and sandboxed-frame CSP. Isolated startup preflight and live health, exact HTML/service worker/entry hashes, CSP, history API and unchanged saved profiles/credentials passed. Existing requiresKey=false state preserved. .local/deployment.json records the release and both rollback locations.

Appearance remains browser-local but can be transferred by JSON. Font names require those fonts on the destination device; font binaries are not exported. HTTPS pages may block HTTP image URLs under the browser's mixed-content rules. HTML preview is static and isolated, without scripts or automatic relative assets.

Input history shares .local/credentials.json (private, atomic; 100 entries per device, 16 MiB globally). Do not put credentials under dist. Codex CLI 0.159.0 has no individual accepted-steer cancellation method: ended-steer removal is a hint/draft operation, not a server history edit. External TUI input history is not bulk-imported.

## Preserved behavior

- Session device/thread URL restoration and runtime current-turn timers/sending remain in place. Historical inProgress items cannot reactivate finished work. See task-history/2026-10-03-session-url-live-turn-state.md.
- Error banners stay below navigation, edge to edge. The persistent header file-browser button opens the current directory and can recover from a missing default path. Slash commands count as first-level entries; avoid duplicate controls for /goal, /diff, /skills and /mention. See task-history/2026-10-03-navigation-files-entry-audit.md.
- Markdown code highlighting/copy, multiple exact APP_ORIGIN values, active Goal time, unified menu geometry, mobile keyboard avoidance, server-side device persistence and deferred default-directory preparation remain deployed. Tailscale is not configured.
- Goal resume, context-window-only Session ID copy, stream backpressure handling and stopped-turn duration remain in place.
- Local master commits are published to origin/master. Prior publication/merge/pruning records and recovery worktrees remain available.
