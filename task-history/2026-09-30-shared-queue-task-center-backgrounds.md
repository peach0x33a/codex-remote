# Shared queue, task center, recent windows and collaboration rendering

Date: 2026-09-30, Asia/Singapore.

## User requests

- Replace the update banner with a clickable toast.
- Correct the composer/island background and retain animation during conversations.
- Configure uploaded image opacity, blur and color.
- Inspect local codex-rs Agent Command Center and prioritize daemon-owned cross-client queues.
- Restrict project loading to the newest active session date and previous calendar date; use the same rule for the task center.
- Replace browser-native dropdowns with custom styled menus.
- Parse collabAgentToolCall.tool deeply into readable operation and result text.

## Implementation

### Queue ownership and concurrency

Inspected installed codex-cli 0.159.0 and /home/peach0x33a/workspace/codex/codex-rs read-only. Generated experimental bindings under /tmp/codex-remote-schema-experimental. Native thread/queue/list/add/update/delete/start and thread/settings/update are present; persistent scheduling belongs to the daemon.

Added ServerQueueClient with validated complete paginated snapshots, coalesced reads, stale-response rejection, notification invalidation, timeouts, connection disposal, and explicit unsupported-method fallback. Queue add IDs are correlation IDs, not claimed idempotency keys. Unknown mutation outcomes are never automatically retried.

Integrated native queue restoration and CRUD in useCodex, preserving legacy local queues only for explicitly unsupported servers. Settings updates serialize and re-read current model/effort/permission after asynchronous waits, preventing a captured full-access setting from overwriting a newly selected read-only setting before enqueue. Queue editing retains failures and remotely removed drafts, prevents switching edits during save, and restores drafts when the component unmounts.

Current native TUI source ignores ThreadQueueChanged and uses its own input queue preview. Web/PWA native queue sharing is implemented; TUI pending-list parity is not. No separate TUI checkout was modified.

### Task center and bounded recent discovery

Added a lazy-loaded read-only task center, reflecting actual status/active flags with project/status/model grouping, search, counts, metadata, recent messages and available token usage. It does not resume sessions while inspecting them and cancels reads/timers on visibility, device and lifetime changes.

Added shared recent-window helpers. Recency is preferred with valid updated/created timestamp fallback. Calendar boundaries use the browser's local timezone and the newest returned activity, not Date.now; September 29 therefore includes September 28–29 even when today is September 30. Pagination is descending, 100 rows per page, stops at the older boundary, and has a bounded page count. An explicit unsupported recency sort key may fall back to updated_at; transport failures do not trigger broad alternative scans.

Project discovery and history listing now share one snapshot instead of two full scans. Search filters that same scope; live activity advances and prunes the window. Task center probes its two source groups, selects one shared newest anchor, and stops both sources at that boundary. Loaded IDs without timestamps do not trigger historical metadata fan-out.

Removed the remaining native select. CustomSelect uses shared theme/radius tokens, keeps its popup within the top-layer modal, supports keyboard selection and Escape, and restores focus. Source scan found no remaining select/option/datalist controls in src/server.

### Collaborative tool presentation

Mapped the actual experimental tool enum: spawnAgent, sendInput, resumeAgent, wait, closeAgent, sendMessage, followupTask, interruptAgent and listAgents. MessageItem displays operation text, request/prompt, recipients, model/effort, per-agent state and messages. Calling wait successfully is not represented as agent completion. Unknown tools keep their original name and readable fallback; collaboration items never default to raw JSON. Incomplete live items, malformed data and empty reasoning are handled.

### Appearance and update feedback

Added UpdateToast, preserving existing update guards. Solid composer surfaces conceal the attached island overlap. WorkspaceBackground retains animation across welcome/conversation views and continues viewport-anchored geometry during sidebar collapse.

ImageBackgroundSettings persists opacity (0–100), blur (0–32 px), overlay color and strength (0–100), independently for light and dark themes. Current-theme reset, validation, live preview and image blur overscan are implemented. server/bridge.ts CSP permits blob image URLs; the Bun process needs to load this change before its HTTP responses reflect the updated policy.

## Verification

- Final bun test tests/unit: 213 passed, 0 failed, 1128 assertions, 10 files.
- Final bun run build: passed typechecks and production/PWA generation; 19 precache entries, approximately 675.51 KiB.
- bun run test:e2e --list: 98 desktop/mobile cases discovered across 4 files. Updated the package script to invoke the installed Playwright test CLI explicitly with Bun after the ambient command reported unknown command test.
- Collab actual-SFC rendering uses a temporary module in tests; replaced an unsupported oversized data-URL import and verified cleanup.
- Full browser/TCP integration remains unexecuted in this restricted phase because local listeners and Chromium startup are blocked. No new claim of visual verification or live queue execution.
- Existing non-fatal Vite chunk-size warning remains; task-center code is lazy loaded.

Logs: /tmp/codex-remote-unit-latest.log, /tmp/codex-remote-build-latest.log, /tmp/codex-remote-e2e-list.log.

## Main files

src/lib/server-queue.ts, src/lib/recent-window.ts, src/lib/collab-tool.ts, src/lib/agent-center.ts, src/lib/ui-preferences.ts, src/composables/useCodex.ts, src/composables/useAgentCenter.ts, src/composables/useAppearance.ts, src/components/AgentCommandCenter.vue, src/components/CustomSelect.vue, src/components/MessageItem.vue, src/components/QueuePane.vue, src/components/UpdateToast.vue, src/components/WorkspaceBackground.vue, src/components/BackgroundSettings.vue, src/components/DisplaySettings.vue, src/App.vue, src/style.css, shared/protocol.ts, server/bridge.ts, tests/unit/, tests/e2e/, tests/mock-daemon.ts, package.json, README.md, DESIGN.md, CURRENT_STATUS.md.

No commit/push/deployment requested. Existing service liveness was not reverified, no existing process was restarted, and the read-only codex-rs checkout remains untouched.
