# Current Status

Workspace: /home/peach0x33a/source/repos/apps/codex-remote
Branch: master
GitHub: https://github.com/peach0x33a/codex-remote (private; origin/master upstream)
Published frontend: f276f68
Published backend: 1f36f43

## Latest delivery

Two deliberate older-direction gestures at the transcript top load one earlier page, with wheel inertia grouping, touch support, duplicate/loading guards and fresh retry intent. The manual history button is centered. A visible message anchor preserves reading position; late responses cannot scroll a different device/thread.

Read groups expand into deduplicated vertical paths under 读取了 X 个文件; original execution data is behind 执行详情. Image-view records can open the actual remote image through the conversation device's file preview. Completed one-line reasoning displays its icon, sanitized text and native duration inline; multi-line reasoning stays collapsible, and live/blank reasoning stays out of the transcript. Application updates use a full-width banner below navigation with manual update, work-time protection and retry. Details: task-history/2026-10-04-history-gestures-tool-previews-update-banner.md.

/fast toggles Priority off/on and shares its state with the top-left reasoning lightning button. The menu displays 快速模式 with Chinese description. /compact and the context-capacity button invoke native thread/compact/start with streamed progress. See task-history/2026-10-04-fast-priority-manual-compaction.md and task-history/2026-10-04-fast-menu-name.md.

Terminal unobserved steers can be removed as hints or returned to the draft. Long pastes fold into editable chips (outer square brackets removed) while preserving full native input and caret scrolling. Device-wide input history keeps the latest 100 website submissions on the private Bun store and restores them across conversations, refreshes and browser contexts. See task-history/2026-10-03-composer-history-pasted-text-steer-recovery.md and task-history/2026-10-03-pasted-text-label.md.

## Verification

674 full unit/integration cases passed (5,800 assertions, 51 files). 28 focused desktop/mobile browser cases passed; four stream/tool/reasoning cases passed against the exact final build after the final guard fix. Vue/server typechecks, isolated Vite/PWA build, diff check and live asset hashes passed. Desktop/mobile control and tool-list/image-preview captures were inspected. Mobile gestures are browser emulation; no physical handset check. Earlier full-browser results are historical, not a full-suite run for this release.

## Running service

Frontend f276f68 published at 2026-10-04T02:06:52.808796+08:00. Backend 1f36f43 remains running as Bun PID 527090 on 127.0.0.1:3000; no restart for this release. Health, exact HTML/service worker/entry hashes, unchanged auth and saved credentials verified. Existing requiresKey=false state preserved. .local/deployment.json records the actual release and rollback frontend.

Input history shares .local/credentials.json (private, atomic; 100 entries per device, 16 MiB globally). Do not put credentials under dist. Codex CLI 0.159.0 has no individual accepted-steer cancellation method: ended-steer removal is a hint/draft operation, not a server history edit. External TUI input history is not bulk-imported.

## Preserved behavior

- Session device/thread URL restoration and runtime current-turn timers/sending remain in place. Historical inProgress items cannot reactivate finished work. See task-history/2026-10-03-session-url-live-turn-state.md.
- Error banners stay below navigation, edge to edge. The persistent header file-browser button opens the current directory and can recover from a missing default path. Slash commands count as first-level entries; avoid duplicate controls for /goal, /diff, /skills and /mention. See task-history/2026-10-03-navigation-files-entry-audit.md.
- Markdown code highlighting/copy, multiple exact APP_ORIGIN values, active Goal time, unified menu geometry, mobile keyboard avoidance, server-side device persistence and deferred default-directory preparation remain deployed. Tailscale is not configured.
- Goal resume, context-window-only Session ID copy, stream backpressure handling and stopped-turn duration remain in place.
- Local master changes from this task were not pushed to origin. Prior publication/merge/pruning records and recovery worktrees remain available.
