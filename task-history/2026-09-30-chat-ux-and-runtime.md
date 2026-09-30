# Chat UX and runtime delivery

Date: 2026-09-30, Asia/Singapore.

## Request and final scope

Start the project and adapt the chat experience using the installed ChatGPT/Codex App implementation while keeping the existing DeepSeek-inspired visual language. Subsequent user decisions are incorporated: devices only at top right; direct project tree; visible working-directory picker; independent model and reasoning controls; live setting changes for the next turn; message queue; adjustable width; inline image chips and previews; real reasoning content and timing; context-usage indicator; retryable upstream errors in the working status; no composer footnotes.

## Delivered

- Device dropdown at the top right, per-row edit, separate add option, green connected label, and a single row hover background.
- Sidebar project groups based on actual cwd, expand/collapse, five initial conversations with expansion, active-row visibility, archive guards, per-project new chat, and search.
- Working-directory folder control in the composer. Known paths and typed absolute Unix/Windows paths; a different directory starts a new conversation and does not retarget a running task.
- Content/composer default to 1080px. Width presets, 720–1600px slider, full-window option and browser persistence.
- Separate model and reasoning menus; permission and model settings remain editable while running. Explicit effective defaults are sent with the next turn, including queued messages. Auto-review retains workspace sandbox boundaries; full access requires explicit confirmation and managed restrictions disable unavailable choices.
- Queue entries are tied to device and thread, support editing/removal/pause/resume, continue in the correct background conversation, and retain failed submissions. Uncertain sends are not automatically retried. Queues are in current-page memory. Pending queues block archiving, deleting the corresponding device and PWA update.
- Rich prompt editor preserves text/image order using selection ranges. Inline thumbnail/name chips support selection, paste, drop, deletion, hover preview and click enlargement. Filenames round-trip through native text_elements placeholders. Messages no longer use a separate large thumbnail grid.
- Conversation hydration uses metadata-only resume plus bounded recent-item pagination. Cancellation, timeout recovery, stale-request rejection and older-message loading remain intact.
- Both reasoning summaryTextDelta and textDelta are handled, with summary/content history fallback and protection against empty final snapshots. Timers use observed/live start times or real history timestamps; unknown historical durations are not fabricated.
- Upstream error notifications with willRetry=true replace the working status and clear when activity resumes. Fatal errors remain visible errors.
- Context indicator reads thread/tokenUsage/updated, uses the last request and modelContextWindow, and exposes available input/cache/output/reasoning counts. It does not invent tool/skill/system percentages.
- Persistent explanatory composer footnotes were removed.

## References inspected

Installed app: /home/peach0x33a/.local/opt/chatgpt/26.928.20755/usr/lib/chatgpt/resources/app.asar. Model/permission components and Chinese labels were inspected; extracted UI assets remain outside the project under /tmp/codex-remote-reference. The implementation keeps the project's own components and assets. App Server types were generated from the installed CLI under /tmp/codex-remote-schema. The installed app uses updateThreadSettingsForNextTurn for model/effort changes.

## Main files

src/App.vue; src/style.css; src/composables/useCodex.ts; src/lib/rpc.ts; src/lib/prompt.ts; src/lib/permissions.ts; shared/protocol.ts.

Components: ComposerPopover, DevicePicker, ModelPicker, ReasoningPicker, EffortSlider, PermissionPicker, ContextIndicator, DisplaySettings, PromptEditor, InlineImage, ImagePreview, QueuePane, ProjectSidebar, WorkingDirectoryPicker and MessageItem.

Verification: tests/unit/prompt.test.ts, tests/unit/permissions.test.ts, tests/unit/runtime-state.test.ts, tests/mock-daemon.ts, tests/e2e/app.e2e.ts, tests/e2e/final-controls.e2e.ts, scripts/smoke-daemon.ts.

## Verification and evidence boundary

- Final Vue/TypeScript checks and production build passed.
- Final port-independent unit run: 17 passed, 0 failed. The new runtime tests execute the real RpcClient/useCodex logic using an in-memory transport and Vue renderer; they cover retry versus fatal error behavior, reasoning timer advancement/completion, actual history timestamps, selected cwd on thread/start, and project catalog updates.
- Before the final project-tree/directory/retry-timer enhancements and permission change, the combined bridge/unit suite had 18 passing tests and the full browser suite had 50 passing cases across desktop and emulated mobile Chromium. Captures were inspected for layout, ordered image chips, context details and controls.
- Three subagents handled project/directory UI, runtime state, and targeted regressions. Component-worker isolated checks were reported passing; these are not a substitute for final integration evidence.
- Five new Playwright tests (10 across desktop/mobile) cover the final controls. The resulting 60-case suite was not rerun after the latest environment switched to workspace-write, network restricted, approval never. The local-listener integration setup failed at Bun.serve(port: 0), and browser-control tools reported no available browser/IAB. No escalation or restriction bypass was attempted.
- Earlier real-daemon read-only smoke succeeded: metadata resume 162ms, total recent-history hydration 172ms, 60 items, earlier history available, auto-review capability detected, zero turns started. This is an earlier observation, not a guarantee for every conversation.

## Running and follow-up

The production Bun service was started on localhost:3000 during this task; the final frontend output is in dist/. If PWA caching retains an old version, apply the offered app update after pending work/queues are clear. Re-run bun run test and CHROMIUM_PATH=/home/peach0x33a/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome bun run test:e2e when local listener/browser execution is available again.

No Git repository was available in this workspace and no commit or publication was requested. PRODUCT.md remains the pre-existing legacy Impeccable context schema; an optional future init can update that schema separately.
